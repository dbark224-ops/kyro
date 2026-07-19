"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { developerAccessEnabled } from "../../lib/auth/developer-access";
import {
  ingestMockInboundEmail,
  type InboundEmailAttachment,
} from "../../lib/integrations/inbound-email-sync";
import { processInboundSmsPayload } from "../../lib/integrations/inbound-sms";
import { requireWorkspaceContext } from "../../lib/workspace/context";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function safeRedirectPath(value: string, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}

function redirectWithMessage(
  redirectTo: string,
  key: "engine_error" | "engine_message",
  message: string,
): never {
  const separator = redirectTo.includes("?") ? "&" : "?";
  redirect(`${redirectTo}${separator}${key}=${encodeURIComponent(message)}`);
}

function commaSeparatedValues(value: string) {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function attachmentMetadata(formData: FormData) {
  const filename = formString(formData, "attachmentFilename");

  if (!filename) {
    return [];
  }

  const parsedSize = Number(formString(formData, "attachmentSizeBytes"));

  return [
    {
      attachmentId: formString(formData, "attachmentId") || null,
      contentType: formString(formData, "attachmentContentType") || null,
      filename,
      isInline: false,
      partId: null,
      sizeBytes: Number.isFinite(parsedSize) && parsedSize >= 0 ? parsedSize : null,
    },
  ] satisfies Array<Omit<InboundEmailAttachment, "provider">>;
}

async function requireDeveloperWorkspace() {
  const context = await requireWorkspaceContext();

  if (!developerAccessEnabled(context.user)) {
    redirect("/");
  }

  return context;
}

function revalidateInboundViews() {
  revalidatePath("/developer");
  revalidatePath("/inbox");
  revalidatePath("/assistant");
  revalidatePath("/activity");
  revalidatePath("/contacts");
}

export async function createMockEmailInboundAction(formData: FormData) {
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    "/developer?mock=email",
  );
  const connectionId = formString(formData, "connectionId");
  const fromEmail = formString(formData, "fromEmail");
  const subject = formString(formData, "subject");
  const bodyText = formString(formData, "bodyText");

  if (!connectionId || !fromEmail || !subject || !bodyText) {
    redirectWithMessage(
      redirectTo,
      "engine_error",
      "Connected inbox, sender email, subject, and plain-text body are required.",
    );
  }

  const { supabase, user, workspace } = await requireDeveloperWorkspace();
  let duplicates = 0;
  let observedMessages = 0;
  let promotedMessages = 0;

  try {
    const result = await ingestMockInboundEmail({
      input: {
        attachments: attachmentMetadata(formData),
        automated: formData.get("automated") === "on",
        bodyHtml: formString(formData, "bodyHtml") || null,
        bodyText,
        connectionId,
        externalMessageId:
          formString(formData, "externalMessageId") ||
          formString(formData, "submissionKey"),
        externalThreadId: formString(formData, "externalThreadId") || null,
        fromEmail,
        fromName: formString(formData, "fromName") || null,
        headers: {
          "in-reply-to": formString(formData, "inReplyTo"),
          "message-id": formString(formData, "headerMessageId"),
          references: formString(formData, "references"),
        },
        providerMessageId: formString(formData, "providerMessageId") || null,
        receivedAt: formString(formData, "receivedAt") || null,
        snippet: formString(formData, "snippet") || null,
        subject,
        toEmails: commaSeparatedValues(formString(formData, "toEmails")),
      },
      supabase,
      user,
      workspaceId: workspace.id,
    });
    duplicates = result.duplicates;
    observedMessages = result.observedMessages;
    promotedMessages = result.promotedMessages;
  } catch (error) {
    redirectWithMessage(
      redirectTo,
      "engine_error",
      error instanceof Error ? error.message : "Unable to ingest mock email.",
    );
  }

  revalidateInboundViews();
  redirectWithMessage(
    redirectTo,
    "engine_message",
    duplicates
      ? "Duplicate mock email ignored."
      : promotedMessages
        ? "Mock email ingested through Kyro's email classifier and added to the work queue."
        : observedMessages
          ? "Mock email ingested and filtered into email awareness by the current inbox rules."
          : "Mock email ingested through the current inbox rules.",
  );
}

export async function createMockSmsInboundAction(formData: FormData) {
  const redirectTo = safeRedirectPath(
    formString(formData, "redirectTo"),
    "/developer?mock=sms",
  );
  const from = formString(formData, "from");
  const to = formString(formData, "to");
  const body = formString(formData, "body");
  const messageSid =
    formString(formData, "messageSid") ||
    formString(formData, "submissionKey");

  if (!from || !to || !body) {
    redirectWithMessage(
      redirectTo,
      "engine_error",
      "Twilio From, To, and Body fields are required.",
    );
  }

  const { supabase, workspace } = await requireDeveloperWorkspace();
  const { data: ownedNumber, error: numberError } = await supabase
    .from("workspace_phone_numbers")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("provider", "twilio")
    .eq("status", "active")
    .eq("phone_number", to)
    .limit(1)
    .maybeSingle();

  if (numberError || !ownedNumber) {
    redirectWithMessage(
      redirectTo,
      "engine_error",
      "Choose an active Kyro number assigned to this workspace.",
    );
  }

  let resultStatus:
    | "duplicate"
    | "external_inquiry"
    | "internal_message"
    | "opt_in"
    | "opt_out"
    | "unmatched_number" = "unmatched_number";

  try {
    const result = await processInboundSmsPayload({
      body,
      from,
      messageSid: messageSid || crypto.randomUUID(),
      to,
    });
    resultStatus = result.status;
  } catch (error) {
    redirectWithMessage(
      redirectTo,
      "engine_error",
      error instanceof Error ? error.message : "Unable to ingest mock SMS.",
    );
  }

  revalidateInboundViews();
  const message =
    resultStatus === "internal_message"
      ? "Mock SMS recognized as an internal user message and processed by the assistant."
      : resultStatus === "external_inquiry"
        ? "Mock SMS ingested as an external inquiry and queued for triage."
        : resultStatus === "opt_out"
          ? "Mock SMS processed as an opt-out command."
          : resultStatus === "opt_in"
            ? "Mock SMS processed as an opt-in command."
            : resultStatus === "duplicate"
              ? "Duplicate mock SMS ignored."
              : "Mock SMS did not match a workspace number.";

  redirectWithMessage(redirectTo, "engine_message", message);
}
