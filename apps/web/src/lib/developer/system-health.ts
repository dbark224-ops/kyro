import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_GMAIL_READ_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  getGoogleIntegrationOverview,
} from "../integrations/google";
import {
  MICROSOFT_MAIL_READ_SCOPE,
  MICROSOFT_MAIL_SEND_SCOPE,
  getMicrosoftIntegrationOverview,
} from "../integrations/microsoft";
import { hasIntegrationTokenEncryptionKey } from "../integrations/token-vault";
import { createServiceSupabaseClient } from "../supabase/service";

export type DeveloperHealthStatus = "error" | "ok" | "warning";

export type DeveloperHealthCheck = {
  detail?: string;
  href?: string;
  id: string;
  status: DeveloperHealthStatus;
  summary: string;
  title: string;
};

export type DeveloperHealthSection = {
  checks: DeveloperHealthCheck[];
  eyebrow: string;
  id: string;
  title: string;
};

export type DeveloperIssue = {
  context: string;
  detail: string;
  href?: string;
  occurredAt: string | null;
  status: string;
  title: string;
};

export type DeveloperSystemHealth = {
  generatedAt: string;
  recentIssues: DeveloperIssue[];
  sections: DeveloperHealthSection[];
  storageBucket: string;
  tableChecks: DeveloperHealthCheck[];
  workspaceName: string;
};

export type DeveloperSmokeCheck = DeveloperHealthCheck & {
  steps: string[];
};

type WorkspaceInput = {
  id: string;
  name: string;
};

type TableRequirement = {
  label: string;
  scope: "current_user" | "current_workspace" | "workspace";
  table: string;
};

const REQUIRED_TABLES: TableRequirement[] = [
  { label: "Current user", scope: "current_user", table: "users" },
  { label: "Workspace", scope: "current_workspace", table: "workspaces" },
  { label: "Workspace members", scope: "workspace", table: "workspace_members" },
  { label: "Business profile", scope: "workspace", table: "business_profiles" },
  { label: "Workspace policies", scope: "workspace", table: "workspace_policies" },
  { label: "Contacts", scope: "workspace", table: "contacts" },
  { label: "Leads", scope: "workspace", table: "leads" },
  { label: "Channels", scope: "workspace", table: "channels" },
  { label: "Conversations", scope: "workspace", table: "conversations" },
  { label: "Messages", scope: "workspace", table: "messages" },
  { label: "Events", scope: "workspace", table: "events" },
  { label: "Actions", scope: "workspace", table: "actions" },
  { label: "Inquiry facts", scope: "workspace", table: "inquiry_facts" },
  { label: "Conversation tasks", scope: "workspace", table: "conversation_tasks" },
  {
    label: "Conversation appointments",
    scope: "workspace",
    table: "conversation_appointments",
  },
  { label: "Conversation notes", scope: "workspace", table: "conversation_notes" },
  { label: "Quote drafts", scope: "workspace", table: "quote_drafts" },
  { label: "Quote approval links", scope: "workspace", table: "quote_approval_links" },
  { label: "Generated documents", scope: "workspace", table: "generated_documents" },
  { label: "Files", scope: "workspace", table: "files" },
  { label: "Outbound messages", scope: "workspace", table: "outbound_messages" },
  {
    label: "Integration connections",
    scope: "workspace",
    table: "integration_connections",
  },
  {
    label: "Integration OAuth states",
    scope: "workspace",
    table: "integration_oauth_states",
  },
  { label: "Assistant threads", scope: "workspace", table: "assistant_threads" },
  { label: "Assistant messages", scope: "workspace", table: "assistant_messages" },
  { label: "Assistant memories", scope: "workspace", table: "assistant_memories" },
  {
    label: "Assistant pronunciations",
    scope: "workspace",
    table: "assistant_pronunciations",
  },
  { label: "AI runs", scope: "workspace", table: "ai_runs" },
  {
    label: "Model route decisions",
    scope: "workspace",
    table: "model_route_decisions",
  },
  { label: "Usage events", scope: "workspace", table: "usage_events" },
  {
    label: "Kyro billing periods",
    scope: "workspace",
    table: "kyro_billing_periods",
  },
  { label: "Kyro invoices", scope: "workspace", table: "kyro_invoices" },
  {
    label: "Kyro invoice line items",
    scope: "workspace",
    table: "kyro_invoice_line_items",
  },
  { label: "Audit logs", scope: "workspace", table: "audit_logs" },
];

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function isConfigured(key: string) {
  return Boolean(envValue(key));
}

