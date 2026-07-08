export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
};

export type MobileMetrics = {
  contactCount: number;
  needsReply: number;
  readyQuotes: number;
};

export type MobileBusinessHourDayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday"
  | "holidays";

export type MobileBusinessHoursDaySettings = {
  day: MobileBusinessHourDayKey;
  enabled: boolean;
  endTime: string;
  startTime: string;
};

export type MobileBusinessHoursScheduleSettings = {
  days: MobileBusinessHoursDaySettings[];
  notes: string;
};

export type AssistantLink = {
  href: string;
  label: string;
  meta?: string | null;
  refresh?: {
    kind: "conversation";
    liveWorkQueueVisible: boolean;
    workflowBucket: string;
  };
};

export type AssistantUiTone =
  | "cyan"
  | "neutral"
  | "pink"
  | "purple"
  | "success"
  | "warning";

export type AssistantUiBlock =
  | {
      links: AssistantLink[];
      title: string;
      type: "link_cards";
    }
  | {
      content: string;
      title: string;
      type: "memory_notice";
    }
  | {
      content: string;
      memoryId: string;
      status: "active" | "pending_approval" | "rejected";
      title: string;
      type: "memory_suggestion";
    }
  | {
      cards: Array<{
        detail?: string;
        href?: string;
        label: string;
        tone?: AssistantUiTone;
        value: string;
      }>;
      title: string;
      type: "summary_cards";
    }
  | {
      items: Array<{
        at?: string | null;
        detail?: string;
        href?: string;
        label: string;
        tone?: AssistantUiTone;
      }>;
      title: string;
      type: "timeline";
    }
  | {
      items: Array<{
        actionLabel?: string;
        detail?: string;
        href?: string;
        id: string;
        label: string;
        status: string;
      }>;
      title: string;
      type: "approval_queue";
    }
  | {
      images: Array<{
        alt: string;
        contentType: string;
        downloadHref: string;
        editMode: boolean;
        fileId: string;
        filename: string;
        href: string;
        meta?: string;
        model: string;
        prompt: string;
        provider: string;
        quality: string;
        referenceCount: number;
        size: string;
      }>;
      title: string;
      type: "generated_image";
    };

export type AssistantThreadMessage = {
  content: string;
  createdAt?: string;
  fallbackReason?: string;
  id: string;
  intent?: string;
  links?: AssistantLink[];
  model?: string;
  provider?: string;
  role: "assistant" | "user";
  uiBlocks?: AssistantUiBlock[];
};

export type MobileAssistantState = {
  error: string | null;
  messages: AssistantThreadMessage[];
  metrics: MobileMetrics;
  summary: string;
  threadId: string | null;
  workspace: WorkspaceSummary;
};

export type MobileAssistantPromptSuggestionState = {
  generatedAt: string | null;
  model?: string | null;
  setId: string | null;
  source: string;
  suggestions: string[];
  visibleSuggestions: string[];
};

export type MobileAssistantPromptSuggestionsResponse = {
  data: MobileAssistantPromptSuggestionState;
};

export type MobileAssistantSpeechPayload = {
  audioBase64: string;
  contentType: string;
  estimatedSeconds: number;
  model: string;
  provider: string;
  speed: number;
  voice: string;
};

export type MobileAssistantVoiceTurnResponse = {
  assistantTranscript: string;
  speech: MobileAssistantSpeechPayload | null;
  speechError: string | null;
  state: MobileAssistantState;
  userTranscript: string;
};

export type MobileAssistantVapiSessionResponse = {
  assistantId: string | null;
  assistantOverrides: Record<string, unknown>;
  configured: boolean;
  missing: string[];
  publicKey: string | null;
  threadId: string | null;
  voiceLabel: string;
};

export type MobileAssistantVapiTurnResponse = {
  assistantMessageId: string | null;
  assistantSaved: boolean;
  userMessageId: string | null;
  userSaved: boolean;
};

export type MobileFilePreviewResponse = {
  contentType: string;
  dataUri: string;
  filename: string;
  id: string;
};

export type MobileFileFilter =
  | "all"
  | "document"
  | "email"
  | "generated"
  | "image"
  | "upload";

