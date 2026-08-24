import type { Correlation } from "../observability/correlation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { generateOperatorAlert } from "../ai/customer-message-generation";
import { customerAnswerableMissingInfo } from "../ai/triage";
import { getPublicAppUrl } from "../app-url";
import {
  appendRealtimeAssistantMessage,
  getOrCreateInternalMessagingThread,
} from "../assistant/persistence";
import { assertWorkspaceAutomationAllowed } from "../billing/access";
import { recordOutboundDirectSms } from "../communication/outbound";
import {
  smartQuotesToPlain,
  smsCharacterBudget,
  smsSegmentCount,
  splitIntoSmsMessages,
} from "../communication/sms-length";
import { normalizeContactPhoneForRegion } from "../crm/identity";
import {
  getActiveWorkspaceSmsNumber,
  getTwilioConfig,
  twilioMessageTransportForWorkspace,
} from "../integrations/twilio";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import { textValue } from "@kyro/core";

type InquiryNotificationOutcome = "booked" | "captured" | "proposed";

export type InquiryNotificationChannel =
  | "email"
  | "phone"
  | "sms"
  | "voicemail";

type InquiryNotificationInput = {
  autoReplySent?: boolean;
  channel?: InquiryNotificationChannel;
  contactName?: string | null;
  contactPhone?: string | null;
  conversationId?: string | null;
  /**
   * The inbound event this alert is about.
   *
   * Separate from `sourceId`, which is overloaded: the email path passes the
   * event id and the SMS path passes a Twilio message sid, so it cannot be
   * joined on. This one always means the same thing.
   */
  correlation?: Correlation | null;
  /**
   * Whether an urgent escalation is also running for this inquiry.
   *
   * The two alerts used to know nothing about each other: an urgent email
   * raised an incident and sent this ordinary alert eleven seconds later,
   * saying nothing about it. The owner answered, and was escalated at
   * anyway two minutes later.
   */
  escalationStarted?: boolean;
  eventLabel?: string | null;
  missingInfo?: string[];
  /**
   * The slot Kyro checked the calendar for and is proposing.
   *
   * Separate from preferredTime, which is the customer's own words. They used
   * to be the same field: the verified slot was written over the request, so
   * the owner could not see what had actually been asked for, and the answer
   * was later re-read as the question.
   */
  offeredTime?: string | null;
  outcome?: InquiryNotificationOutcome;
  ownerQuestion?: string | null;
  preferredTime?: string | null;
  preparedReplyAvailable?: boolean;
  /**
   * The drafted reply itself, not just whether one exists.
   *
   * The alert used to say only that a reply was ready, so approving it meant
   * approving something the owner had not read. The model summarises this the
   * same way it summarises the customer's message -- gist, not transcript.
   */
  preparedReplyBody?: string | null;
  /**
   * Leave the "Open in Kyro" line off, because the caller appends it itself.
   *
   * The footer has to be attached after the split, not inside the body, or the
   * splitter breaks at the space after the label and the owner gets one text
   * ending "Open in Kyro:" and another that is nothing but a URL.
   */
  omitLink?: boolean;
  providerCallId?: string | null;
  recommendedAction?: string | null;
  sourceId?: string | null;
  summary: string;
  supabase: SupabaseClient;
  voiceCallId?: string | null;
  workspaceId: string;
};

/**
 * Shorten to a whole word.
 *
 * This feeds the last-resort alert, and it cut wherever the character count
 * happened to land: an owner was told about "a slowly worsening damp patc...".
 * Losing the rest of a sentence is what a summary is for. Losing the rest of a
 * word just looks broken, and it was the tell that no model had written it.
 */