function envCheck({
  detail,
  id,
  keys,
  required = true,
  title,
}: {
  detail?: string;
  id: string;
  keys: string[];
  required?: boolean;
  title: string;
}): DeveloperHealthCheck {
  const configured = keys.filter(isConfigured);
  const missing = keys.filter((key) => !isConfigured(key));
  const ok = configured.length === keys.length;
  const anyConfigured = configured.length > 0;

  if (ok) {
    return {
      detail,
      id,
      status: "ok",
      summary:
        keys.length === 1
          ? `${keys[0]} is configured.`
          : `${configured.length} of ${keys.length} values configured.`,
      title,
    };
  }

  if (!required && anyConfigured) {
    return {
      detail: missing.length > 0 ? `Missing: ${missing.join(", ")}` : detail,
      id,
      status: "warning",
      summary: `${configured.length} of ${keys.length} optional values configured.`,
      title,
    };
  }

  return {
    detail: missing.length > 0 ? `Missing: ${missing.join(", ")}` : detail,
    id,
    status: required ? "error" : "warning",
    summary: required
      ? "Required configuration is missing."
      : "Optional configuration is not set.",
    title,
  };
}

function groupedSecretCheck({
  id,
  keys,
  title,
}: {
  id: string;
  keys: string[];
  title: string;
}): DeveloperHealthCheck {
  const configured = keys.filter(isConfigured);

  if (configured.length > 0) {
    return {
      detail: `Accepted values: ${keys.join(", ")}`,
      id,
      status: "ok",
      summary: `${configured[0]} is configured.`,
      title,
    };
  }

  return {
    detail: `Set one of: ${keys.join(", ")}`,
    id,
    status: "error",
    summary: "No accepted secret is configured.",
    title,
  };
}

function normalizeScope(scope: string) {
  return scope.toLowerCase().replace("https://graph.microsoft.com/", "");
}

function hasScope(scopes: string[], requested: string) {
  const requestedScope = normalizeScope(requested);

  return scopes.some((scope) => normalizeScope(scope) === requestedScope);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function providerLabel(provider: string | null) {
  if (provider === "google") {
    return "Google";
  }

  if (provider === "microsoft") {
    return "Microsoft";
  }

  return provider ?? "Provider";
}

async function checkTable({
  requirement,
  supabase,
  userId,
  workspaceId,
}: {
  requirement: TableRequirement;
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
}): Promise<DeveloperHealthCheck> {
  try {
    let query = supabase
      .from(requirement.table)
      .select("id", { count: "exact", head: true });

    if (requirement.scope === "workspace") {
      query = query.eq("workspace_id", workspaceId);
    } else if (requirement.scope === "current_workspace") {
      query = query.eq("id", workspaceId);
    } else {
      query = query.eq("id", userId);
    }

    const { count, error } = await query;

    if (error) {
      return {
        detail: error.message,
        id: `table:${requirement.table}`,
        status: "error",
        summary: "Unavailable through the Supabase Data API.",
        title: requirement.label,
      };
    }

    return {
      id: `table:${requirement.table}`,
      status: "ok",
      summary: `${count ?? 0} row${count === 1 ? "" : "s"} visible.`,
      title: requirement.label,
    };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : "Unknown table check error.",
      id: `table:${requirement.table}`,
      status: "error",
      summary: "Unable to run table check.",
      title: requirement.label,
    };
  }
}

async function checkRequiredTables({
  supabase,
  user,
  workspace,
}: {
  supabase: SupabaseClient;
  user: User;
  workspace: WorkspaceInput;
}) {
  return Promise.all(
    REQUIRED_TABLES.map((requirement) =>
      checkTable({
        requirement,
        supabase,
        userId: user.id,
        workspaceId: workspace.id,
      }),
    ),
  );
}

