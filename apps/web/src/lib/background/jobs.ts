import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAssistantPromptSuggestionsForUser } from "../assistant/prompt-suggestions";
import {
  chargeDueKyroInvoices,
  runKyroBillingCycle,
} from "../billing/kyro-billing-engine";
import { processBillingAccessCycle } from "../billing/dunning";
import { syncExternalCalendarEventsToKyro } from "../calendar/provider-sync";
import { processOutboundMessageById } from "../communication/outbound";
import { runContactLifecycleReview } from "../crm/lifecycle-review";
import {
  getInboundEmailSettings,
  inboundQuietHoursActiveNow,
} from "../integrations/inbound-email-settings";
import { syncInboundEmail } from "../integrations/inbound-email-sync";
import { sendInternalBugNotification } from "../internal-notifications";
import { processDueCalendarSmsNotifications } from "../notifications/calendar-sms";
import { cleanupExpiredVoiceCallRecordings } from "../voice/calls";
import { processExpiredInquiryFutureSteps } from "../workflow/inquiry-future-steps";
import { objectRecord, textValue } from "@kyro/core";

/**
 * Why a sync counts as failed.
 *
 * Both sync jobs used to return their result unread, so a run where every
 * mailbox or calendar errored was recorded as a completed job: inbound mail
 * stops arriving and the queue still shows green. An expired OAuth token and a
 * genuinely quiet inbox produced identical job records.
 *
 * These are exported so the rule is testable on its own. `needsReconnect` is
 * deliberately excluded -- it needs the owner to reauthorise, and no amount of
 * retrying fixes it, so it is tracked as a connection status instead.
 */
export function inboundEmailSyncFailure(result: {
  errors: Array<{ accountEmail: string | null; message: string }>;
}) {
  if (result.errors.length === 0) {
    return null;
  }

  return result.errors
    .map((item) =>
      item.accountEmail ? `${item.accountEmail}: ${item.message}` : item.message,
    )
    .join("; ");
}

export function calendarSyncFailure(result: {
  providers: Array<{ error: string | null; provider: string }>;
}) {
  const failed = result.providers.filter((item) => item.error);

  if (failed.length === 0) {
    return null;
  }

  return failed.map((item) => `${item.provider}: ${item.error}`).join("; ");
}

export const BACKGROUND_JOB_TYPES = [
  "outbound_delivery",
  "inbound_email_sync",
  "calendar_sync",
  "calendar_notifications",
  "crm_lifecycle_review",
  "billing_access",
  "billing_cycle",
  "recording_cleanup",
  "assistant_suggestions",
] as const;

export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number];

type BackgroundJobRow = {
  attempt_count: number;
  due_at: string;
  id: string;
  job_type: BackgroundJobType;
  lease_token: string;
  max_attempts: number;
  payload: Record<string, unknown> | null;
  priority: number;
  subject_id: string;
  workspace_id: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  owner_user_id: string | null;
};

type DispatchResult = {
  continuation?: {
    delaySeconds: number;
    jobType: BackgroundJobType;
    payload?: Record<string, unknown>;
    subjectId: string;
  };
  result: Record<string, unknown>;
};

type QueueMetric = {
  expired_lease_count: number;
  failed_count: number;
  job_type: BackgroundJobType;
  oldest_ready_age_seconds: number;
  oldest_ready_at: string | null;
  oldest_schedule_age_seconds: number;
  oldest_schedule_at: string | null;
  overdue_schedule_count: number;
  processing_count: number;
  ready_count: number;
};

const JOB_CONCURRENCY: Record<BackgroundJobType, number> = {
  assistant_suggestions: 2,
  billing_access: 4,
  billing_cycle: 2,
  calendar_notifications: 4,
  calendar_sync: 3,
  crm_lifecycle_review: 3,
  inbound_email_sync: 3,
  outbound_delivery: 5,
  recording_cleanup: 2,
};