function compactText(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();

  if (clean.length <= maxLength) {
    return clean;
  }

  const cut = clean.slice(0, maxLength - 3);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

function samePhoneNumber(left: string | null, right: string) {
  const leftDigits = left?.replace(/\D/g, "") ?? "";
  const rightDigits = right.replace(/\D/g, "");

  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}

async function primaryNotificationRecipient(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  const [settings, workspaceResult] = await Promise.all([
    getWorkspaceGeneralSettings(supabase, workspaceId),
    supabase
      .from("workspaces")
      .select("name,owner_user_id")
      .eq("id", workspaceId)
      .maybeSingle(),
  ]);
  const contacts = settings.businessProfile.workplaceContacts;
  const configured =
    contacts.find((contact) => contact.primaryEscalationContact) ??
    contacts.find((contact) => contact.receivesEscalations) ??
    contacts[0] ??
    null;
  const configuredPhone = configured
    ? (textValue(configured.privatePhoneNumber) ??
      textValue(configured.phoneNumber))
    : null;

  if (configuredPhone) {
    return {
      contactId: configured?.id ?? null,
      name: textValue(configured?.name) ?? "Primary workplace contact",
      phoneNumber:
        normalizeContactPhoneForRegion(
          configuredPhone,
          settings.defaultPhoneRegion,
        ) ?? configuredPhone,
      userId: textValue(workspaceResult.data?.owner_user_id),
      workspaceName: textValue(workspaceResult.data?.name) ?? "Kyro workspace",
    };
  }

  const ownerUserId = textValue(workspaceResult.data?.owner_user_id);
  const owner = ownerUserId
    ? await supabase.auth.admin.getUserById(ownerUserId)
    : null;
  const metadata = owner?.data.user?.user_metadata ?? {};
  const ownerPhone =
    textValue(metadata.kyroMobileNumber) ??
    textValue(metadata.phone) ??
    textValue(settings.businessProfile.publicPhoneNumber);

  if (!ownerPhone) {
    return null;
  }

  return {
    contactId: null,
    name:
      textValue(metadata.first_name) ??
      textValue(metadata.name) ??
      textValue(metadata.full_name) ??
      "Workspace owner",
    phoneNumber:
      normalizeContactPhoneForRegion(ownerPhone, settings.defaultPhoneRegion) ??
      ownerPhone,
    userId: ownerUserId,
    workspaceName: textValue(workspaceResult.data?.name) ?? "Kyro workspace",
  };
}

function channelLabel(channel: InquiryNotificationChannel) {
  if (channel === "email") {
    return "email";
  }

  if (channel === "sms") {
    return "SMS";
  }

  if (channel === "voicemail") {
    return "voicemail";
  }

  return "phone";
}

export function buildInboundInquiryNotificationBody(
  input: Pick<
    InquiryNotificationInput,
    | "autoReplySent"
    | "channel"
    | "contactName"
    | "contactPhone"
    | "conversationId"
    | "eventLabel"
    | "missingInfo"
    | "offeredTime"
    | "omitLink"
    | "outcome"
    | "ownerQuestion"
    | "preferredTime"
    | "preparedReplyAvailable"
    | "recommendedAction"
    | "summary"
  >,
) {
  const caller = textValue(input.contactName) ?? "A new contact";
  const channel = input.channel ?? "phone";
  const outcome = input.outcome ?? "captured";
  // "Still needed" reads as things needed *from the customer*, and
  // notificationFactLabel phrases them that way. An owner-only entry listed
  // among them told the owner that "confirm this is a serviceable inquiry" was
  // outstanding from a customer who had just reported a failed repair.
  const missingInfo = customerAnswerableMissingInfo(
    [...new Set(input.missingInfo ?? [])]
      .map((item) => textValue(item))
      .filter((item): item is string => Boolean(item)),
  );
  const preferredTime = textValue(input.preferredTime);
  const offeredTime = textValue(input.offeredTime);
  const eventLabel = textValue(input.eventLabel);
  const modelRecommendation = textValue(input.recommendedAction);
  const ownerQuestion = textValue(input.ownerQuestion);
  if (ownerQuestion) {
    return [
      `New ${channelLabel(channel)} inquiry - ${caller}`,
      `Summary: ${compactText(input.summary, 190)}`,
      `I need from you: ${ownerQuestion}`,
      "Reply here with the answer and I'll finish the customer response.",
      textValue(input.contactPhone) ? `Call: ${input.contactPhone}` : null,
      input.omitLink
        ? null
        : `Open in Kyro: ${buildInboundInquiryLink(input.conversationId)}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }
  const contactPhone = textValue(input.contactPhone);

  // Facts only. The old version also offered advice here -- "Review the
  // prepared response and follow up while the inquiry is fresh" and four other
  // branches -- which was this file inventing a recommendation it was in no
  // position to make. Recommending is the model's job; this is the last resort
  // for when the model could not be reached, so it states what is known and
  // stops.
  return [
    `New ${channelLabel(channel)} inquiry - ${caller}`,
    `Summary: ${compactText(input.summary, 190)}`,
    modelRecommendation ? `Recommended: ${modelRecommendation}` : null,
    outcome === "booked" && eventLabel ? `Booked: ${eventLabel}` : null,
    // Both, when they differ. Which is the customer's and which is ours has to
    // survive into the fallback too, or the last-resort alert reintroduces the
    // confusion the fields were split up to remove.
    offeredTime ? `We can do: ${offeredTime}` : null,
    preferredTime && preferredTime !== offeredTime
      ? `They asked for: ${preferredTime}`
      : null,
    missingInfo.length > 0
      ? `Still needed: ${humanList(missingInfo.map(notificationFactLabel))}`
      : null,
    input.preparedReplyAvailable ? "A reply is drafted and ready." : null,
    contactPhone ? `Call: ${contactPhone}` : null,
    input.omitLink
      ? null
      : `Open in Kyro: ${buildInboundInquiryLink(input.conversationId)}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/**
 * The inbound-inquiry alert the owner reads.
 *
 * Same judgement as the urgent escalation: whether the customer's own words
 * belong in the text, or whether "someone in Bendigo wants a bathroom quote" is
 * more use. Code supplies the facts and the shape; the model writes it, and
 * decides what to recommend rather than picking from five sentences this file
 * used to hold.
 */
/**
 * Two SMS segments. Enough to name the customer, say what they want, summarise
 * the drafted reply and carry the link, without becoming something the owner
 * scrolls past on a job site.
 */
const INQUIRY_ALERT_CHARACTER_BUDGET = smsCharacterBudget(2);

/**
 * Three texts before the split gives up, matching the assistant.
 *
 * The brief asks for two. Past three the owner is being texted an essay and
 * the detail belongs behind the link the alert already carries.
 */
const MAX_NOTIFICATION_SMS_PARTS = 3;

/**
 * What the new-inquiry alert has to achieve, for the model to write from.
 *
 * Two of these earned their wording the hard way. The alert used to announce
 * that a reply was drafted without saying what it said, so approving it meant
 * approving something unread. And it told the owner to "reply SEND IT", which
 * was both restrictive and false -- nothing matches that phrase, the reply is
 * read by the assistant and any clear yes works.
 *
 * Exported so the rules can be asserted directly rather than inferred from a
 * model's output.
 */
export function inboundInquiryAlertRules(footerLength = 0) {
  // The link footer is added after the model writes, so it spends part of the
  // segment budget the model is being held to. Telling the model the full 306
  // would reliably produce a three-segment text.
  const bodyBudget = Math.max(
    120,
    INQUIRY_ALERT_CHARACTER_BUDGET - footerLength,
  );

  return [
    "This tells the business owner a new customer inquiry has arrived and what to do about it.",
    "A link to open the inquiry in Kyro is appended after you finish, so do not write a URL yourself and do not refer to a link, button or anything below your text.",
    // Two alerts about one inquiry, neither mentioning the other, is how the
    // owner ends up answering this one and being chased anyway. Replying to
    // this message does stop the escalation -- so say that, or he has no
    // reason to believe answering here was enough.
    "When context.escalationStarted is true, say plainly that this one is being treated as urgent and that you will keep chasing until someone responds, and that a reply to this message stops that. When it is false, do not mention escalation at all.",
    // An email whose signature carried a phone number got announced as "SMS
    // from ...". context.contactPhone sits next to arrivedVia, and a phone
    // number reads like a text message, so the channel has to be named as the
    // one fact it is rather than left to inference.
    "Open with the channel it came in on and who it is from. The channel is exactly context.arrivedVia -- never infer it from whether a phone number is present, and never call an email an SMS because the customer signed off with their number.",
    "Say what they want. Quote the customer only when their wording matters; otherwise summarise it in a few words.",
    // These were one field until they drifted apart in the worst way, so the
    // distinction is spelled out rather than left to the names.
    "context.preferredTimeCustomerAsked is the customer's own words about timing. context.offeredTimeKyroChecked is a slot Kyro verified against the calendar. Never present the offered slot as something the customer requested. When both exist and differ, it is worth saying so in a few words -- the owner may want to push back on the gap.",
    "If context.kyroQuestionForOwner is set, that question is the point of the message -- ask it plainly and say a reply here will be used to finish the customer response.",
    "If context.preparedReplyDraft is set, say in your own words what that reply would tell the customer, so they know what they are approving without having to open the app. Convey the gist, not the wording -- the same judgement you use on the customer's message.",
    "When a reply is drafted, invite them to confirm however they like. Do not instruct them to send a specific phrase; any clear yes will do, and they can also just tell you what to change.",
    "If Kyro already answered, say so and do not ask them to act.",
    "Include the customer's phone number only when the owner would plausibly call rather than open the app.",
    `Keep it under ${bodyBudget} characters. It is a text message read on a phone between jobs.`,
  ];
}

/**
 * Attach the link to the last part, or give it a part of its own with a label.
 *
 * The footer never goes through the splitter. Concatenated before the split it
 * broke at the space after "Open in Kyro:", so the owner received one text
 * ending in a dangling label and another containing nothing but a URL -- which
 * reads as spam and is exactly the shape carrier filtering looks for.
 *
 * A URL cannot be broken across two texts either: there is no whitespace inside
 * it, so a splitter given the whole thing has nowhere safe to cut.
 */
function withLinkFooter(parts: string[], footer: string) {
  if (parts.length === 0) {
    return [footer.trim()].filter(Boolean);
  }

  const last = parts[parts.length - 1];
  const combined = `${last}${footer}`;

  // One segment's worth of room is the test. If the link fits on the end of the
  // final part it belongs there; if not it gets its own message, still carrying
  // the label so it never arrives as an unexplained link.
  if (smsSegmentCount(combined) <= smsSegmentCount(last) + 1) {
    return [...parts.slice(0, -1), combined];
  }

  return [...parts, footer.trim()];
}

async function writeInboundInquiryNotification(
  input: InquiryNotificationInput,
  userId: string | null,
) {
  const kyroLink = buildInboundInquiryLink(input.conversationId);
  const linkFooter = `\nOpen in Kyro: ${kyroLink}`;

  try {
    const written = await generateOperatorAlert({
      correlation: {
        conversationId: input.conversationId,
        ...input.correlation,
      },
      contextFacts: {
        arrivedVia: input.channel ?? "phone",
        contactName: textValue(input.contactName),
        contactPhone: textValue(input.contactPhone),
        inquirySummary: input.summary,
        kyroQuestionForOwner: textValue(input.ownerQuestion),
        modelRecommendation: textValue(input.recommendedAction),
        escalationStarted: Boolean(input.escalationStarted),
        outcome: input.outcome ?? "captured",
        // Both, and clearly labelled. The owner is better served by "they
        // asked for Saturday, we can do Thursday 9am" than by either alone.
        offeredTimeKyroChecked: textValue(input.offeredTime),
        preferredTimeCustomerAsked: textValue(input.preferredTime),
        preparedReplyAvailable: Boolean(input.preparedReplyAvailable),
        preparedReplyDraft: textValue(input.preparedReplyBody),
        replyAlreadySent: Boolean(input.autoReplySent),
        scheduledFor: textValue(input.eventLabel),
        stillNeededFromCustomer: [...new Set(input.missingInfo ?? [])],
      },
      // Deliberately not mustInclude. Requiring the model to reproduce this
      // link verbatim means reproducing a 92-character URL ending in a UUID,
      // and one wrong character fails the check. Two failed attempts throw the
      // whole generation away and the alert silently falls back to the code
      // template -- which is what happened, and why an alert arrived reading
      // "a slowly worsening damp patc...", cut mid-word at 190 characters.
      //
      // The link is appended below instead. Writing a bare URL on its own line
      // is not the module writing prose; the sentence that matters is still
      // entirely the model's.
      mustInclude: [],
      purposeRules: inboundInquiryAlertRules(linkFooter.length),
      supabase: input.supabase,
      task: "Write the new-inquiry alert for the business owner.",
      taskType: "inbound_inquiry_notification",
      userId,
      workspaceId: input.workspaceId,
    });

    // The link is a footer, added after the model has written. Telling it
    // the link will be there stops it inventing its own or writing "click
    // the link below" about something it cannot see.
    // Returned apart from the body so the splitter can keep the label and the
    // URL together. Concatenated here, the split landed at the space after
    // "Open in Kyro:" and the owner received one text ending in a dangling
    // label and another containing nothing but a bare link -- which reads as
    // spam and is what carrier filtering looks for.
    return {
      body: written.body.trim(),
      footer: linkFooter,
      generatedBy: "model" as const,
    };
  } catch (error) {
    // Losing the alert is worse than sending a plain one, so this falls back
    // to labelled facts rather than dropping the notification.
    console.warn("Inbound inquiry notification generation failed", {
      error: error instanceof Error ? error.message : "unknown_error",
      workspaceId: input.workspaceId,
    });

    return {
      // Without its own link line, so the footer is attached the same way on
      // both paths and cannot end up duplicated or orphaned on one of them.
      body: buildInboundInquiryNotificationBody({
        ...input,
        omitLink: true,
      }),
      footer: linkFooter,
      // Stored on the outbound message. A fallback alert is indistinguishable
      // from a written one once it has been sent, which is how the truncated
      // "damp patc..." went out looking like something Kyro had composed.
      generatedBy: "fallback" as const,
      generationError:
        error instanceof Error ? error.message : "unknown_error",
    };
  }
}

function notificationFactLabel(value: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "preferred time") {
    return "a suitable day and time";
  }

  if (normalized === "job address") {
    return "the job address";
  }

  if (normalized === "phone number") {
    return "a callback number";
  }

  if (normalized === "email address") {
    return "an email address";
  }

  if (normalized === "job type") {
    return "the job details";
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}

function humanList(values: string[]) {
  if (values.length <= 1) {
    return values[0] ?? "the remaining details";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

export function buildInboundInquiryLink(conversationId?: string | null) {
  const query = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : "";

  return `${getPublicAppUrl()}/open/inbox${query}`;
}

async function saveInquiryBriefingToFieldThread(
  input: InquiryNotificationInput,
  recipient: {
    name: string;
    phoneNumber: string;
    userId: string | null;
    workspaceName: string;
  },
  body: string,
) {
  if (!recipient.userId || !input.conversationId) {
    // Nothing to attach the briefing to. Logged rather than returned quietly,
    // because the alert still goes out and invites a reply that will not find
    // any context to work from.
    console.error("Skipped saving inbound inquiry assistant context", {
      conversationId: input.conversationId ?? null,
      reason: recipient.userId
        ? "no conversation id"
        : "no notification recipient user id",
      workspaceId: input.workspaceId,
    });

    return;
  }

  /*
   * The thread and the message only ever read `user.id`.
   *
   * This used to call supabase.auth.admin.getUserById to obtain a full User,
   * which needs a service-role client -- and the notification path does not
   * have one, so it failed with "This endpoint requires a valid Bearer token"
   * on every inbound inquiry. The briefing was therefore never saved, and a
   * reply to the alert had no conversation to resolve against.
   *
   * The id is already in hand, so the round trip bought nothing but a
   * dependency on a client this path was never given.
   */
  const recipientUser = { id: recipient.userId } as User;
  const thread = await getOrCreateInternalMessagingThread(
    input.supabase,
    {
      id: input.workspaceId,
      name: recipient.workspaceName,
    },
    recipientUser,
    {
      displayName: recipient.name,
      senderPhone: recipient.phoneNumber,
    },
  );
  const contactName = textValue(input.contactName) ?? "New inquiry";

  await appendRealtimeAssistantMessage({
    content: body,
    intent: input.ownerQuestion ? "inquiry_owner_question" : "work_queue",
    links: [
      {
        href: `/inbox?conversationId=${encodeURIComponent(input.conversationId)}`,
        label: contactName,
        meta: "New inquiry",
      },
    ],
    model: "notification-template-v1",
    provider: "kyro",
    source: "assistant.inbound_inquiry_notification",
    supabase: input.supabase,
    threadId: String(thread.id),
    uiBlocks: [
      {
        items: [
          {
            detail: textValue(input.ownerQuestion) ?? "Prepared response ready",
            href: `/inbox?conversationId=${encodeURIComponent(input.conversationId)}`,
            id: input.conversationId,
            label: contactName,
            status: input.ownerQuestion ? "Needs your input" : "Needs review",
          },
        ],
        title: "New inquiry",
        type: "approval_queue",
      },
    ],
    user: recipientUser,
    workspaceId: input.workspaceId,
  });
}

async function recordNotificationEvent(
  input: InquiryNotificationInput,
  details: {
    error?: string | null;
    outboundQueueId?: string | null;
    providerMessageId?: string | null;
    reason?: string | null;
    recipientName?: string | null;
    status: "failed" | "processed";
    type: string;
  },
) {
  const channel = input.channel ?? "phone";
  const sourceId =
    textValue(input.sourceId) ??
    textValue(input.voiceCallId) ??
    textValue(input.providerCallId) ??
    textValue(input.conversationId) ??
    "unknown";
  const now = new Date().toISOString();
  const { error } = await input.supabase.from("events").insert({
    idempotency_key: `${details.type}.${channel}.${sourceId}`,
    payload: {
      channel,
      conversationId: input.conversationId ?? null,
      error: details.error ?? null,
      outboundQueueId: details.outboundQueueId ?? null,
      outcome: input.outcome ?? "captured",
      providerCallId: input.providerCallId ?? null,
      providerMessageId: details.providerMessageId ?? null,
      reason: details.reason ?? null,
      recipientName: details.recipientName ?? null,
      sourceId,
      voiceCallId: input.voiceCallId ?? null,
    },
    processed_at: now,
    source: "kyro.inbound_inquiry_notification",
    status: details.status,
    type: details.type,
    workspace_id: input.workspaceId,
  });

  if (error && error.code !== "23505") {
    throw new Error(
      `Unable to record inbound inquiry notification event: ${error.message}`,
    );
  }

  return error?.code !== "23505";
}

async function recordSkippedNotification(
  input: InquiryNotificationInput,
  reason: string,
) {
  await recordNotificationEvent(input, {
    reason,
    status: "processed",
    type: `notification.inbound_inquiry.skipped.${reason}`,
  });
}

export async function notifyInboundInquiry(input: InquiryNotificationInput) {
  await assertWorkspaceAutomationAllowed(input.workspaceId);
  const recipient = await primaryNotificationRecipient(
    input.supabase,
    input.workspaceId,
  );

  if (!recipient) {
    await recordSkippedNotification(input, "recipient_missing");
    return { notified: false, reason: "recipient_missing" } as const;
  }

  const workspaceNumber = await getActiveWorkspaceSmsNumber(
    input.supabase,
    input.workspaceId,
  );
  const from =
    workspaceNumber?.phoneNumber ??
    getTwilioConfig()?.defaultFromNumber ??
    null;

  if (samePhoneNumber(from, recipient.phoneNumber)) {
    await recordSkippedNotification(input, "recipient_is_workspace_number");
    return {
      notified: false,
      reason: "recipient_is_workspace_number",
    } as const;
  }

  if (!recipient.userId) {
    await recordSkippedNotification(input, "workspace_owner_missing");
    return { notified: false, reason: "workspace_owner_missing" } as const;
  }

  const channel = input.channel ?? "phone";
  const sourceId =
    textValue(input.sourceId) ??
    textValue(input.voiceCallId) ??
    textValue(input.providerCallId) ??
    textValue(input.conversationId) ??
    "unknown";
  let result: Awaited<ReturnType<typeof recordOutboundDirectSms>>;
  const written = await writeInboundInquiryNotification(
    input,
    recipient.userId,
  );
  const notificationBody = written.body;
  const transport = twilioMessageTransportForWorkspace({
    recipientPhone: recipient.phoneNumber,
    workspaceId: input.workspaceId,
  });

  // WhatsApp takes 4096 characters in one message, so it is left whole. Plain
  // SMS is not: this alert has run to 582 characters against a 306-character
  // brief, which is four segments, and a carrier that will not concatenate
  // them delivers the first one and drops the rest. The assistant's own texted
  // replies were split for exactly this reason; this path was missed.
  // One curly apostrophe costs double. GSM-7 packs 153 characters per
  // concatenated segment; a single character outside that alphabet drops the
  // whole message to UCS-2 and 67. A live alert reading "we'll keep chasing"
  // came to 365 characters and six segments where three would have done, and
  // split at 64 characters instead of 120 -- so it also arrived broken
  // mid-sentence. smartQuotesToPlain has existed for this since the length
  // helpers were written and was never once called.
  //
  // Before the split, not after: the split measures the text it is given, so
  // normalising afterwards would leave the segment count wrong anyway.
  // WhatsApp keeps the nicer typography -- 4096 characters in one message, so
  // the encoding buys nothing there.
  const parts = withLinkFooter(
    transport === "sms"
      ? splitIntoSmsMessages(
          smartQuotesToPlain(notificationBody),
          MAX_NOTIFICATION_SMS_PARTS,
        )
      : [notificationBody.trim()].filter(Boolean),
    written.footer,
  );

  try {
    // The first part goes first and carries the reply-event wiring, so replying
    // to the alert still lands on the right conversation.
    result = await recordOutboundDirectSms(input.supabase, {
      body: parts[0] ?? notificationBody,
      consentNote: "Primary workplace contact for inbound Kyro inquiries.",
      idempotencyKey: `inbound_inquiry_notification.${input.workspaceId}.${channel}.${sourceId}`,
      metadata: {
        conversationId: input.conversationId ?? null,
        // Whether Kyro wrote this or the code template did. Once sent the two
        // are indistinguishable, which is how a truncated fallback went out
        // reading like something the assistant had composed.
        generatedBy: written.generatedBy,
        ...("generationError" in written
          ? { generationError: written.generationError }
          : {}),
        inquiryChannel: channel,
        messageParts: parts.length,
        notificationType: "inbound_inquiry",
        outcome: input.outcome ?? "captured",
        providerCallId: input.providerCallId ?? null,
        sourceId,
        transport,
        voiceCallId: input.voiceCallId ?? null,
      },
      recipientName: recipient.name,
      recipientPhone: recipient.phoneNumber,
      replyEventPayload: {
        conversationId: input.conversationId ?? null,
        inquiryChannel: channel,
        outcome: input.outcome ?? "captured",
        providerCallId: input.providerCallId ?? null,
        sourceId,
        voiceCallId: input.voiceCallId ?? null,
      },
      replyEventType: "outbound.inbound_inquiry_notification.sent",
      source: "inbound_inquiry_notification",
      transport,
      userId: recipient.userId,
      workplaceContactId: recipient.contactId,
      workspaceId: input.workspaceId,
    });

    for (const [index, part] of parts.slice(1).entries()) {
      await recordOutboundDirectSms(input.supabase, {
        body: part,
        consentNote: "Primary workplace contact for inbound Kyro inquiries.",
        // Part index keeps each message distinct, so a retry still dedupes.
        idempotencyKey: `inbound_inquiry_notification.${input.workspaceId}.${channel}.${sourceId}.${index + 2}`,
        metadata: {
          conversationId: input.conversationId ?? null,
          inquiryChannel: channel,
          messagePart: index + 2,
          messageParts: parts.length,
          notificationType: "inbound_inquiry",
          sourceId,
          transport,
        },
        recipientName: recipient.name,
        recipientPhone: recipient.phoneNumber,
        source: "inbound_inquiry_notification",
        transport,
        userId: recipient.userId,
        workplaceContactId: recipient.contactId,
        workspaceId: input.workspaceId,
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown notification error";

    await recordNotificationEvent(input, {
      error: errorMessage,
      recipientName: recipient.name,
      status: "failed",
      type: "notification.inbound_inquiry.failed",
    });
    throw error;
  }

  const providerMessageId = result.externalMessageId ?? null;
  const recorded = await recordNotificationEvent(input, {
    outboundQueueId: result.outboundQueueId,
    providerMessageId,
    recipientName: recipient.name,
    status: "processed",
    type: "notification.inbound_inquiry.sent",
  });

  if (!recorded) {
    return { notified: false, reason: "duplicate" } as const;
  }

  await saveInquiryBriefingToFieldThread(
    input,
    recipient,
    notificationBody,
  ).catch((contextError) => {
    console.error("Unable to save inbound inquiry assistant context", {
      conversationId: input.conversationId,
      error:
        contextError instanceof Error
          ? contextError.message
          : "Unknown assistant context error",
      workspaceId: input.workspaceId,
    });
  });

  if (input.voiceCallId) {
    const { error: voiceEventError } = await input.supabase
      .from("voice_call_events")
      .insert({
        event_type: "notification.inbound_inquiry.sent",
        payload: {
          channel,
          conversationId: input.conversationId ?? null,
          outboundQueueId: result.outboundQueueId,
          outboxStatus: result.outboxStatus,
          outcome: input.outcome ?? "captured",
          providerCallId: input.providerCallId ?? null,
          providerMessageId,
          recipientName: recipient.name,
          sourceId,
        },
        provider: "kyro",
        voice_call_id: input.voiceCallId,
        workspace_id: input.workspaceId,
      });

    if (voiceEventError) {
      throw new Error(
        `Unable to record inbound voice notification: ${voiceEventError.message}`,
      );
    }
  }

  return {
    notified: true,
    outboundQueueId: result.outboundQueueId,
    providerMessageId,
  } as const;
}

export async function notifyInboundVoiceInquiry(
  input: Omit<InquiryNotificationInput, "channel">,
) {
  return notifyInboundInquiry({
    ...input,
    channel: "phone",
  });
}