async function checkStorageBucket(bucket: string): Promise<DeveloperHealthCheck> {
  if (!isConfigured("SUPABASE_SERVICE_ROLE_KEY")) {
    return {
      detail: "Storage bucket checks need the server-only Supabase service role key.",
      id: "storage:bucket",
      status: "warning",
      summary: "Cannot verify private storage bucket without service role.",
      title: bucket,
    };
  }

  try {
    const serviceSupabase = createServiceSupabaseClient();
    const { data, error } = await serviceSupabase.storage.getBucket(bucket);

    if (error) {
      return {
        detail: error.message,
        id: "storage:bucket",
        status: /not found|does not exist/i.test(error.message)
          ? "error"
          : "warning",
        summary: "Private storage bucket is not reachable.",
        title: bucket,
      };
    }

    return {
      detail: data?.public
        ? "Bucket exists, but it is public. Kyro-generated and uploaded files should stay private."
        : "Bucket exists and is private.",
      id: "storage:bucket",
      status: data?.public ? "warning" : "ok",
      summary: data?.public ? "Bucket is public." : "Bucket is ready.",
      title: bucket,
    };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : "Unknown storage error.",
      id: "storage:bucket",
      status: "error",
      summary: "Unable to verify private storage bucket.",
      title: bucket,
    };
  }
}

function integrationScopeCheck({
  connectedScopes,
  href,
  id,
  requestedScope,
  title,
}: {
  connectedScopes: string[];
  href?: string;
  id: string;
  requestedScope: string;
  title: string;
}): DeveloperHealthCheck {
  if (hasScope(connectedScopes, requestedScope)) {
    return {
      href,
      id,
      status: "ok",
      summary: "A connected account has the required scope.",
      title,
    };
  }

  return {
    detail: `Required scope: ${requestedScope}`,
    href,
    id,
    status: "warning",
    summary: "Reconnect or connect a provider with this scope before testing.",
    title,
  };
}

async function integrationChecks({
  supabase,
  workspace,
}: {
  supabase: SupabaseClient;
  workspace: WorkspaceInput;
}): Promise<DeveloperHealthCheck[]> {
  const [google, microsoft] = await Promise.all([
    getGoogleIntegrationOverview(supabase, workspace.id),
    getMicrosoftIntegrationOverview(supabase, workspace.id),
  ]);
  const googleConnected = google.connections.filter(
    (connection) => connection.status === "connected",
  );
  const microsoftConnected = microsoft.connections.filter(
    (connection) => connection.status === "connected",
  );
  const googleScopes = googleConnected.flatMap((connection) => connection.scopes);
  const microsoftScopes = microsoftConnected.flatMap(
    (connection) => connection.scopes,
  );
  const connectedAccounts = [...googleConnected, ...microsoftConnected].length;

  return [
    {
      detail: google.error ?? google.redirectUri ?? undefined,
      href: "/settings?section=integrations",
      id: "integration:google-config",
      status: google.configured && google.migrationReady ? "ok" : "warning",
      summary: google.configured
        ? `${googleConnected.length} Google account${
            googleConnected.length === 1 ? "" : "s"
          } connected.`
        : "Google OAuth env is not fully configured.",
      title: "Google Workspace",
    },
    {
      detail: microsoft.error ?? microsoft.redirectUri ?? undefined,
      href: "/settings?section=integrations",
      id: "integration:microsoft-config",
      status: microsoft.configured && microsoft.migrationReady ? "ok" : "warning",
      summary: microsoft.configured
        ? `${microsoftConnected.length} Microsoft account${
            microsoftConnected.length === 1 ? "" : "s"
          } connected.`
        : "Microsoft OAuth env is not fully configured.",
      title: "Microsoft Outlook",
    },
    {
      id: "integration:token-encryption",
      status: hasIntegrationTokenEncryptionKey() ? "ok" : "error",
      summary: hasIntegrationTokenEncryptionKey()
        ? "OAuth refresh tokens can be encrypted."
        : "Token encryption key is missing.",
      title: "Token encryption",
    },
    {
      href: "/settings?section=integrations",
      id: "integration:connected-accounts",
      status: connectedAccounts > 0 ? "ok" : "warning",
      summary:
        connectedAccounts > 0
          ? `${connectedAccounts} provider account${
              connectedAccounts === 1 ? "" : "s"
            } connected.`
          : "No provider account is connected.",
      title: "Connected accounts",
    },
    integrationScopeCheck({
      connectedScopes: googleScopes,
      href: "/settings?section=integrations",
      id: "scope:google-send",
      requestedScope: GOOGLE_GMAIL_SEND_SCOPE,
      title: "Gmail outbound send",
    }),
    integrationScopeCheck({
      connectedScopes: googleScopes,
      href: "/settings?section=integrations",
      id: "scope:google-read",
      requestedScope: GOOGLE_GMAIL_READ_SCOPE,
      title: "Gmail inbound read",
    }),
    integrationScopeCheck({
      connectedScopes: googleScopes,
      href: "/settings?section=integrations",
      id: "scope:google-drive",
      requestedScope: GOOGLE_DRIVE_FILE_SCOPE,
      title: "Google Drive filing",
    }),
    integrationScopeCheck({
      connectedScopes: microsoftScopes,
      href: "/settings?section=integrations",
      id: "scope:microsoft-send",
      requestedScope: MICROSOFT_MAIL_SEND_SCOPE,
      title: "Outlook outbound send",
    }),
    integrationScopeCheck({
      connectedScopes: microsoftScopes,
      href: "/settings?section=integrations",
      id: "scope:microsoft-read",
      requestedScope: MICROSOFT_MAIL_READ_SCOPE,
      title: "Outlook inbound read",
    }),
  ];
}