export const BACKGROUND_JOB_MAX_READY_AGE_SECONDS: Record<
  BackgroundJobType,
  number
> = {
  assistant_suggestions: 14 * 24 * 60 * 60,
  billing_access: 2 * 60 * 60,
  billing_cycle: 2 * 24 * 60 * 60,
  calendar_notifications: 20 * 60,
  calendar_sync: 45 * 60,
  crm_lifecycle_review: 12 * 60 * 60,
  inbound_email_sync: 20 * 60,
  outbound_delivery: 10 * 60,
  recording_cleanup: 2 * 24 * 60 * 60,
};

class BackgroundJobDispatchError extends Error {
  permanent: boolean;
  retryAt: string | null;

  constructor(
    message: string,
    options: { permanent?: boolean; retryAt?: string | null } = {},
  ) {
    super(message);
    this.name = "BackgroundJobDispatchError";
    this.permanent = Boolean(options.permanent);
    this.retryAt = options.retryAt ?? null;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Background job failed.";
}

function isBackgroundJobType(value: unknown): value is BackgroundJobType {
  return BACKGROUND_JOB_TYPES.includes(value as BackgroundJobType);
}

function serializeResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: value ?? null };
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }

    active += 1;

    try {
      return await task();
    } finally {
      release();
    }
  };
}

function normalizeClaimedJobs(value: unknown): BackgroundJobRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((candidate) => objectRecord(candidate))
    .filter(
      (candidate) =>
        textValue(candidate.id) &&
        textValue(candidate.workspace_id) &&
        textValue(candidate.lease_token) &&
        isBackgroundJobType(candidate.job_type),
    )
    .map((candidate) => ({
      attempt_count: Number(candidate.attempt_count ?? 0),
      due_at: textValue(candidate.due_at) ?? new Date().toISOString(),
      id: String(candidate.id),
      job_type: candidate.job_type as BackgroundJobType,
      lease_token: String(candidate.lease_token),
      max_attempts: Number(candidate.max_attempts ?? 5),
      payload: objectRecord(candidate.payload),
      priority: Number(candidate.priority ?? 50),
      subject_id: textValue(candidate.subject_id) ?? "",
      workspace_id: String(candidate.workspace_id),
    }));
}

