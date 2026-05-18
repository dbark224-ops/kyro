import type { SupabaseClient } from "@supabase/supabase-js";
import { getConversationWorkflowCounts } from "../crm/queries";

export type AssistantRouteMetrics = {
  contactCount: number;
  needsReply: number;
  readyQuotes: number;
};

export async function getAssistantRouteMetrics(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AssistantRouteMetrics> {
  const [conversationCounts, readyQuotesResult, contactsResult] =
    await Promise.all([
      getConversationWorkflowCounts(supabase, workspaceId),
      supabase
        .from("quote_drafts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "ready"),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
    ]);

  if (readyQuotesResult.error) {
    throw new Error(
      `Unable to count ready quote drafts: ${readyQuotesResult.error.message}`,
    );
  }

  if (contactsResult.error) {
    throw new Error(
      `Unable to count contacts: ${contactsResult.error.message}`,
    );
  }

  return {
    contactCount: contactsResult.count ?? 0,
    needsReply: conversationCounts.needsReply,
    readyQuotes: readyQuotesResult.count ?? 0,
  };
}