async function latestIssues({
  supabase,
  workspaceId,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<DeveloperIssue[]> {
  const [outbound, events, actions, integrations] = await Promise.all([
    supabase
      .from("outbound_messages")
      .select("id,recipient,subject,status,last_error,updated_at,conversation_id")
      .eq("workspace_id", workspaceId)
      .in("status", ["failed", "retry_scheduled"])
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("events")
      .select("id,type,source,status,payload,processed_at,created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("actions")
      .select("id,type,status,error,target_type,target_id,updated_at,created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("integration_connections")
      .select("id,provider,service,account_email,status,last_error,updated_at")
      .eq("workspace_id", workspaceId)
      .not("last_error", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);
  const issues: DeveloperIssue[] = [];

  for (const row of outbound.data ?? []) {
    issues.push({
      context: `Outbound to ${row.recipient ?? "unknown recipient"}`,
      detail: row.last_error ?? "No provider error was stored.",
      href: row.conversation_id
        ? `/inbox?conversationId=${row.conversation_id}`
        : "/developer/outbox",
      occurredAt: textValue(row.updated_at),
      status: String(row.status),
      title: row.subject ?? "Failed outbound delivery",
    });
  }

  for (const row of events.data ?? []) {
    const payload = objectRecord(row.payload);

    issues.push({
      context: `${row.source} event`,
      detail: textValue(payload.error) ?? "Event status is failed.",
      occurredAt: textValue(row.processed_at) ?? textValue(row.created_at),
      status: String(row.status),
      title: String(row.type),
    });
  }

  for (const row of actions.data ?? []) {
    issues.push({
      context: `${row.target_type ?? "workspace"} action`,
      detail: row.error ?? "Action status is failed.",
      occurredAt: textValue(row.updated_at) ?? textValue(row.created_at),
      status: String(row.status),
      title: String(row.type),
    });
  }

  for (const row of integrations.data ?? []) {
    issues.push({
      context: `${providerLabel(textValue(row.provider))} ${row.account_email ?? ""}`.trim(),
      detail: row.last_error ?? "Provider connection has an error.",
      href: "/settings?section=integrations",
      occurredAt: textValue(row.updated_at),
      status: String(row.status),
      title: String(row.service),
    });
  }

  return issues
    .sort((a, b) => {
      const left = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const right = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;

      return right - left;
    })
    .slice(0, 8);
}

function sectionStatus(checks: DeveloperHealthCheck[]): DeveloperHealthStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }

  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }

  return "ok";
}

function tableSummaryCheck(checks: DeveloperHealthCheck[]): DeveloperHealthCheck {
  const errors = checks.filter((check) => check.status === "error");
  const status = sectionStatus(checks);

  return {
    detail:
      errors.length > 0
        ? errors.map((check) => `${check.title}: ${check.detail}`).join("\n")
        : undefined,
    href: "/developer/system-health",
    id: "tables:summary",
    status,
    summary:
      errors.length > 0
        ? `${errors.length} required table${errors.length === 1 ? "" : "s"} unavailable.`
        : `${checks.length} required tables are reachable.`,
    title: "Required database tables",
  };
}

export async function loadDeveloperSystemHealth({
  supabase,
  user,
  workspace,
}: {
  supabase: SupabaseClient;
  user: User;
  workspace: WorkspaceInput;
}): Promise<DeveloperSystemHealth> {
  const storageBucket = envValue("KYRO_FILE_STORAGE_BUCKET") || "kyro-files";
  const [tableChecks, storageCheck, providerChecks, issues] = await Promise.all([
    checkRequiredTables({ supabase, user, workspace }),
    checkStorageBucket(storageBucket),
    integrationChecks({ supabase, workspace }),
    latestIssues({ supabase, workspaceId: workspace.id }),
  ]);
  const envChecks: DeveloperHealthCheck[] = [
    envCheck({
      id: "env:supabase-url",
      keys: ["NEXT_PUBLIC_SUPABASE_URL"],
      title: "Supabase URL",
    }),
    envCheck({
      id: "env:supabase-anon-key",
      keys: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      title: "Supabase anon key",
    }),
    envCheck({
      id: "env:supabase-service-role",
      keys: ["SUPABASE_SERVICE_ROLE_KEY"],
      title: "Supabase service role",
    }),
    groupedSecretCheck({
      id: "env:inbound-secret",
      keys: ["INBOUND_EMAIL_SYNC_SECRET", "CRON_SECRET"],
      title: "Inbound sync secret",
    }),
    groupedSecretCheck({
      id: "env:outbox-secret",
      keys: ["OUTBOUND_DELIVERY_SECRET", "CRON_SECRET", "INBOUND_EMAIL_SYNC_SECRET"],
      title: "Outbox processor secret",
    }),
    envCheck({
      id: "env:app-url",
      keys: ["NEXT_PUBLIC_APP_URL"],
      title: "Public app URL",
    }),
    envCheck({
      detail:
        "Used by server-side Google Places address autocomplete and place details.",
      id: "env:google-maps",
      keys: ["GOOGLE_MAPS_API_KEY"],
      required: false,
      title: "Google Maps address lookup",
    }),
    envCheck({
      detail:
        "Optional stricter postal validation. Falls back to GOOGLE_MAPS_API_KEY when omitted.",
      id: "env:google-address-validation",
      keys: ["GOOGLE_ADDRESS_VALIDATION_API_KEY"],
      required: false,
      title: "Google Address Validation override",
    }),
    envCheck({
      id: "env:openai",
      keys: ["OPENAI_API_KEY"],
      required: false,
      title: "OpenAI API key",
    }),
    envCheck({
      id: "env:elevenlabs",
      keys: ["ELEVENLABS_API_KEY"],
      required: false,
      title: "ElevenLabs API key",
    }),
    envCheck({
      id: "env:ollama",
      keys: ["OLLAMA_BASE_URL", "OLLAMA_MODEL"],
      required: false,
      title: "Local Ollama",
    }),
  ];
  const aiVoiceChecks: DeveloperHealthCheck[] = [
    envCheck({
      id: "env:assistant-provider",
      keys: ["ASSISTANT_PROVIDER"],
      required: false,
      title: "Assistant provider override",
    }),
    envCheck({
      id: "env:openai-stt-model",
      keys: ["OPENAI_STT_MODEL"],
      required: false,
      title: "Speech-to-text model override",
    }),
    envCheck({
      id: "env:openai-realtime-model",
      keys: ["OPENAI_REALTIME_MODEL"],
      required: false,
      title: "Realtime voice model override",
    }),
    envCheck({
      id: "env:openai-tts-model",
      keys: ["OPENAI_TTS_MODEL"],
      required: false,
      title: "OpenAI TTS model override",
    }),
  ];

  return {
    generatedAt: new Date().toISOString(),
    recentIssues: issues,
    sections: [
      {
        checks: [tableSummaryCheck(tableChecks), storageCheck],
        eyebrow: "Supabase",
        id: "data",
        title: "Database and private storage",
      },
      {
        checks: envChecks,
        eyebrow: "Runtime",
        id: "environment",
        title: "Required server configuration",
      },
      {
        checks: providerChecks,
        eyebrow: "OAuth",
        id: "integrations",
        title: "Connected account readiness",
      },
      {
        checks: aiVoiceChecks,
        eyebrow: "AI",
        id: "ai-voice",
        title: "Assistant and voice providers",
      },
      {
        checks: [
          {
            href: "/api/integrations/email/sync",
            id: "worker:inbound",
            status:
              isConfigured("INBOUND_EMAIL_SYNC_SECRET") || isConfigured("CRON_SECRET")
                ? "ok"
                : "error",
            summary:
              isConfigured("INBOUND_EMAIL_SYNC_SECRET") || isConfigured("CRON_SECRET")
                ? "Protected sync endpoint can be called by cron."
                : "Set INBOUND_EMAIL_SYNC_SECRET or CRON_SECRET.",
            title: "Inbound email worker",
          },
          {
            href: "/api/outbox/process",
            id: "worker:outbox",
            status:
              isConfigured("OUTBOUND_DELIVERY_SECRET") ||
              isConfigured("CRON_SECRET") ||
              isConfigured("INBOUND_EMAIL_SYNC_SECRET")
                ? "ok"
                : "error",
            summary:
              isConfigured("OUTBOUND_DELIVERY_SECRET") ||
              isConfigured("CRON_SECRET") ||
              isConfigured("INBOUND_EMAIL_SYNC_SECRET")
                ? "Protected outbox processor endpoint can be called by cron."
                : "Set OUTBOUND_DELIVERY_SECRET, CRON_SECRET, or INBOUND_EMAIL_SYNC_SECRET.",
            title: "Outbox retry worker",
          },
          {
            href: "/api/billing/kyro/run",
            id: "worker:kyro-billing",
            status:
              isConfigured("KYRO_BILLING_RUN_SECRET") ||
              isConfigured("OUTBOUND_DELIVERY_SECRET") ||
              isConfigured("CRON_SECRET")
                ? "ok"
                : "warning",
            summary:
              isConfigured("KYRO_BILLING_RUN_SECRET") ||
              isConfigured("OUTBOUND_DELIVERY_SECRET") ||
              isConfigured("CRON_SECRET")
                ? "Protected Kyro billing runner can generate invoices and optionally charge saved cards."
                : "Set KYRO_BILLING_RUN_SECRET, OUTBOUND_DELIVERY_SECRET, or CRON_SECRET before enabling automated invoice runs.",
            title: "Kyro billing runner",
          },
        ],
        eyebrow: "Operations",
        id: "workers",
        title: "Cron and processor readiness",
      },
    ],
    storageBucket,
    tableChecks,
    workspaceName: workspace.name,
  };
}

function findCheck(health: DeveloperSystemHealth, id: string) {
  return (
    health.tableChecks.find((check) => check.id === id) ??
    health.sections.flatMap((section) => section.checks).find((check) => check.id === id)
  );
}

function combinedStatus(
  checks: Array<DeveloperHealthCheck | undefined>,
): DeveloperHealthStatus {
  return sectionStatus(checks.filter(Boolean) as DeveloperHealthCheck[]);
}

export function smokeChecksFromSystemHealth(
  health: DeveloperSystemHealth,
): DeveloperSmokeCheck[] {
  const mockInboundChecks = [
    findCheck(health, "table:contacts"),
    findCheck(health, "table:leads"),
    findCheck(health, "table:conversations"),
    findCheck(health, "table:messages"),
    findCheck(health, "table:events"),
    findCheck(health, "table:actions"),
    findCheck(health, "table:inquiry_facts"),
    findCheck(health, "table:ai_runs"),
    findCheck(health, "table:usage_events"),
    findCheck(health, "table:audit_logs"),
  ];
  const outboundChecks = [
    findCheck(health, "table:outbound_messages"),
    findCheck(health, "worker:outbox"),
    findCheck(health, "scope:google-send")?.status === "ok"
      ? findCheck(health, "scope:google-send")
      : findCheck(health, "scope:microsoft-send"),
  ];
  const documentChecks = [
    findCheck(health, "table:quote_drafts"),
    findCheck(health, "table:generated_documents"),
    findCheck(health, "table:files"),
    findCheck(health, "storage:bucket"),
  ];
  const inboundChecks = [
    findCheck(health, "worker:inbound"),
    findCheck(health, "scope:google-read")?.status === "ok"
      ? findCheck(health, "scope:google-read")
      : findCheck(health, "scope:microsoft-read"),
  ];
  const addressChecks = [
    findCheck(health, "env:google-maps"),
    findCheck(health, "table:contacts"),
    findCheck(health, "table:inquiry_facts"),
  ];

  return [
    {
      detail: "This runs through the same manual inbound path the old dashboard mock form used.",
      href: "/developer",
      id: "smoke:mock-inbound",
      status: combinedStatus(mockInboundChecks),
      steps: [
        "Open Developer home.",
        "Create a mock inquiry with name, email or phone, and a realistic message.",
        "Confirm the success banner appears and the inquiry appears in Inbox/CRM.",
      ],
      summary: "Core CRM, event, action, AI, usage, and audit tables are reachable.",
      title: "Create mock inbound inquiry",
    },
    {
      detail: "Use a mock inquiry where the customer needs a reply.",
      href: "/inbox",
      id: "smoke:reply-draft",
      status: combinedStatus([
        findCheck(health, "table:actions"),
        findCheck(health, "table:messages"),
        findCheck(health, "table:workspace_policies"),
      ]),
      steps: [
        "Open the new Inbox conversation.",
        "Review the generated reply draft or create a manual reply.",
        "Send or record the reply and confirm the thread updates.",
      ],
      summary: "Reply workflow tables and communication policy are reachable.",
      title: "Review and send reply",
    },
    {
      detail: "The check is for local readiness; real content still depends on quote draft data.",
      href: "/documents",
      id: "smoke:generated-document",
      status: combinedStatus(documentChecks),
      steps: [
        "Open Files.",
        "Create or open a quote draft with line items.",
        "Generate a quote or invoice PDF and confirm it appears as a saved document.",
      ],
      summary: "Generated document records and private storage are ready.",
      title: "Generate quote or invoice PDF",
    },
    {
      detail: "If no provider send scope is connected, this can still be tested as an internal/manual record.",
      href: "/developer/outbox",
      id: "smoke:outbox",
      status: combinedStatus(outboundChecks),
      steps: [
        "Send an email reply from Inbox or a skipped-email card.",
        "Open Developer -> Outbox operations.",
        "Confirm the row is sent, queued, retry-scheduled, or failed with a readable reason.",
      ],
      summary: "Outbox table, processor secret, and at least one provider send path were checked.",
      title: "Inspect outbound delivery ledger",
    },
    {
      detail: "Automatic polling depends on production cron, but manual checks prove the same sync engine.",
      href: "/settings?section=integrations",
      id: "smoke:inbound-sync",
      status: combinedStatus(inboundChecks),
      steps: [
        "Open Settings -> Connected accounts.",
        "Run a manual inbox check or ask Assistant to check recent email.",
        "Confirm promoted mail, skipped-mail decisions, and sync health update.",
      ],
      summary: "Inbound sync endpoint and at least one provider read path were checked.",
      title: "Check inbound email awareness",
    },
    {
      detail:
        "Without GOOGLE_MAPS_API_KEY, manual address entry still works but autocomplete will show a configuration warning.",
      href: "/contacts",
      id: "smoke:address-autocomplete",
      status: combinedStatus(addressChecks),
      steps: [
        "Open CRM and select a contact.",
        "Start typing an address and choose a Google suggestion if configured.",
        "Save the profile and confirm the human-readable address remains visible.",
        "Repeat from an Inbox inquiry facts address field or Developer mock inbound.",
      ],
      summary:
        "Address lookup configuration and structured-address tables were checked.",
      title: "Verify address autocomplete and storage",
    },
    {
      detail: "Log is the sanity check that the app left breadcrumbs.",
      href: "/",
      id: "smoke:log-audit",
      status: combinedStatus([
        findCheck(health, "table:events"),
        findCheck(health, "table:audit_logs"),
        findCheck(health, "table:usage_events"),
      ]),
      steps: [
        "Open Log after running another smoke step.",
        "Filter by messages, actions, audit, AI runs, routing, or usage.",
        "Confirm the event/action/audit trail describes what happened.",
      ],
      summary: "Log, audit, and usage backing tables are reachable.",
      title: "Confirm audit and log visibility",
    },
  ];
}
