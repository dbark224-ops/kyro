import type { Session } from "@supabase/supabase-js";

import { kyroApiFetch } from "./kyro-api";
import type {
  MobileAssistantPromptSuggestionsResponse,
  MobileAssistantState,
  MobileAssistantVapiSessionResponse,
  MobileBootstrapResponse,
  MobileCrmContactProfile,
  MobileCrmResponse,
  MobileDocumentsResponse,
  MobileFilePreviewResponse,
  MobileFilesResponse,
  MobileInboxConversationDetail,
  MobileInboxResponse,
  MobilePaymentsResponse,
  MobileQuoteDraftDetailResponse,
  MobileSettingsResponse,
  MobileUsageLedgerResponse,
  MobileWorkspaceToolsResponse
} from "./mobile-api-types";

export const mobileQueryStaleTime = {
  assistant: 20 * 1000,
  assistantPromptSuggestions: 60 * 60 * 1000,
  assistantVapiSession: 30 * 1000,
  crm: 2 * 60 * 1000,
  crmContact: 2 * 60 * 1000,
  dashboard: 60 * 1000,
  documents: 60 * 1000,
  filePreview: Infinity,
  files: 60 * 1000,
  inbox: 60 * 1000,
  inboxConversation: 60 * 1000,
  payments: 60 * 1000,
  settings: 2 * 60 * 1000,
  usageLedger: 60 * 1000,
  workspaceTools: 60 * 1000
} as const;

export const mobileQueryGcTime = 30 * 60 * 1000;

export const mobileQueryKeys = {
  assistant: (userId?: string | null) => ["mobile-assistant", userId] as const,
  assistantPromptSuggestions: (userId?: string | null) =>
    ["mobile-assistant-prompt-suggestions", userId] as const,
  assistantVapiSession: (userId?: string | null) =>
    ["mobile-assistant-vapi-session", userId] as const,
  crm: (userId?: string | null) => ["mobile-crm", userId] as const,
  crmContact: (userId?: string | null, contactId?: string | null) =>
    ["mobile-crm-contact", userId, contactId] as const,
  dashboard: (userId?: string | null) =>
    ["mobile-bootstrap", userId] as const,
  documents: (userId?: string | null) => ["mobile-documents", userId] as const,
  documentQuote: (userId?: string | null, quoteDraftId?: string | null) =>
    ["mobile-document-quote", userId, quoteDraftId] as const,
  filePreview: (fileId?: string | null) =>
    ["mobile-file-preview", fileId] as const,
  files: (userId?: string | null) => ["mobile-files", userId] as const,
  inbox: (userId?: string | null) => ["mobile-inbox", userId] as const,
  inboxConversation: (
    userId?: string | null,
    conversationId?: string | null
  ) => ["mobile-inbox-conversation", userId, conversationId] as const,
  payments: (userId?: string | null) => ["mobile-payments", userId] as const,
  settings: (userId?: string | null) => ["mobile-settings", userId] as const,
  usageLedger: (userId?: string | null, usageWindow?: string | null) =>
    ["mobile-usage-ledger", userId, usageWindow] as const,
  workspaceTools: (userId?: string | null) =>
    ["mobile-workspace-tools", userId] as const
};

export function mobileAssistantQueryOptions(session?: Session | null) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileAssistantState>("/api/mobile/assistant", { session }),
    queryKey: mobileQueryKeys.assistant(session?.user.id),
    staleTime: mobileQueryStaleTime.assistant
  };
}

export function mobileAssistantPromptSuggestionsQueryOptions(
  session?: Session | null
) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileAssistantPromptSuggestionsResponse>(
        "/api/assistant/suggestions",
        { session }
      ).then((response) => response.data),
    queryKey: mobileQueryKeys.assistantPromptSuggestions(session?.user.id),
    retry: false,
    staleTime: mobileQueryStaleTime.assistantPromptSuggestions
  };
}

export function mobileAssistantVapiSessionQueryOptions(
  session?: Session | null
) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileAssistantVapiSessionResponse>(
        "/api/mobile/assistant/vapi-session",
        { session }
      ),
    queryKey: mobileQueryKeys.assistantVapiSession(session?.user.id),
    staleTime: mobileQueryStaleTime.assistantVapiSession
  };
}