async function loadWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceRow> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,name,owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load background-job workspace: ${error.message}`,
    );
  }

  if (!data) {
    throw new BackgroundJobDispatchError("Workspace no longer exists.", {
      permanent: true,
    });
  }

  return {
    id: String(data.id),
    name: textValue(data.name) ?? "Workspace",
    owner_user_id: textValue(data.owner_user_id),
  };
}

async function dispatchBackgroundJob(
  supabase: SupabaseClient,
  job: BackgroundJobRow,
  workspace: WorkspaceRow,
): Promise<DispatchResult> {
  switch (job.job_type) {
    case "outbound_delivery": {
      const outboundQueueId =
        textValue(job.payload?.outboundQueueId) ?? job.subject_id;

      if (!outboundQueueId) {
        throw new BackgroundJobDispatchError(
          "Outbound background job is missing its queue id.",
          { permanent: true },
        );
      }

      const delivery = await processOutboundMessageById(supabase, {
        outboundQueueId,
        workspaceId: job.workspace_id,
      });

      if (!delivery.ok && !delivery.skipped) {
        throw new BackgroundJobDispatchError(
          delivery.error ?? "Outbound delivery failed.",
          {
            permanent: delivery.status === "failed",
            retryAt: delivery.retryAt,
          },
        );
      }

      return { result: serializeResult(delivery) };
    }

    case "inbound_email_sync": {
      if (!workspace.owner_user_id) {
        throw new BackgroundJobDispatchError(
          "Workspace owner is missing for scheduled email sync.",
          { permanent: true },
        );
      }

      const result = await syncInboundEmail({
        supabase,
        trigger: "scheduled",
        user: { id: workspace.owner_user_id } as User,
        workspaceId: workspace.id,
      });

      const emailFailure = inboundEmailSyncFailure(result);

      if (emailFailure) {
        throw new Error(emailFailure);
      }

      return { result: serializeResult(result) };
    }

    case "calendar_sync": {
      const settings = await getInboundEmailSettings(supabase, workspace.id);

      if (inboundQuietHoursActiveNow(settings, new Date())) {
        return { result: { reason: "quiet_hours", skipped: true } };
      }

      const result = await syncExternalCalendarEventsToKyro({
        supabase,
        trigger: "scheduled",
        userId: workspace.owner_user_id,
        workspaceId: workspace.id,
      });

      const calendarFailure = calendarSyncFailure(result);

      if (calendarFailure) {
        throw new Error(calendarFailure);
      }

      return { result: serializeResult(result) };
    }

    case "calendar_notifications": {
      const [result, futureSteps] = await Promise.all([
        processDueCalendarSmsNotifications(supabase, {
          limit: 1,
          workspaceId: workspace.id,
        }),
        processExpiredInquiryFutureSteps(supabase, {
          limit: 100,
          workspaceId: workspace.id,
        }),
      ]);

      if (result.errors.length > 0 || futureSteps.errors.length > 0) {
        throw new Error(
          [...result.errors, ...futureSteps.errors]
            .map((item) => item.error)
            .join("; "),
        );
      }

      return {
        result: serializeResult({ notifications: result, futureSteps }),
      };
    }

    case "crm_lifecycle_review": {
      const result = await runContactLifecycleReview(supabase, workspace.id, {
        limit: 500,
      });

      return { result: serializeResult(result) };
    }

    case "billing_access": {
      const results = await processBillingAccessCycle(supabase, {
        limit: 1,
        workspaceId: workspace.id,
      });
      const failed = results.find((result) => !result.ok);

      if (failed) {
        throw new Error(
          failed.error ?? "Billing access reconciliation failed.",
        );
      }

      return { result: { results: serializeResult(results) } };
    }

    case "billing_cycle": {
      const cycle = await runKyroBillingCycle({
        autoCharge: true,
        supabase,
        workspaceId: workspace.id,
      });
      const retryResults = await chargeDueKyroInvoices({
        supabase,
        workspaceId: workspace.id,
      });
      const accessResults = await processBillingAccessCycle(supabase, {
        limit: 1,
        workspaceId: workspace.id,
      });
      const accessFailure = accessResults.find((result) => !result.ok);

      if (accessFailure) {
        throw new Error(
          accessFailure.error ?? "Billing access reconciliation failed.",
        );
      }

      return {
        result: {
          accessResults: serializeResult(accessResults),
          cycle: serializeResult(cycle),
          retryResults: serializeResult(retryResults),
        },
      };
    }

    case "recording_cleanup": {
      const result = await cleanupExpiredVoiceCallRecordings(supabase, {
        limit: 100,
        workspaceId: workspace.id,
      });

      return {
        ...(result.processed >= 100
          ? {
              continuation: {
                delaySeconds: 60,
                jobType: "recording_cleanup" as const,
                subjectId: "recording-cleanup-continuation",
              },
            }
          : {}),
        result: serializeResult(result),
      };
    }

    case "assistant_suggestions": {
      const userId = textValue(job.payload?.userId) ?? job.subject_id;

      if (!userId) {
        throw new BackgroundJobDispatchError(
          "Assistant suggestion job is missing its user id.",
          { permanent: true },
        );
      }

      const result = await refreshAssistantPromptSuggestionsForUser({
        supabase,
        trigger: "weekly",
        userId,
        workspace,
      });

      return { result: serializeResult(result) };
    }
  }
}

async function enqueueContinuation(
  supabase: SupabaseClient,
  workspaceId: string,
  continuation: NonNullable<DispatchResult["continuation"]>,
) {
  const dueAt = new Date(
    Date.now() + continuation.delaySeconds * 1000,
  ).toISOString();
  const { error } = await supabase.from("background_jobs").insert({
    dedupe_key: [
      "continuation",
      continuation.jobType,
      workspaceId,
      continuation.subjectId,
      dueAt,
    ].join(":"),
    due_at: dueAt,
    job_type: continuation.jobType,
    max_attempts: 5,
    payload: continuation.payload ?? {},
    priority: 45,
    subject_id: continuation.subjectId,
    workspace_id: workspaceId,
  });

  if (error && error.code !== "23505") {
    throw new Error(`Unable to enqueue continuation: ${error.message}`);
  }
}

async function processClaimedJob(
  supabase: SupabaseClient,
  job: BackgroundJobRow,
  workspaceLoader: (workspaceId: string) => Promise<WorkspaceRow>,
) {
  const heartbeat = setInterval(() => {
    void supabase
      .rpc("renew_background_job_lease", {
        p_job_id: job.id,
        p_lease_seconds: 300,
        p_lease_token: job.lease_token,
      })
      .then(({ error }) => {
        if (error) {
          console.error("Unable to renew background job lease", {
            error: error.message,
            jobId: job.id,
            jobType: job.job_type,
          });
        }
      });
  }, 60_000);
  heartbeat.unref?.();

  try {
    const workspace = await workspaceLoader(job.workspace_id);
    const dispatched = await dispatchBackgroundJob(supabase, job, workspace);
    const { data: completed, error: completeError } = await supabase.rpc(
      "complete_background_job",
      {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_result: dispatched.result,
      },
    );

    if (completeError) {
      throw new Error(
        `Unable to complete background job: ${completeError.message}`,
      );
    }

    if (!completed) {
      throw new Error("Background job lease was lost before completion.");
    }

    if (dispatched.continuation) {
      await enqueueContinuation(
        supabase,
        job.workspace_id,
        dispatched.continuation,
      );
    }

    return {
      jobId: job.id,
      jobType: job.job_type,
      ok: true as const,
      workspaceId: job.workspace_id,
    };
  } catch (error) {
    const dispatchError =
      error instanceof BackgroundJobDispatchError ? error : null;
    const { data: status, error: failError } = await supabase.rpc(
      "fail_background_job",
      {
        p_error: errorMessage(error),
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_permanent: dispatchError?.permanent ?? false,
        p_retry_at: dispatchError?.retryAt ?? null,
      },
    );

    if (failError) {
      console.error("Unable to record background job failure", {
        error: failError.message,
        jobId: job.id,
        jobType: job.job_type,
      });
    }

    if (status === "failed") {
      await sendInternalBugNotification({
        context: { workspaceId: job.workspace_id },
        input: {
          context: {
            attemptCount: job.attempt_count,
            jobId: job.id,
            jobType: job.job_type,
            maxAttempts: job.max_attempts,
          },
          eventKey: `background-job-dead-letter:${job.id}`,
          kind: "background_job_dead_lettered",
          rawMessage: errorMessage(error),
          severity: "error",
          source: "background.jobs",
        },
      }).catch((notificationError) => {
        console.error("Unable to send background job failure alert", {
          error: errorMessage(notificationError),
          jobId: job.id,
        });
      });
    }

    return {
      error: errorMessage(error),
      jobId: job.id,
      jobType: job.job_type,
      ok: false as const,
      status: textValue(status) ?? "unknown",
      workspaceId: job.workspace_id,
    };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function enqueueDueBackgroundJobs(
  supabase: SupabaseClient,
  options: {
    jobTypes?: BackgroundJobType[] | null;
    limit?: number;
    workspaceId?: string | null;
  } = {},
) {
  const { data, error } = await supabase.rpc("enqueue_due_background_jobs", {
    p_job_types: options.jobTypes ?? null,
    p_limit: Math.max(1, Math.min(options.limit ?? 1000, 5000)),
    p_workspace_id: options.workspaceId ?? null,
  });

  if (error) {
    throw new Error(`Unable to enqueue due background work: ${error.message}`);
  }

  const row = Array.isArray(data) ? objectRecord(data[0]) : objectRecord(data);

  return {
    advancedCount: Number(row.advanced_count ?? 0),
    enqueuedCount: Number(row.enqueued_count ?? 0),
  };
}

export async function getBackgroundQueueMetrics(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("background_job_queue_metrics");

  if (error) {
    throw new Error(
      `Unable to load background queue metrics: ${error.message}`,
    );
  }

  return ((data ?? []) as QueueMetric[]).map((metric) => ({
    expiredLeaseCount: Number(metric.expired_lease_count ?? 0),
    failedCount: Number(metric.failed_count ?? 0),
    jobType: metric.job_type,
    oldestReadyAgeSeconds: Number(metric.oldest_ready_age_seconds ?? 0),
    oldestReadyAt: metric.oldest_ready_at,
    oldestScheduleAgeSeconds: Number(metric.oldest_schedule_age_seconds ?? 0),
    oldestScheduleAt: metric.oldest_schedule_at,
    overdueScheduleCount: Number(metric.overdue_schedule_count ?? 0),
    processingCount: Number(metric.processing_count ?? 0),
    readyCount: Number(metric.ready_count ?? 0),
  }));
}

export function unhealthyBackgroundQueueMetrics(
  metrics: Awaited<ReturnType<typeof getBackgroundQueueMetrics>>,
) {
  return metrics.filter(
    (metric) =>
      metric.expiredLeaseCount > 0 ||
      metric.failedCount > 0 ||
      metric.oldestReadyAgeSeconds >
        BACKGROUND_JOB_MAX_READY_AGE_SECONDS[metric.jobType] ||
      metric.oldestScheduleAgeSeconds >
        BACKGROUND_JOB_MAX_READY_AGE_SECONDS[metric.jobType],
  );
}

export async function retryBackgroundJob(
  supabase: SupabaseClient,
  jobId: string,
) {
  const { data, error } = await supabase.rpc("retry_background_job", {
    p_job_id: jobId,
  });

  if (error) {
    throw new Error(`Unable to retry background job: ${error.message}`);
  }

  return Boolean(data);
}

export async function runBackgroundJobCycle(
  supabase: SupabaseClient,
  options: {
    claimLimit?: number;
    jobTypes?: BackgroundJobType[] | null;
    leaseSeconds?: number;
    scheduleLimit?: number;
    workerId?: string;
    workspaceId?: string | null;
  } = {},
) {
  const jobTypes = options.jobTypes ?? null;
  const scheduled = await enqueueDueBackgroundJobs(supabase, {
    jobTypes,
    limit: options.scheduleLimit,
    workspaceId: options.workspaceId,
  });
  const workerId = options.workerId ?? `vercel:${randomUUID()}`;
  const { data, error } = await supabase.rpc("claim_background_jobs", {
    p_job_types: jobTypes,
    p_lease_seconds: Math.max(30, Math.min(options.leaseSeconds ?? 300, 1800)),
    p_limit: Math.max(1, Math.min(options.claimLimit ?? 40, 200)),
    p_worker_id: workerId,
    p_workspace_id: options.workspaceId ?? null,
  });

  if (error) {
    throw new Error(`Unable to claim background work: ${error.message}`);
  }

  const jobs = normalizeClaimedJobs(data);
  const globalLimit = createLimiter(10);
  const typeLimits = new Map(
    BACKGROUND_JOB_TYPES.map((jobType) => [
      jobType,
      createLimiter(JOB_CONCURRENCY[jobType]),
    ]),
  );
  const workspacePromises = new Map<string, Promise<WorkspaceRow>>();
  const workspaceLoader = (workspaceId: string) => {
    const existing = workspacePromises.get(workspaceId);

    if (existing) {
      return existing;
    }

    const loaded = loadWorkspace(supabase, workspaceId);
    workspacePromises.set(workspaceId, loaded);
    return loaded;
  };
  const results = await Promise.all(
    jobs.map((job) =>
      globalLimit(() =>
        typeLimits.get(job.job_type)!(async () =>
          processClaimedJob(supabase, job, workspaceLoader),
        ),
      ),
    ),
  );
  const metrics = await getBackgroundQueueMetrics(supabase);
  const unhealthy = unhealthyBackgroundQueueMetrics(metrics);

  if (unhealthy.length > 0) {
    const alertBucket = Math.floor(Date.now() / (30 * 60 * 1000));

    await sendInternalBugNotification({
      context: {},
      input: {
        context: { metrics: unhealthy },
        eventKey: `background-queue-unhealthy:${alertBucket}`,
        kind: "background_queue_unhealthy",
        rawMessage:
          "Background work or its recurring schedule is older than its service threshold, a worker lease has expired, or a job has dead-lettered.",
        severity: "error",
        source: "background.jobs",
      },
    }).catch((error) => {
      console.error("Unable to send background queue health alert", {
        error: errorMessage(error),
      });
    });
  }

  return {
    claimedCount: jobs.length,
    completedCount: results.filter((result) => result.ok).length,
    failedCount: results.filter((result) => !result.ok).length,
    metrics,
    unhealthy,
    results,
    scheduled,
    workerId,
  };
}

export async function drainBackgroundJobs(
  supabase: SupabaseClient,
  options: {
    claimLimit?: number;
    jobTypes?: BackgroundJobType[] | null;
    leaseSeconds?: number;
    maxCycles?: number;
    scheduleLimit?: number;
    timeBudgetMs?: number;
    workerId?: string;
    workspaceId?: string | null;
  } = {},
) {
  const startedAt = Date.now();
  const maxCycles = Math.max(1, Math.min(options.maxCycles ?? 10, 25));
  const timeBudgetMs = Math.max(
    5_000,
    Math.min(options.timeBudgetMs ?? 240_000, 270_000),
  );
  const claimLimit = Math.max(1, Math.min(options.claimLimit ?? 40, 200));
  const workerId = options.workerId ?? `vercel-drain:${randomUUID()}`;
  const cycles = [];

  while (cycles.length < maxCycles && Date.now() - startedAt < timeBudgetMs) {
    const cycle = await runBackgroundJobCycle(supabase, {
      claimLimit,
      jobTypes: options.jobTypes,
      leaseSeconds: options.leaseSeconds,
      scheduleLimit: options.scheduleLimit,
      workerId: `${workerId}:${cycles.length + 1}`,
      workspaceId: options.workspaceId,
    });
    cycles.push(cycle);

    if (cycle.claimedCount < claimLimit) {
      break;
    }
  }

  const finalCycle = cycles.at(-1);

  return {
    claimedCount: cycles.reduce((sum, cycle) => sum + cycle.claimedCount, 0),
    completedCount: cycles.reduce(
      (sum, cycle) => sum + cycle.completedCount,
      0,
    ),
    cycleCount: cycles.length,
    elapsedMs: Date.now() - startedAt,
    failedCount: cycles.reduce((sum, cycle) => sum + cycle.failedCount, 0),
    metrics: finalCycle?.metrics ?? [],
    results: cycles.flatMap((cycle) => cycle.results),
    scheduled: {
      advancedCount: cycles.reduce(
        (sum, cycle) => sum + cycle.scheduled.advancedCount,
        0,
      ),
      enqueuedCount: cycles.reduce(
        (sum, cycle) => sum + cycle.scheduled.enqueuedCount,
        0,
      ),
    },
    unhealthy: finalCycle?.unhealthy ?? [],
    workerId,
  };
}
