import { getAiLedger } from "../../../../lib/ai/triage";
import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import { getEngineQueues } from "../../../../lib/engine/event-action-audit";
import { syncInboundEmail } from "../../../../lib/integrations/inbound-email-sync";
import { getInboundEmailOperationalSummary } from "../../../../lib/integrations/inbound-email-settings";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";
import {
  REPORT_CHANNELS,
  REPORT_DIRECTIONS,
  REPORT_TIMEFRAMES,
  REPORT_TYPES,
  buildWorkspaceReport,
  getReportContactOptions,
  parseReportFilters,
  type WorkspaceReport,
} from "../../../../lib/reports/data";

// Report generation used to be duplicated here (own REPORT_TYPES/TIMEFRAMES/
// DIRECTIONS/CHANNELS constants, its own period math, its own file/usage
// summary queries) instead of reusing lib/reports/data.ts, which is the same
// engine the web Reports tab uses. Reconciled against codex/mobile-app, which
// had already made this switch, so mobile and web reports share one
// implementation instead of drifting independently.

export const dynamic = "force-dynamic";

const ACTIVITY_FILTERS = [
  { label: "All", value: "all" },
  { label: "Messages", value: "messages" },
  { label: "Inbound", value: "inbound" },
  { label: "Outbound", value: "outbound" },
  { label: "Actions", value: "actions" },
  { label: "Events", value: "events" },
  { label: "Audit", value: "audit" },
  { label: "AI runs", value: "ai" },
  { label: "Routing", value: "routing" },
  { label: "Usage", value: "usage" },
] as const;

type ActivityTone =
  | "action"
  | "ai"
  | "audit"
  | "event"
  | "inbound"
  | "outbound"
  | "route"
  | "usage";

type ActivityItem = {
  at: string;
  detail: string;
  id: string;
  meta: string;
  title: string;
  tone: ActivityTone;
};