export function mobileCrmQueryOptions(session?: Session | null) {
  return {
    queryFn: () => kyroApiFetch<MobileCrmResponse>("/api/mobile/crm", { session }),
    queryKey: mobileQueryKeys.crm(session?.user.id),
    staleTime: mobileQueryStaleTime.crm
  };
}

export function mobileCrmContactQueryOptions(
  session?: Session | null,
  contactId?: string | null
) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileCrmContactProfile>(`/api/mobile/crm/${contactId}`, {
        session
      }),
    queryKey: mobileQueryKeys.crmContact(session?.user.id, contactId),
    staleTime: mobileQueryStaleTime.crmContact
  };
}

export function mobileDashboardQueryOptions(session?: Session | null) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileBootstrapResponse>("/api/mobile/bootstrap", {
        session
      }),
    queryKey: mobileQueryKeys.dashboard(session?.user.id),
    staleTime: mobileQueryStaleTime.dashboard
  };
}

export function mobileFilePreviewQueryOptions(
  session?: Session | null,
  fileId?: string | null
) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileFilePreviewResponse>("/api/mobile/file-preview", {
        query: { fileId },
        session
      }),
    queryKey: mobileQueryKeys.filePreview(fileId),
    staleTime: mobileQueryStaleTime.filePreview
  };
}

export function mobileDocumentsQueryOptions(session?: Session | null) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileDocumentsResponse>("/api/mobile/documents", {
        session
      }),
    queryKey: mobileQueryKeys.documents(session?.user.id),
    staleTime: mobileQueryStaleTime.documents
  };
}

export function mobileDocumentQuoteQueryOptions(
  session?: Session | null,
  quoteDraftId?: string | null
) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileQuoteDraftDetailResponse>(
        `/api/mobile/documents/${quoteDraftId}`,
        { session }
      ),
    queryKey: mobileQueryKeys.documentQuote(session?.user.id, quoteDraftId),
    staleTime: mobileQueryStaleTime.documents
  };
}

export function mobileFilesQueryOptions(session?: Session | null) {
  return {
    queryFn: () => kyroApiFetch<MobileFilesResponse>("/api/mobile/files", { session }),
    queryKey: mobileQueryKeys.files(session?.user.id),
    staleTime: mobileQueryStaleTime.files
  };
}

export function mobileInboxQueryOptions(session?: Session | null) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileInboxResponse>("/api/mobile/inbox", { session }),
    queryKey: mobileQueryKeys.inbox(session?.user.id),
    staleTime: mobileQueryStaleTime.inbox
  };
}

export function mobileInboxConversationQueryOptions(
  session?: Session | null,
  conversationId?: string | null
) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileInboxConversationDetail>(
        `/api/mobile/inbox/${conversationId}`,
        { session }
      ),
    queryKey: mobileQueryKeys.inboxConversation(
      session?.user.id,
      conversationId
    ),
    staleTime: mobileQueryStaleTime.inboxConversation
  };
}

export function mobilePaymentsQueryOptions(session?: Session | null) {
  return {
    queryFn: () =>
      kyroApiFetch<MobilePaymentsResponse>("/api/mobile/payments", {
        session
      }),
    queryKey: mobileQueryKeys.payments(session?.user.id),
    staleTime: mobileQueryStaleTime.payments
  };
}

export function mobileSettingsQueryOptions(session?: Session | null) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileSettingsResponse>("/api/mobile/settings", { session }),
    queryKey: mobileQueryKeys.settings(session?.user.id),
    staleTime: mobileQueryStaleTime.settings
  };
}

export function mobileUsageLedgerQueryOptions(
  session?: Session | null,
  usageWindow?: string | null
) {
  return {
    enabled: Boolean(session),
    queryFn: () =>
      kyroApiFetch<MobileUsageLedgerResponse>("/api/mobile/usage-ledger", {
        query: { usageWindow },
        session
      }),
    queryKey: mobileQueryKeys.usageLedger(session?.user.id, usageWindow),
    staleTime: mobileQueryStaleTime.usageLedger
  };
}

export function mobileWorkspaceToolsQueryOptions(session?: Session | null) {
  return {
    queryFn: () =>
      kyroApiFetch<MobileWorkspaceToolsResponse>("/api/mobile/workspace-tools", {
        session
      }),
    queryKey: mobileQueryKeys.workspaceTools(session?.user.id),
    staleTime: mobileQueryStaleTime.workspaceTools
  };
}
