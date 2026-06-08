import { getAiLedger } from "../../../../lib/ai/triage";
import { getBillableUsageSummary } from "../../../../lib/billing/usage-summary";
import { getConversationList } from "../../../../lib/crm/queries";
import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import { getEngineQueues } from "../../../../lib/engine/event-action-audit";
import { syncInboundEmail } from "../../../../lib/integrations/inbound-email-sync";
import { getInboundEmailOperationalSummary } from "../../../../lib/integrations/inbound-email-settings";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

const REPORT_TYPES = [
  {
    description: "Email, SMS, phone, and CRM conversation history.",
    label: "All communications",
    value: "communications_log",
  },
  {
    description: "Customer and supplier messages into the workspace.",
    label: "Inbound communications",
    value: "inbound_communications",
  },
  {
    description: "Replies, sent emails, SMS, and outbound calls.",
    label: "Outbound communications",
    value: "outbound_communications",
  },
  {
    description: "Billable AI, voice, SMS, and provider usage.",
    label: "Usage ledger",
    value: "usage_ledger",
  },
  {
    description: "Generated quotes, invoices, images, PDFs, and files.",
    label: "Document activity",
    value: "documents_activity",
  },
  {
    description: "Open leads, follow-ups, missing details, and quote readiness.",
    label: "Work queue summary",
    value: "work_queue_summary",
  },
] as const;

const REPORT_TIMEFRAMES = [
  { label: "This week", value: "this_week" },
  { label: "This month", value: "this_month" },
  { label: "This year", value: "this_year" },
  { label: "Last week", value: "last_week" },
  { label: "Last month", value: "last_month" },
  { label: "Last year", value: "last_year" },
] as const;

const REPORT_DIRECTIONS = [
  { label: "All directions", value: "all" },
  { label: "Inbound", value: "inbound" },
  { label: "Outbound", value: "outbound" },
] as const;

const REPORT_CHANNELS = [
  { label: "All channels", value: "all" },
  { label: "Email", value: "email" },
  { label: "SMS", value: "sms" },
  { label: "Phone", value: "phone" },
  { label: "CRM/manual", value: "crm" },
] as const;

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