type OperationalLogItem = {
  at: string;
  detail: string;
  id: string;
  meta: string;
  status: string;
  title: string;
  type: "decision" | "event" | "message" | "sync";
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatLabel(value: string) {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function truncate(value: string | null, maxLength = 118) {
  if (!value) {
    return "No detail recorded";
  }

  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}...`
    : value;
}

function activityMatchesFilter(item: ActivityItem, filter: string) {
  if (filter === "all") {
    return true;
  }

  if (filter === "messages") {
    return item.tone === "inbound" || item.tone === "outbound";
  }

  if (filter === "actions") {
    return item.tone === "action";
  }

  if (filter === "events") {
    return item.tone === "event";
  }

  if (filter === "routing") {
    return item.tone === "route";
  }

  return item.tone === filter;
}

function activityCounts(items: ActivityItem[]) {
  return Object.fromEntries(
    ACTIVITY_FILTERS.map((filter) => [
      filter.value,
      items.filter((item) => activityMatchesFilter(item, filter.value)).length,
    ]),
  );
}

function developerEnabled(user: MobileContext["user"]) {
  const metadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? (user.app_metadata as Record<string, unknown>)
      : {};
  const value = metadata.developer ?? metadata.mobileDeveloper;

  return value === true || value === "true" || value === "yes" || value === 1;
}

async function getRecentMessages(
  supabase: MobileContext["supabase"],
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id,conversation_id,direction,subject,body_text,created_at,received_at,sent_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    throw new Error(`Unable to load message activity: ${error.message}`);
  }

  return (data ?? []).map((message) => {
    const direction =
      textValue(message.direction) === "outbound" ? "outbound" : "inbound";
    const at =
      direction === "outbound"
        ? (textValue(message.sent_at) ?? textValue(message.created_at))
        : (textValue(message.received_at) ?? textValue(message.created_at));

    return {
      at: at ?? new Date().toISOString(),
      body: textValue(message.body_text),
      direction,
      id: String(message.id),
      subject: textValue(message.subject),
    };
  });
}

async function buildOperationalLogs(context: MobileContext) {
  const { supabase, workspace } = context;
  const [inboundSummary, messages] = await Promise.all([
    getInboundEmailOperationalSummary(supabase, workspace.id).catch(() => ({
      decisions: [],
      syncRuns: [],
    })),
    getRecentMessages(supabase, workspace.id).catch(() => []),
  ]);
  const inbound: OperationalLogItem[] = [
    ...inboundSummary.syncRuns.map((run) => ({
      at: run.createdAt,
      detail: `${run.fetchedMessages} fetched, ${run.promotedMessages} promoted, ${run.duplicates} duplicate(s).`,
      id: `sync:${run.id}`,
      meta: `${run.checkedConnections} account(s) - ${run.actorType}`,
      status: run.errors ? "warning" : "ok",
      title: "Inbound sync",
      type: "sync" as const,
    })),
    ...inboundSummary.decisions.map((decision) => ({
      at: decision.processedAt ?? decision.createdAt,
      detail: truncate(decision.reason ?? decision.subject),
      id: `decision:${decision.id}`,
      meta: [
        decision.fromEmail,
        decision.category ? formatLabel(decision.category) : null,
      ]
        .filter(Boolean)
        .join(" - "),
      status: decision.status,
      title: decision.subject,
      type: "decision" as const,
    })),
    ...messages
      .filter((message) => message.direction === "inbound")
      .slice(0, 30)
      .map((message) => ({
        at: message.at,
        detail: truncate(message.body),
        id: `message:${message.id}`,
        meta: message.subject ?? "Inbound message",
        status: "received",
        title: "Inbound message",
        type: "message" as const,
      })),
  ].sort(
    (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime(),
  );
  const outbound: OperationalLogItem[] = messages
    .filter((message) => message.direction === "outbound")
    .slice(0, 40)
    .map((message) => ({
      at: message.at,
      detail: truncate(message.body),
      id: `message:${message.id}`,
      meta: message.subject ?? "Outbound message",
      status: "recorded",
      title: "Outbound message",
      type: "message" as const,
    }));

  return {
    filters: [
      { label: "All", value: "all" },
      { label: "Sync", value: "sync" },
      { label: "Decisions", value: "decision" },
      { label: "Messages", value: "message" },
      { label: "Warnings", value: "warning" },
    ],
    inbound: inbound.slice(0, 80),
    outbound,
  };
}

type MobileContext = Awaited<ReturnType<typeof requireMobileWorkspaceContext>>;

function mobileReportFromWorkspaceReport(report: WorkspaceReport) {
  return {
    business: report.business,
    filters: report.filters,
    generatedAt: report.generatedAt,
    notes: report.notes,
    period: report.period,
    periodLabel: report.period.label,
    sections: report.sections,
    subtitle: report.subtitle,
    summaryCards: report.summaryCards,
    title: report.title,
    type: report.type,
  };
}

async function buildActivityItems(
  context: MobileContext,
): Promise<ActivityItem[]> {
  const { supabase, workspace } = context;
  const [engine, aiLedger, messages] = await Promise.all([
    getEngineQueues(supabase, workspace.id).catch(() => ({
      actions: [],
      auditLogs: [],
      events: [],
    })),
    getAiLedger(supabase, workspace.id).catch(() => ({
      aiRuns: [],
      routeDecisions: [],
      usageEvents: [],
    })),
    getRecentMessages(supabase, workspace.id).catch(() => []),
  ]);
  const items: ActivityItem[] = [
    ...messages.map((message) => ({
      at: message.at,
      detail: truncate(message.subject ?? message.body),
      id: `message:${message.id}`,
      meta: message.direction === "outbound" ? "Outbound" : "Inbound",
      title:
        message.direction === "outbound"
          ? "Outbound message"
          : "Inbound message",
      tone: message.direction as "inbound" | "outbound",
    })),
    ...engine.actions.map((action) => ({
      at: action.createdAt,
      detail: `${formatLabel(action.status)} action requested by ${formatLabel(
        action.requestedBy,
      )}`,
      id: `action:${action.id}`,
      meta: action.approvalRequired ? "Approval required" : "No approval",
      title: formatLabel(action.type),
      tone: "action" as const,
    })),
    ...engine.events.map((event) => ({
      at: event.createdAt,
      detail: `${formatLabel(event.source)} event processed as ${formatLabel(
        event.status,
      )}`,
      id: `event:${event.id}`,
      meta: "Event",
      title: formatLabel(event.type),
      tone: "event" as const,
    })),
    ...engine.auditLogs.map((log) => ({
      at: log.createdAt,
      detail: `${formatLabel(log.actorType)} recorded against ${formatLabel(
        log.entityType,
      )}`,
      id: `audit:${log.id}`,
      meta: "Audit",
      title: formatLabel(log.action),
      tone: "audit" as const,
    })),
    ...aiLedger.aiRuns.map((run) => ({
      at: run.createdAt,
      detail: `${formatLabel(run.status)} on ${run.provider}/${run.model}`,
      id: `ai:${run.id}`,
      meta: `$${Number(run.actualCost ?? 0).toFixed(4)}`,
      title: formatLabel(run.taskType),
      tone: "ai" as const,
    })),
    ...aiLedger.routeDecisions.map((decision) => ({
      at: decision.createdAt,
      detail: `${formatLabel(decision.taskType)} routed to ${
        decision.selectedProvider
      }`,
      id: `route:${decision.id}`,
      meta: decision.decisionReason,
      title: decision.selectedModel,
      tone: "route" as const,
    })),
    ...aiLedger.usageEvents.map((usage) => ({
      at: usage.createdAt,
      detail: `${usage.quantity} units metered for ${formatLabel(usage.service)}`,
      id: `usage:${usage.id}`,
      meta: `$${Number(usage.customerChargeSnapshot ?? 0).toFixed(4)}`,
      title: formatLabel(usage.usageType),
      tone: "usage" as const,
    })),
  ];

  return items.sort(
    (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime(),
  );
}

async function buildDeveloperSummary(context: MobileContext) {
  const { supabase, workspace } = context;
  const [engine, aiLedger] = await Promise.all([
    getEngineQueues(supabase, workspace.id).catch(() => ({
      actions: [],
      auditLogs: [],
      events: [],
    })),
    getAiLedger(supabase, workspace.id).catch(() => ({
      aiRuns: [],
      routeDecisions: [],
      usageEvents: [],
    })),
  ]);
  const checks = [
    {
      detail: "Mobile API authenticated against the workspace context.",
      id: "workspace",
      status: "ok" as const,
      summary: workspace.name,
      title: "Workspace context",
    },
    {
      detail: "Pending action queue from the engine layer.",
      id: "actions",
      status: engine.actions.length ? ("warning" as const) : ("ok" as const),
      summary: `${engine.actions.length} recent actions loaded.`,
      title: "Action queue",
    },
    {
      detail: "Recent AI runs and routing decisions.",
      id: "ai",
      status: aiLedger.aiRuns.length ? ("ok" as const) : ("warning" as const),
      summary: `${aiLedger.aiRuns.length} AI runs, ${aiLedger.routeDecisions.length} routes.`,
      title: "AI ledger",
    },
    {
      detail: "Recent audit rows are visible through mobile auth.",
      id: "audit",
      status: engine.auditLogs.length ? ("ok" as const) : ("warning" as const),
      summary: `${engine.auditLogs.length} audit entries loaded.`,
      title: "Audit visibility",
    },
  ];

  return {
    checks,
    tools: [
      {
        detail:
          "Create a manual inbound inquiry from the desktop developer UI.",
        label: "Mock inbound",
        target: "/developer",
      },
      {
        detail: "Inspect outbound message operations and retry state.",
        label: "Outbox operations",
        target: "/developer/outbox",
      },
      {
        detail: "Review environment, table, integration, and storage health.",
        label: "System health",
        target: "/developer/system-health",
      },
      {
        detail: "Run the product smoke checklist.",
        label: "Smoke tests",
        target: "/developer/smoke-tests",
      },
      {
        detail: "Inspect assistant tools and registry state.",
        label: "Assistant tools",
        target: "/developer/assistant-tools",
      },
    ],
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireMobileWorkspaceContext(request);
    const url = new URL(request.url);
    const filters = parseReportFilters(url.searchParams);
    const [activityItems, developer, operationalLogs, report, contacts] =
      await Promise.all([
        buildActivityItems(context),
        buildDeveloperSummary(context),
        buildOperationalLogs(context),
        buildWorkspaceReport(context.supabase, context.workspace, filters),
        getReportContactOptions(context.supabase, context.workspace.id),
      ]);

    return Response.json({
      activity: {
        counts: activityCounts(activityItems),
        filters: ACTIVITY_FILTERS,
        items: activityItems.slice(0, 60),
      },
      developerAccess: {
        enabled: developerEnabled(context.user),
        source: "auth_app_metadata",
      },
      developer,
      operationalLogs,
      reports: {
        channels: REPORT_CHANNELS,
        contacts: [
          { label: "All contacts", value: "" },
          ...contacts.map((contact) => ({
            label:
              contact.name ??
              contact.company ??
              contact.email ??
              contact.phone ??
              "Unnamed contact",
            value: contact.id,
          })),
        ],
        directions: REPORT_DIRECTIONS,
        preview: mobileReportFromWorkspaceReport(report),
        timeframes: REPORT_TIMEFRAMES,
        types: REPORT_TYPES,
      },
      workspace: context.workspace,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireMobileWorkspaceContext(request);
    const payload = objectRecord(await request.json().catch(() => null));
    const operation = textValue(payload.operation);

    if (!developerEnabled(context.user)) {
      return Response.json(
        { error: "Developer access is not enabled for this account." },
        { status: 403 },
      );
    }

    if (operation === "manual_email_sync") {
      const result = await syncInboundEmail({
        supabase: context.supabase,
        trigger: "manual",
        user: context.user,
        workspaceId: context.workspace.id,
      });

      return Response.json({
        message: `Checked ${result.checkedConnections} account(s), fetched ${result.fetchedMessages}, promoted ${result.promotedMessages}, observed ${result.observedMessages}, skipped ${result.duplicates}.`,
        result,
      });
    }

    if (operation === "mock_inbound_inquiry") {
      const mock = await createMockInboundInquiry(
        context,
        objectRecord(payload.inquiry),
      );

      return Response.json({
        message: "Mock inbound inquiry recorded.",
        mock,
      });
    }

    return Response.json(
      { error: "Choose a supported developer operation." },
      { status: 400 },
    );
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

async function createMockInboundInquiry(
  { supabase, user, workspace }: MobileContext,
  inquiry: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const fromEmail = textValue(inquiry.fromEmail) ?? "mobile-test@example.com";
  const fromName = textValue(inquiry.fromName) ?? "Mobile Test Customer";
  const subject = textValue(inquiry.subject) ?? "Mock mobile inquiry";
  const bodyText =
    textValue(inquiry.bodyText) ??
    "Hi, I need a quote and would like Kyro to process this as a mock inbound inquiry.";
  const payload = {
    accountEmail: "developer@kyro.test",
    attachmentCount: 0,
    classification: {
      category: "customer_inquiry",
      confidence: 0.99,
      providerUsed: "developer_mock",
      reason: "Created from the mobile developer settings screen.",
    },
    contactEmail: fromEmail,
    fromEmail,
    fromName,
    provider: "developer_mock",
    receivedAt: now,
    stage: "mobile_mock",
    subject,
    bodyText,
  };
  const { data, error } = await supabase
    .from("events")
    .insert({
      payload,
      processed_at: null,
      source: "mobile_developer",
      status: "pending",
      type: "inbound.email.received",
      workspace_id: workspace.id,
    })
    .select("id,created_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create mock inbound inquiry.");
  }

  await insertAuditLog(supabase, {
    action: "developer.mock_inbound.created",
    actorId: user.id,
    actorType: "user",
    after: { eventId: data.id, payload },
    entityId: String(data.id),
    entityType: "event",
    workspaceId: workspace.id,
  });

  return {
    createdAt: String(data.created_at),
    eventId: String(data.id),
    fromEmail,
    subject,
  };
}
