export type AssistantToolRegistryItem = {
  approval: "none" | "user_click" | "workspace_policy" | "provider_required";
  category:
    | "admin"
    | "calendar"
    | "crm"
    | "documents"
    | "communications"
    | "memory"
    | "settings"
    | "external";
  id: string;
  label: string;
  notes: string;
  permission: string;
  provider: string;
  risk: "low" | "medium" | "high";
  status: "active" | "approval_gated" | "provider_needed" | "planned";
  surfaces: string[];
  uiBlocks: string[];
};

export const assistantToolRegistry: AssistantToolRegistryItem[] = [
  {
    approval: "none",
    category: "crm",
    id: "work_queue.lookup",
    label: "Work queue lookup",
    notes:
      "Deterministic read-only command for leads, conversations, and current attention buckets.",
    permission: "Read CRM conversations and leads",
    provider: "Kyro database",
    risk: "low",
    status: "active",
    surfaces: ["Assistant", "Voice"],
    uiBlocks: ["link_cards", "summary_cards", "approval_queue"],
  },
  {
    approval: "user_click",
    category: "crm",
    id: "conversation.preview_action",
    label: "Conversation preview actions",
    notes:
      "Inline preview/action surface used by Assistant cards; existing action engine still owns approval and execution.",
    permission: "Approve/execute existing action cards from preview",
    provider: "Kyro action engine",
    risk: "medium",
    status: "approval_gated",
    surfaces: ["Assistant", "Inbox"],
    uiBlocks: ["preview", "approval_queue"],
  },
  {
    approval: "user_click",
    category: "communications",
    id: "email.send",
    label: "Gmail/Outlook outbound email",
    notes:
      "Real external send path. User-written replies send on button press; generated replies remain action/outbox gated.",
    permission: "Send approved email through connected mailbox",
    provider: "Google Gmail API / Microsoft Graph",
    risk: "high",
    status: "approval_gated",
    surfaces: ["Inbox", "Assistant", "Outbox operations"],
    uiBlocks: ["preview", "approval_queue"],
  },
  {
    approval: "provider_required",
    category: "external",
    id: "sms.send",
    label: "SMS outbound",
    notes:
      "Provider placeholder. Must use the same approval/outbox/audit pattern before external SMS is enabled.",
    permission: "Send customer SMS through a connected SMS provider",
    provider: "Not connected",
    risk: "high",
    status: "provider_needed",
    surfaces: ["Future Inbox", "Future Assistant"],
    uiBlocks: ["approval_queue"],
  },
  {
    approval: "provider_required",
    category: "external",
    id: "phone.call",
    label: "Phone call",
    notes:
      "Provider placeholder for customer-facing calls. Pronunciation/preflight policy exists, but calling is not connected.",
    permission: "Start or log a phone call through a connected phone provider",
    provider: "Not connected",
    risk: "high",
    status: "provider_needed",
    surfaces: ["Future Voice", "Future Assistant"],
    uiBlocks: ["approval_queue"],
  },
  {
    approval: "provider_required",
    category: "calendar",
    id: "calendar.event",
    label: "Calendar appointment",
    notes:
      "Internal appointment/task records exist now; external Google/Microsoft calendar creation waits for provider wiring.",
    permission:
      "Create external calendar events after internal appointment review",
    provider: "Not connected",
    risk: "medium",
    status: "provider_needed",
    surfaces: ["Inbox", "Future Calendar"],
    uiBlocks: ["approval_queue", "timeline"],
  },
  {
    approval: "user_click",
    category: "documents",
    id: "quote.prepare_send",
    label: "Quote document prepare/send",
    notes:
      "Creates reviewable quote-send work with generated PDFs and customer approval links. The final send remains gated.",
    permission: "Create reviewable quote emails and attach generated documents",
    provider: "Kyro documents + email outbox",
    risk: "medium",
    status: "approval_gated",
    surfaces: ["Assistant", "Documents", "Inbox"],
    uiBlocks: ["link_cards", "summary_cards", "preview"],
  },
  {
    approval: "workspace_policy",
    category: "documents",
    id: "image.generate",
    label: "Image generation",
    notes:
      "Generates one-off marketing visuals, project render concepts, and reference-image edits through OpenAI Images, then saves the output as a private Kyro file.",
    permission: "Generate and store image files from assistant prompts and uploaded reference images",
    provider: "OpenAI Images",
    risk: "medium",
    status: "active",
    surfaces: ["Assistant", "Voice", "Documents"],
    uiBlocks: ["generated_image", "link_cards"],
  },
  {
    approval: "workspace_policy",
    category: "external",
    id: "web.search",
    label: "Public web search",
    notes:
      "Lets the assistant search public/current internet information through OpenAI web search. CRM data, connected email, files, and workspace records still come from Kyro tools.",
    permission: "Search public web information and show source cards",
    provider: "OpenAI Responses web search",
    risk: "medium",
    status: "active",
    surfaces: ["Assistant"],
    uiBlocks: ["link_cards"],
  },
  {
    approval: "none",
    category: "external",
    id: "legislation.lookup",
    label: "Legislation and guidance lookup",
    notes:
      "Searches Kyro's jurisdiction-aware legislation and regulator guidance knowledge base. Public sources can be ingested now; licensed standards stay metadata-only until rights are available.",
    permission:
      "Read jurisdiction-specific legislation snippets, regulator guidance, and standards references",
    provider: "Kyro knowledge base",
    risk: "medium",
    status: "active",
    surfaces: ["Assistant", "Voice"],
    uiBlocks: ["link_cards", "timeline"],
  },
  {
    approval: "user_click",
    category: "memory",
    id: "memory.suggestion",
    label: "Assistant memory suggestion",
    notes:
      "Automatic suggestions are stored as pending memories and only enter active context after user approval.",
    permission: "Promote suggested memory to active assistant context",
    provider: "Kyro memory store",
    risk: "low",
    status: "approval_gated",
    surfaces: ["Assistant"],
    uiBlocks: ["memory_suggestion", "memory_notice"],
  },
  {
    approval: "none",
    category: "memory",
    id: "thread.switch_archive",
    label: "Assistant thread switching",
    notes:
      "Lets the user start a fresh working thread, switch between recent active threads, or archive a thread.",
    permission: "Read and update the signed-in user's assistant threads",
    provider: "Kyro memory store",
    risk: "low",
    status: "active",
    surfaces: ["Assistant"],
    uiBlocks: [],
  },
  {
    approval: "workspace_policy",
    category: "settings",
    id: "settings.safe_update",
    label: "Safe settings update",
    notes:
      "Only allowlisted low-risk workspace settings can be changed from chat/voice; sensitive settings remain guided.",
    permission: "Update editable workspace settings through allowlisted tools",
    provider: "Kyro settings tools",
    risk: "medium",
    status: "approval_gated",
    surfaces: ["Assistant", "Voice", "Settings"],
    uiBlocks: ["summary_cards"],
  },
  {
    approval: "none",
    category: "crm",
    id: "contact.timeline",
    label: "Contact timeline summary",
    notes:
      "Read-only contact/customer context with recent messages, quotes, and linked CRM activity.",
    permission: "Read contact profile, linked messages, leads, and quotes",
    provider: "Kyro database",
    risk: "low",
    status: "active",
    surfaces: ["Assistant", "CRM"],
    uiBlocks: ["timeline", "summary_cards", "link_cards"],
  },
  {
    approval: "none",
    category: "crm",
    id: "usage.summary",
    label: "Usage summary",
    notes:
      "Read-only usage ledger summaries for workspace cost/charge visibility.",
    permission: "Read metered usage ledger",
    provider: "Kyro usage ledger",
    risk: "low",
    status: "active",
    surfaces: ["Assistant", "Settings"],
    uiBlocks: ["summary_cards", "timeline"],
  },
  {
    approval: "none",
    category: "admin",
    id: "tool_registry.review",
    label: "Assistant tool registry",
    notes:
      "Developer/admin review surface for production tools, permission gates, providers, and renderable UI blocks.",
    permission: "Read static assistant tool registry metadata",
    provider: "Kyro codebase",
    risk: "low",
    status: "active",
    surfaces: ["Developer"],
    uiBlocks: [],
  },
];

export function assistantToolRegistrySummary() {
  return assistantToolRegistry.reduce(
    (summary, tool) => {
      summary.total += 1;
      summary[tool.status] += 1;
      return summary;
    },
    {
      active: 0,
      approval_gated: 0,
      planned: 0,
      provider_needed: 0,
      total: 0,
    },
  );
}