export type MobileFileItem = {
  canPreviewInline: boolean;
  contentType: string | null;
  createdAt: string;
  filename: string;
  id: string;
  kind: "document" | "email" | "generated" | "image" | "system" | "upload";
  sizeBytes: number | null;
  source: string;
  sourceLabel: string;
};

export type MobileFilesResponse = {
  counts: Record<MobileFileFilter, number>;
  files: MobileFileItem[];
  filters: MobileFileFilter[];
  workspace: WorkspaceSummary;
};

export type MobileFileLinkResponse = {
  contentType: string;
  expiresIn: number;
  filename: string;
  id: string;
  url: string;
};

export type MobileQuoteLineItem = {
  description: string;
  notes: string | null;
  quantity: number | null;
  total: number | null;
  unit: string | null;
  unitPrice: number | null;
};

export type MobileDocumentTemplate = {
  createdAt: string;
  description: string;
  key: string;
  label: string;
  lineItems: MobileQuoteLineItem[];
  notes: string;
  settings: MobileDocumentTemplateSettings;
  updatedAt: string;
};

export type MobileDocumentTemplateSettings = {
  accentTheme: string;
  currency: string;
  defaultInvoiceTemplateKey: string | null;
  footerText: string;
  paymentTerms: string;
  quoteStyleDirection: string;
  showPreparedBy: boolean;
  validityDays: number;
};