function numberValue(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
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

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function optionValue<T extends readonly { value: string }[]>(
  options: T,
  value: string | null,
): T[number]["value"] {
  return options.some((option) => option.value === value)
    ? (value as T[number]["value"])
    : options[0].value;
}

function periodForTimeframe(timeframe: string) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (timeframe === "this_week") {
    start.setDate(now.getDate() - now.getDay());
  } else if (timeframe === "last_week") {
    start.setDate(now.getDate() - now.getDay() - 7);
    end.setDate(now.getDate() - now.getDay() - 1);
  } else if (timeframe === "this_month") {
    start.setDate(1);
  } else if (timeframe === "last_month") {
    start.setMonth(now.getMonth() - 1, 1);
    end.setDate(0);
  } else if (timeframe === "this_year") {
    start.setMonth(0, 1);
  } else if (timeframe === "last_year") {
    start.setFullYear(now.getFullYear() - 1, 0, 1);
    end.setFullYear(now.getFullYear() - 1, 11, 31);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return {
    end: end.toISOString(),
    label:
      REPORT_TIMEFRAMES.find((option) => option.value === timeframe)?.label ??
      "This month",
    start: start.toISOString(),
  };
}

function itemInPeriod(at: string | null | undefined, period: { start: string; end: string }) {
  const time = new Date(at ?? "").getTime();

  return (
    Number.isFinite(time) &&
    time >= new Date(period.start).getTime() &&
    time <= new Date(period.end).getTime()
  );
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

async function getRecentMessages(supabase: MobileContext["supabase"], workspaceId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("id,conversation_id,direction,subject,body_text,created_at,received_at,sent_at")
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
        ? textValue(message.sent_at) ?? textValue(message.created_at)
        : textValue(message.received_at) ?? textValue(message.created_at);

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
  ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
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

async function getRecentGeneratedFiles(
  supabase: MobileContext["supabase"],
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("files")
    .select("id,filename,content_type,kind,source,created_at,size_bytes")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return [];
  }

  return (data ?? []).map((file) => ({
    at: String(file.created_at),
    filename: textValue(file.filename) ?? "Untitled file",
    id: String(file.id),
    kind: textValue(file.kind) ?? "file",
    sizeBytes: numberValue(file.size_bytes),
    source: textValue(file.source) ?? textValue(file.content_type) ?? "file",
  }));
}

type MobileContext = Awaited<ReturnType<typeof requireMobileWorkspaceContext>>;

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
        message.direction === "outbound" ? "Outbound message" : "Inbound message",
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

async function buildReportPreview({
  context,
  direction,
  timeframe,
  type,
}: {
  channel: string;
  context: MobileContext;
  direction: string;
  timeframe: string;
  type: string;
}) {
  const { supabase, workspace } = context;
  const period = periodForTimeframe(timeframe);
  const [messages, conversations, files, usageSummary] = await Promise.all([
    getRecentMessages(supabase, workspace.id).catch(() => []),
    getConversationList(supabase, workspace.id, { limit: 50 }).catch(() => []),
    getRecentGeneratedFiles(supabase, workspace.id),
    getBillableUsageSummary(supabase, workspace.id, { period: "monthly" }).catch(
      () => null,
    ),
  ]);
  const reportType = REPORT_TYPES.find((option) => option.value === type);
  const periodMessages = messages.filter(
    (message) =>
      itemInPeriod(message.at, period) &&
      (direction === "all" || message.direction === direction),
  );
  const periodFiles = files.filter((file) => itemInPeriod(file.at, period));
  const openQueue = conversations.filter(
    (conversation) =>
      conversation.status !== "resolved" &&
      conversation.status !== "closed",
  );
  const usageCharge =
    usageSummary?.totals.reduce((total, item) => total + item.customerCharge, 0) ??
    0;
  const summaryCards = [
    {
      detail: "Stored inbound and outbound",
      label: "Messages",
      value: String(periodMessages.length),
    },
    {
      detail: "Open CRM conversations",
      label: "Queue",
      value: String(openQueue.length),
    },
    {
      detail: "Generated and uploaded",
      label: "Files",
      value: String(periodFiles.length),
    },
    {
      detail: usageSummary?.totals[0]?.currency ?? "USD",
      label: "Usage",
      value: `$${usageCharge.toFixed(2)}`,
    },
  ];
  const sections =
    type === "usage_ledger"
      ? [
          {
            columns: ["Area", "Events", "Charge"],
            emptyText: "No usage summary is available.",
            rows:
              usageSummary?.users.slice(0, 8).map((user) => [
                user.displayName,
                String(user.eventCount),
                `$${user.totals.reduce(
                  (total, item) => total + item.customerCharge,
                  0,
                ).toFixed(2)}`,
              ]) ?? [],
            title: "Usage ledger",
          },
        ]
      : type === "documents_activity"
        ? [
            {
              columns: ["File", "Source", "Created"],
              emptyText: "No files were created in this period.",
              rows: periodFiles.slice(0, 12).map((file) => [
                file.filename,
                formatLabel(file.source),
                file.at,
              ]),
              title: "Document activity",
            },
          ]
        : type === "work_queue_summary"
          ? [
              {
                columns: ["Conversation", "Status", "Next"],
                emptyText: "No open work queue items.",
                rows: openQueue.slice(0, 12).map((conversation) => [
                  conversation.contactName ??
                    conversation.leadTitle ??
                    conversation.latestSubject ??
                    "Conversation",
                  formatLabel(conversation.status),
                  conversation.nextActionLabel,
                ]),
                title: "Work queue",
              },
            ]
          : [
              {
                columns: ["Message", "Direction", "When"],
                emptyText: "No communications match this report.",
                rows: periodMessages.slice(0, 12).map((message) => [
                  truncate(message.subject ?? message.body, 72),
                  formatLabel(message.direction),
                  message.at,
                ]),
                title: "Communications",
              },
            ];

  return {
    generatedAt: new Date().toISOString(),
    periodLabel: period.label,
    sections,
    subtitle: `${workspace.name} - ${period.label}`,
    summaryCards,
    title: reportType?.label ?? "Workspace report",
    type,
  };
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
        detail: "Create a manual inbound inquiry from the desktop developer UI.",
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
    const type = optionValue(REPORT_TYPES, url.searchParams.get("type"));
    const timeframe = optionValue(
      REPORT_TIMEFRAMES,
      url.searchParams.get("timeframe"),
    );
    const direction = optionValue(
      REPORT_DIRECTIONS,
      url.searchParams.get("direction"),
    );
    const channel = optionValue(REPORT_CHANNELS, url.searchParams.get("channel"));
    const [activityItems, developer, operationalLogs, preview] = await Promise.all([
      buildActivityItems(context),
      buildDeveloperSummary(context),
      buildOperationalLogs(context),
      buildReportPreview({
        channel,
        context,
        direction,
        timeframe,
        type,
      }),
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
        directions: REPORT_DIRECTIONS,
        preview,
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
      const mock = await createMockInboundInquiry(context, objectRecord(payload.inquiry));

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
