import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGmailMessage } from "./gmail";
import { MICROSOFT_PROVIDER, MICROSOFT_SERVICE } from "./microsoft";
import { sendOutlookMessage } from "./outlook";
import type { EmailAttachment, EmailSendResult } from "./mail-types";

type ConnectedEmailProvider = {
  provider: string;
  service: string;
};

export type { EmailAttachment, EmailSendResult };

async function loadPreferredEmailProvider(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ConnectedEmailProvider> {
  const { data, error } = await supabase
    .from("integration_connections")
    .select("provider,service,last_connected_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .in("provider", ["google", MICROSOFT_PROVIDER])
    .order("last_connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load connected email provider: ${error.message}`);
  }

  if (!data) {
    throw new Error("Connect Gmail or Outlook in Settings before sending real email.");
  }

  return {
    provider: String(data.provider),
    service: String(data.service),
  };
}

export async function sendConnectedEmailMessage(
  supabase: SupabaseClient,
  input: {
    attachments?: EmailAttachment[];
    body: string;
    htmlBody?: string | null;
    subject: string;
    to: string;
    workspaceId: string;
  },
): Promise<EmailSendResult> {
  const provider = await loadPreferredEmailProvider(supabase, input.workspaceId);

  if (
    provider.provider === MICROSOFT_PROVIDER &&
    provider.service === MICROSOFT_SERVICE
  ) {
    return sendOutlookMessage(supabase, input);
  }

  return sendGmailMessage(supabase, input);
}