export type MobileQuoteDraftListItem = {
  contact: {
    address: string | null;
    company: string | null;
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  conversation: {
    id: string;
    lastMessageAt: string | null;
    status: string;
  } | null;
  createdAt: string;
  id: string;
  inquiryFacts: {
    address: string | null;
    budget: string | null;
    jobType: string | null;
    preferredTime: string | null;
  } | null;
  lead: {
    id: string;
    nextStep: string | null;
    serviceType: string | null;
    status: string;
    title: string;
  } | null;
  lineItemCount: number;
  lineItems: MobileQuoteLineItem[];
  notes: string | null;
  status: string;
  title: string;
  updatedAt: string;
};

export type MobileDocumentsResponse = {
  counts: {
    approved: number;
    changesRequested: number;
    draft: number;
    ready: number;
    sent: number;
    total: number;
  };
  message?: string;
  quoteDrafts: MobileQuoteDraftListItem[];
  settings: MobileDocumentTemplateSettings;
  templates: MobileDocumentTemplate[];
  workspace: WorkspaceSummary;
};

export type MobileQuoteDraftDetailResponse = {
  approval: {
    approvedAt: string | null;
    changesRequestedAt: string | null;
    customerEmail: string | null;
    expiresAt: string | null;
    id: string;
    lastChangeRequest: string | null;
    status: string;
    token?: string;
    url?: string;
    viewedAt: string | null;
  } | null;
  auditLogs: Array<{
    action: string;
    actorType: string;
    createdAt: string;
    entityType: string;
    id: string;
  }>;
  documentFreshness: {
    changed: boolean;
    latestAt: string | null;
    latestKind: string | null;
  };
  history: Array<{
    kind: string;
    label: string;
    meta: string;
    occurredAt: string;
    quoteVersion: number | null;
  }>;
  messages: Array<{
    bodyText: string | null;
    createdAt: string;
    direction: string;
    id: string;
    subject: string | null;
  }>;
  message?: string;
  preview: {
    currency: string;
    customerLabel: string;
    jobLabel: string;
    subtotal: number | null;
    validityDays: number;
  };
  quoteDraft: MobileQuoteDraftListItem;
  revision: {
    currentVersion: number;
    label: string;
    needsRevision: boolean;
    pendingChangeRequest: {
      message: string | null;
      requestedAt: string | null;
      requestedFromVersion: number;
    } | null;
  };
  settings: MobileDocumentTemplateSettings;
  templates: MobileDocumentTemplate[];
  workspace: WorkspaceSummary;
};

export type MobilePaymentsContactOption = {
  company: string | null;
  email: string | null;
  id: string;
  label: string;
  phone: string | null;
};

export type MobilePaymentRequest = {
  amountCents: number;
  contactId: string | null;
  contactLabel: string;
  createdAt: string;
  currency: string;
  description: string;
  dueAt: string | null;
  id: string;
  metadata: Record<string, unknown>;
  paidAt: string | null;
  paymentUrl: string | null;
  status: string;
  updatedAt: string;
};

export type MobilePaymentsResponse = {
  account: {
    chargesEnabled: boolean;
    defaultCurrency: string;
    payoutsEnabled: boolean;
    providerAccountId: string | null;
    status: string;
  } | null;
  contacts: MobilePaymentsContactOption[];
  configured: boolean;
  migrationReady: boolean;
  paymentRequests: MobilePaymentRequest[];
  stats: {
    currency: string;
    overdueAmountCents: number;
    overdueCount: number;
    outstandingAmountCents: number;
    outstandingCount: number;
    paidThisMonthCents: number;
    paidThisWeekCents: number;
    totalPaidCents: number;
  };
  webhookConfigured: boolean;
  webhookUrl: string | null;
};

export type MobilePaymentLinkResponse = {
  paymentRequestId: string;
  providerCheckoutSessionId: string;
  url: string | null;
};

export type MobilePaymentSetupResponse = {
  url: string;
};

export type ConversationListItem = {
  contactEmail?: string | null;
  id: string;
  status: string;
  lastMessageAt: string | null;
  contactName: string | null;
  contactPhone?: string | null;
  leadTitle: string | null;
  searchableText?: string;
  leadPriority: string | null;
  latestSubject: string | null;
  latestBody: string | null;
  latestDirection: string | null;
  pendingApprovalCount: number;
  quoteDraftCount: number;
  nextActionLabel: string;
  workflowBucket: string;
};

export type ConversationWorkflowCounts = {
  awaitingCustomer: number;
  missingInfo: number;
  needsReply: number;
  needsReview: number;
  open: number;
  readyToQuote: number;
  resolved: number;
  siteVisitNeeded: number;
  total: number;
};

export type MobileInboxResponse = {
  counts: ConversationWorkflowCounts;
  items: ConversationListItem[];
  message?: string;
  promotedConversationId?: string;
  skippedEmails: {
    items: Array<{
      accountEmail: string | null;
      attachmentCount: number;
      attachmentNames: string[];
      category: string;
      classificationProvider: string | null;
      confidence: number | null;
      externalMessageId: string | null;
      externalThreadId: string | null;
      fromEmail: string | null;
      id: string;
      lastRepliedAt: string | null;
      lastReplySubject: string | null;
      processedAt: string | null;
      provider: string | null;
      reason: string | null;
      receivedAt: string | null;
      replyCount: number;
      source: string;
      subject: string;
      summary: string | null;
    }>;
    last24HoursCount: number;
  };
  workspace: WorkspaceSummary;
};

export type MobileInboxConversationMessage = {
  bodyText: string | null;
  channelDisplayName: string | null;
  channelType: string | null;
  createdAt: string;
  direction: string;
  id: string;
  receivedAt: string | null;
  sentAt: string | null;
  subject: string | null;
};

export type MobileInboxConversationDetail = {
  actions: Array<{
    body: string | null;
    createdAt: string;
    id: string;
    status: string;
    subject: string | null;
    summary: string;
    title: string;
    type: string;
  }>;
  allowedChannels: string[];
  contact: {
    address: string | null;
    company: string | null;
    contactType: string;
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  conversation: {
    createdAt: string;
    id: string;
    lastMessageAt: string | null;
    status: string;
  };
  defaultChannel: string;
  defaultSubject: string;
  inquiryFacts: {
    address: string | null;
    budget: string | null;
    fit: string;
    jobType: string | null;
    missingInfo: string[];
    preferredTime: string | null;
    urgency: string;
  } | null;
  lead: {
    estimatedValue: string | null;
    nextStep: string | null;
    priority: string;
    serviceType: string | null;
    status: string;
    title: string;
  } | null;
  messages: MobileInboxConversationMessage[];
  outboundMessages: Array<{
    channelType: string;
    id: string;
    lastError: string | null;
    provider: string | null;
    recipient: string | null;
    sentAt: string | null;
    status: string;
    subject: string | null;
  }>;
  quoteDrafts: Array<{
    id: string;
    lineItemCount: number;
    notes: string | null;
    status: string;
    title: string;
    updatedAt: string;
  }>;
  title: string;
  workspace: WorkspaceSummary;
};

export type MobileInboxReplyDraftResponse = {
  body: string;
  subject: string;
};

export type MobileInboxReplyResponse = {
  detail: MobileInboxConversationDetail;
  message: string;
};

export type MobileInboxActionOperation =
  | "approve"
  | "approve_execute"
  | "execute"
  | "save_draft"
  | "update_status";

export type MobileInboxActionResponse = {
  detail: MobileInboxConversationDetail;
  message: string;
};

export type ContactListItem = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  contactType: string;
  address: string | null;
  notes: string | null;
  source: string | null;
  searchableText?: string;
  lastMessageAt: string | null;
  messageCount: number;
  updatedAt: string;
};

export type MobileCrmResponse = {
  contacts: ContactListItem[];
  workspace: WorkspaceSummary;
};

export type MobileContactImportResponse = {
  created: number;
  importedContacts: Array<{
    address: string | null;
    company: string | null;
    contactType: string | null;
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
    result: "created" | "skipped" | "updated";
  }>;
  message: string;
  skipped: number;
  updated: number;
  workspace: WorkspaceSummary;
};

export type MobileCrmContactProfile = {
  actions: Array<{
    createdAt: string;
    id: string;
    status: string;
    summary: string;
    title: string;
    type: string;
  }>;
  auditLogs: Array<{
    action: string;
    actorType: string;
    createdAt: string;
    entityType: string;
    id: string;
  }>;
  companyContacts: Array<{
    contactType: string;
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
    updatedAt: string;
  }>;
  contact: {
    address: string | null;
    company: string | null;
    contactType: string;
    email: string | null;
    id: string;
    lifecycleReason: string | null;
    lifecycleReviewedAt: string | null;
    lifecycleSource: string;
    lifecycleStage: string;
    mergedIntoContactId: string | null;
    name: string | null;
    notes: string | null;
    phone: string | null;
    profileConflictContactIds: string[];
    profileResolutionReason: string | null;
    profileResolutionStatus: string;
    source: string | null;
    updatedAt: string;
  };
  counts: {
    actions: number;
    conversations: number;
    leads: number;
    messages: number;
    quoteDrafts: number;
  };
  identityWarnings: Array<{
    contactIds: string[];
    count: number;
    field: "email" | "phone";
    value: string;
  }>;
  leads: Array<{
    id: string;
    nextStep: string | null;
    priority: string;
    serviceType: string | null;
    status: string;
    title: string;
    updatedAt: string;
  }>;
  mergedSources: Array<{
    company: string | null;
    contactType: string;
    email: string | null;
    id: string;
    matchFields: string[];
    name: string | null;
    phone: string | null;
    updatedAt: string;
  }>;
  messages: Array<{
    bodyText: string | null;
    conversationId: string | null;
    createdAt: string;
    direction: string;
    id: string;
    receivedAt: string | null;
    sentAt: string | null;
    subject: string | null;
  }>;
  quoteDrafts: Array<{
    conversationId: string | null;
    id: string;
    leadTitle: string | null;
    lineItemCount: number;
    notes: string | null;
    status: string;
    title: string;
    updatedAt: string;
  }>;
  resolutionCandidates: Array<{
    company: string | null;
    contactType: string;
    email: string | null;
    id: string;
    matchFields: string[];
    name: string | null;
    phone: string | null;
    updatedAt: string;
  }>;
  title: string;
  workspace: WorkspaceSummary;
};

export type MobileCrmContactProfileResponse = {
  message: string;
  profile: MobileCrmContactProfile;
};

export type MobileBootstrapResponse = {
  commandCenter?: MobileDashboardCommandCenter;
  metrics: MobileMetrics;
  queue: ConversationListItem[];
  user: {
    email: string | null;
    id: string;
  };
  workspace: WorkspaceSummary;
};

export type MobileDashboardActivityItem = {
  at: string;
  href: string | null;
  id: string;
  meta: string;
  preview: string;
  subject: string | null;
  title: string;
  tone: "failed" | "inbound" | "outbound" | "system";
};

export type MobileDashboardContactSummary = {
  company: string | null;
  contactType: string;
  href: string;
  id: string;
  label: string;
  lastMessageAt: string | null;
  messageCount: number;
  sublabel: string | null;
};

export type MobileDashboardGeneratedDocumentItem = {
  href: string;
  id: string;
  lifecycleStatus: string;
  title: string;
  type: string;
  updatedAt: string;
};

export type MobileDashboardPaymentsSummary = {
  currency: string;
  overdueAmountCents: number;
  overdueCount: number;
  outstandingAmountCents: number;
  outstandingCount: number;
  paidThisMonthCents: number;
  paidThisWeekCents: number;
};

export type MobileDashboardStats = {
  awaitingCustomer: number;
  contactsIndexed: number;
  followUpDue: number;
  missingInfo: number;
  needsReply: number;
  openConversations: number;
  quoteApprovedOrBooked: number;
  readyToQuote: number;
  readyToSend: number;
  totalConversations: number;
};

export type MobileDashboardWorkQueueItem = {
  href: string;
  id: string;
  lastMessageAt: string | null;
  missingInfoCount: number;
  nextActionLabel: string;
  preview: string | null;
  priority: string | null;
  status: string;
  title: string;
  workflowBucket: string;
};

export type MobileCalendarEvent = {
  appointmentType: string;
  contact: {
    company: string | null;
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  contactId: string | null;
  conversationId: string | null;
  createdAt: string;
  description: string | null;
  endsAt: string | null;
  externalCalendarProvider: string | null;
  externalSyncStatus: string | null;
  id: string;
  lead: {
    id: string;
    priority: string | null;
    serviceType: string | null;
    status: string | null;
    title: string;
  } | null;
  leadId: string | null;
  location: string | null;
  startsAt: string | null;
  status: string;
  title: string;
  updatedAt: string;
};

export type MobileCalendarResponse = {
  events: MobileCalendarEvent[];
  range: {
    from: string;
    to: string;
  };
  workspace: WorkspaceSummary;
};

export type MobileCalendarEventMutationInput = {
  appointmentType: string;
  contactId?: string | null;
  conversationId?: string | null;
  description?: string | null;
  endsAt?: string | null;
  eventId?: string;
  leadId?: string | null;
  location?: string | null;
  startsAt?: string | null;
  status: string;
  title: string;
};

export type MobileCalendarEventMutationResponse = {
  deletedEventId?: string;
  event: MobileCalendarEvent | null;
  message: string;
  workspace: WorkspaceSummary;
};

export type MobileDashboardCommandCenter = {
  activity: MobileDashboardActivityItem[];
  calendar: MobileCalendarEvent[];
  generatedDocuments: MobileDashboardGeneratedDocumentItem[];
  payments: MobileDashboardPaymentsSummary;
  stats: MobileDashboardStats;
  suppliers: MobileDashboardContactSummary[];
  topContacts: MobileDashboardContactSummary[];
  workQueue: MobileDashboardWorkQueueItem[];
  workspace: WorkspaceSummary;
};

export type MobileSettingsResponse = {
  account: {
    email: string | null;
    emailVerified: boolean;
    supabaseEmailConfirmed: boolean;
    verificationRequired: boolean;
  };
  connections: Array<{
    accountEmail: string | null;
    accountName: string | null;
    id: string;
    lastCheckedAt: string | null;
    lastConnectedAt: string | null;
    lastError: string | null;
    lastSyncAt: string | null;
    needsReconnect: boolean;
    provider: string;
    providerLabel: string;
    readReady: boolean;
    requiredReadScope: string;
    scopes: string[];
    status: string;
  }>;
  integrations: {
    google: MobileIntegrationOverview;
    microsoft: MobileIntegrationOverview;
  };
  developer: {
    enabled: boolean;
    source: string;
  };
  message?: string;
  options: {
    displayCurrencies: string[];
    inboundPollIntervals: number[];
    inboundSenderRuleActions: string[];
    inboundSyncModes: string[];
    openAiVoices: string[];
    outboundChannels: string[];
    outboundVoicePronunciationPolicies: string[];
    phoneAgentDemeanors: string[];
    phoneAgentEscalationModes: string[];
    phoneAgentHumourLevels: string[];
    phoneAgentVerbosities: string[];
    phoneRegions: string[];
    pronunciationCategories: string[];
    pronunciationStatuses: string[];
    vapiVoices: MobileVapiVoiceOption[];
    voices: string[];
  };
  pronunciationEntries: Array<{
    aliases: string[];
    category: string;
    id: string;
    lastSeenAt: string | null;
    phrase: string;
    pronunciationHint: string | null;
    source: string;
    status: string;
    usageCount: number;
  }>;
  settings: {
    communication: {
      aiGeneratedSignature: MobileEmailSignatureSettings;
      aiGeneratedSignatureText: string;
      allowedChannels: string[];
      approvalRequired: boolean;
      defaultTone: string;
      dryRunOnly: boolean;
      manualSignature: MobileEmailSignatureSettings;
      manualSignatureText: string;
      useSeparateAiSignature: boolean;
    };
    general: {
      businessProfile: {
        brandAccentColor: string;
        brandPrimaryColor: string;
        brandStyle: string;
        businessAddress: string;
        businessName: string;
        contactHours: string;
        contactHoursSchedule: MobileBusinessHoursScheduleSettings;
        emergencyJobsEnabled: boolean;
        industry: string;
        logoContentBase64: string;
        logoContentType: string;
        logoFilename: string;
        logoSizeBytes: number;
        logoUrl: string;
        logoWidthPx: number;
        operatingCountry: string;
        publicEmail: string;
        publicPhoneNumber: string;
        serviceArea: string;
        servicePostcodes: string;
        serviceSuburbs: string;
        staffCount: number | null;
        travelRadiusKm: number | null;
        workingHours: string;
        workingHoursSchedule: MobileBusinessHoursScheduleSettings;
      };
      defaultPhoneRegion: string;
      displayCurrency: string;
      displayCurrencySourceLabel: string;
      exchangeRateProvider: string;
      exchangeRateUpdatedAt: string | null;
      timeZone: string;
    };
    inboundEmail: {
      actionInstructions: string;
      includeAwarenessEvents: boolean;
      lookbackDays: number;
      maxMessagesPerSync: number;
      pollIntervalMinutes: number;
      quietHoursEnabled: boolean;
      quietHoursEnd: string;
      quietHoursStart: string;
      senderRules: MobileInboundSenderRule[];
      senderRuleCount: number;
      syncMode: string;
      timeZone: string;
    };
    voice: {
      elevenLabsVoiceAccent: string;
      elevenLabsVoiceId: string;
      elevenLabsVoiceLabel: string;
      elevenLabsVoicePresetId: string;
      openAiVoice: string;
      outboundVoicePronunciationPolicy: string;
      phoneAgentDemeanor: string;
      phoneAgentEnabled: boolean;
      phoneAgentEscalationMode: string;
      phoneAgentHumourLevel: string;
      phoneAgentInboundEnabled: boolean;
      phoneAgentOutboundEnabled: boolean;
      phoneAgentUserNumbers: string[];
      phoneAgentVerbosity: string;
      phoneAgentVoicemailOverflowEnabled: boolean;
      provider: string;
    };
  };
  phoneSms: {
    configured: boolean;
    numbers: Array<{
      capabilities: {
        mms: boolean;
        sms: boolean;
        voice: boolean;
      };
      countryCode: string | null;
      currency: string;
      friendlyName: string | null;
      id: string;
      monthlyCostSnapshot: number;
      normalizedPhone: string | null;
      phoneNumber: string;
      providerPhoneNumberId: string | null;
      region: string | null;
      status: string;
      vapiPhoneNumberId: string | null;
    }>;
  };
  status: {
    connectedAccountCount: number;
    inboundDecisionCount: number;
    latestInboundDecision: {
      accountEmail: string | null;
      attachmentCount: number;
      category: string | null;
      conversationId: string | null;
      createdAt: string;
      fromEmail: string | null;
      id: string;
      processedAt: string | null;
      provider: string | null;
      providerUsed: string | null;
      reason: string | null;
      receivedAt: string | null;
      stage: string | null;
      status: string;
      subject: string;
      threadMatchStrategy: string | null;
    } | null;
    latestSync: {
      actorType: string;
      checkedConnections: number;
      createdAt: string;
      duplicates: number;
      errors: number;
      fetchedMessages: number;
      id: string;
      needsReconnect: number;
      observedMessages: number;
      promotedMessages: number;
      skippedBySchedule: number;
      trigger: string;
    } | null;
    reconnectNeededCount: number;
  };
  usage: {
    activeWindow: string;
    generatedAt: string;
    ledger: MobileUsageLedgerRow[];
    providerBreakdown: Array<{
      customerCharge: number;
      displayCustomerCharge: string;
      events: number;
      key: string;
      label: string;
      model: string;
      provider: string;
      service: string;
    }>;
    taskBreakdown: Array<{
      customerCharge: number;
      description: string;
      displayCustomerCharge: string;
      events: number;
      key: string;
      label: string;
    }>;
    totals: {
      currency: string;
      customerCharge: number;
      displayCustomerCharge: string;
      events: number;
      providerCost: number;
    };
    windows: string[];
  };
  user: {
    email: string | null;
    id: string;
  };
  workspace: WorkspaceSummary;
};

export type MobileVapiVoiceOption = {
  accent: string;
  id: string;
  label: string;
  voiceId: string;
};

export type MobileEmailSignatureSettings = {
  logoContentBase64: string;
  logoContentType: string;
  logoFilename: string;
  logoSizeBytes: number;
  logoUrl: string;
  logoWidthPx: number;
  text: string;
};

export type MobileInboundSenderRule = {
  action: string;
  createdAt?: string | null;
  createdFromEventId?: string | null;
  match: "email" | "domain";
  value: string;
};

export type MobileUsageLedgerRow = {
  createdAt: string;
  currency: string;
  customerCharge: number;
  displayCustomerCharge: string;
  id: string;
  model: string;
  provider: string;
  quantity: number;
  service: string;
  sourceLabel: string;
  sourceMeta: string | null;
  taskLabel: string;
  unit: string;
  userName: string;
};

export type MobileUsageLedgerResponse = {
  activeWindow: string;
  generatedAt: string;
  ledger: MobileUsageLedgerRow[];
  totals: MobileSettingsResponse["usage"]["totals"];
  windows: string[];
};

export type MobileWorkspaceToolOption = {
  description?: string;
  label: string;
  value: string;
};

export type MobileReportSummaryCard = {
  detail?: string;
  label: string;
  value: string;
};

export type MobileReportSection = {
  columns: string[];
  emptyText?: string;
  rows: string[][];
  title: string;
};

export type MobileReportPreview = {
  business?: {
    logoContentBase64?: string | null;
    logoContentType?: string | null;
    logoDataUrl?: string | null;
    logoUrl?: string | null;
    name: string;
  };
  filters?: Array<{ label: string; value: string }>;
  generatedAt: string;
  notes?: string[];
  period?: {
    end: string;
    label: string;
    start: string;
  };
  periodLabel: string;
  sections: MobileReportSection[];
  summaryCards: MobileReportSummaryCard[];
  subtitle: string;
  title: string;
  type: string;
};

export type MobileActivityLogItem = {
  at: string;
  detail: string;
  id: string;
  meta: string;
  title: string;
  tone:
    | "action"
    | "ai"
    | "audit"
    | "event"
    | "inbound"
    | "outbound"
    | "route"
    | "usage";
};

export type MobileDeveloperHealthCheck = {
  detail?: string;
  id: string;
  status: "error" | "ok" | "warning";
  summary: string;
  title: string;
};

export type MobileDeveloperTool = {
  detail: string;
  label: string;
  target?: string;
};

export type MobileOperationalLogItem = {
  at: string;
  detail: string;
  id: string;
  meta: string;
  status: string;
  title: string;
  type: "decision" | "event" | "message" | "sync";
};

export type MobileWorkspaceToolsResponse = {
  activity: {
    counts: Record<string, number>;
    filters: MobileWorkspaceToolOption[];
    items: MobileActivityLogItem[];
  };
  developer: {
    checks: MobileDeveloperHealthCheck[];
    tools: MobileDeveloperTool[];
  };
  developerAccess: {
    enabled: boolean;
    source: string;
  };
  operationalLogs: {
    filters: MobileWorkspaceToolOption[];
    inbound: MobileOperationalLogItem[];
    outbound: MobileOperationalLogItem[];
  };
  reports: {
    channels: MobileWorkspaceToolOption[];
    contacts?: MobileWorkspaceToolOption[];
    directions: MobileWorkspaceToolOption[];
    preview: MobileReportPreview;
    timeframes: MobileWorkspaceToolOption[];
    types: MobileWorkspaceToolOption[];
  };
  workspace: WorkspaceSummary;
};

export type MobileIntegrationOverview = {
  configured: boolean;
  encryptionReady: boolean;
  error: string | null;
  migrationReady: boolean;
  redirectUri: string | null;
  status: string;
};
