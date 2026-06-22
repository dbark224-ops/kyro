export const dashboardMetrics = [
  { label: "Needs reply", tone: "cyan" as const, value: "8" },
  { label: "Ready quotes", tone: "pink" as const, value: "3" },
  { label: "Follow-ups", tone: "purple" as const, value: "5" }
];

export const dashboardBlocks = [
  {
    detail: "Reply drafts, quote approvals, follow-ups, and reopened threads.",
    label: "Today",
    tone: "cyan" as const,
    value: "16 open"
  },
  {
    detail: "Customer replies and generated drafts that need review.",
    label: "Inbox",
    tone: "pink" as const,
    value: "8 replies"
  },
  {
    detail: "Recent contacts, duplicate checks, and lead status changes.",
    label: "CRM",
    tone: "purple" as const,
    value: "4 reviews"
  },
  {
    detail: "Connected account state, usage, voice, and workspace defaults.",
    label: "Health",
    tone: "cyan" as const,
    value: "Stable"
  }
];

export const dashboardQueue = [
  {
    detail: "Kitchen sink backup, high priority, replied yesterday.",
    label: "Maya Patel",
    tone: "pink" as const,
    value: "Needs reply"
  },
  {
    detail: "Bathroom rough-in details complete for quote preparation.",
    label: "Northline Builders",
    tone: "cyan" as const,
    value: "Ready quote"
  },
  {
    detail: "Follow-up due after availability window was sent.",
    label: "Ethan Brooks",
    tone: "purple" as const,
    value: "Follow-up"
  }
];

export const assistantQuickPrompts = [
  "What needs attention?",
  "Summarize urgent jobs",
  "Draft a customer reply"
];

export const voiceMoments = [
  {
    detail: "Three customer replies and two quote approvals are waiting.",
    label: "Last summary",
    tone: "cyan" as const,
    value: "Ready"
  },
  {
    detail: "Balanced pronunciation policy with the saved Kyro voice.",
    label: "Voice setup",
    tone: "purple" as const,
    value: "Kyro"
  }
];

export const assistantCards = [
  {
    detail: "Workspace-aware text assistant with deterministic UI cards.",
    label: "Text chat",
    tone: "cyan" as const,
    value: "Ready"
  },
  {
    detail: "Realtime voice will share the same Assistant thread and tools.",
    label: "Voice",
    tone: "purple" as const,
    value: "Next"
  }
];

export const inboxItems = [
  {
    age: "9m",
    bucket: "Needs reply",
    contact: "Maya Patel",
    preview: "Kitchen sink is backing up again after yesterday's visit.",
    priority: "High",
    tone: "pink" as const
  },
  {
    age: "24m",
    bucket: "Ready to quote",
    contact: "Northline Builders",
    preview: "Bathroom rough-in details are complete and ready for a quote.",
    priority: "Medium",
    tone: "cyan" as const
  },
  {
    age: "1h",
    bucket: "Awaiting customer",
    contact: "Ethan Brooks",
    preview: "Kyro sent the availability window and is waiting on confirmation.",
    priority: "Normal",
    tone: "purple" as const
  }
];

export const crmContacts = [
  {
    company: "Patel Residence",
    label: "Client",
    name: "Maya Patel",
    notes: "2 open conversations, last contact 9 minutes ago."
  },
  {
    company: "Northline Builders",
    label: "Builder",
    name: "Sam Rivera",
    notes: "Quote draft linked to main bathroom renovation."
  },
  {
    company: "Apex Property Group",
    label: "Property manager",
    name: "Jules Martin",
    notes: "Duplicate phone review expected from backend profile matching."
  }
];

export const settingsSections = [
  {
    detail: "Supabase session is stored with SecureStore on device.",
    label: "Session"
  },
  {
    detail: "Google and Outlook status will come from the backend.",
    label: "Connected accounts"
  },
  {
    detail: "Voice preference and pronunciation settings are ready to surface.",
    label: "Voice"
  },
  {
    detail: "Timezone, currency, and workspace defaults stay server-owned.",
    label: "Workspace"
  }
];
