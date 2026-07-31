import { fetchWithTimeout } from "../http/fetch-with-timeout";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateOperatorAlert } from "../ai/customer-message-generation";
import { getPublicAppUrl } from "../app-url";
import {
  assertSmsSendAllowed,
  recordSmsRecipientPreference,
} from "../communication/sms-compliance";
import {
  smartQuotesToPlain,
  smsSegmentCount,
  splitIntoSmsMessages,
} from "../communication/sms-length";
import { normalizeContactPhoneForRegion } from "../crm/identity";
import { insertAuditLog } from "../engine/event-action-audit";
import { createVapiOutboundCall } from "../integrations/vapi";
import {
  getActiveWorkspaceSmsNumber,
  getTwilioConfig,
  sendTwilioSmsMessage,
  telephonyUsageCost,
  twilioMessageTransportForWorkspace,
  TWILIO_PROVIDER,
} from "../integrations/twilio";
import { resolveWorkspaceUsageMarkupRate } from "../usage/workspace-markup";
import {
  getWorkspaceGeneralSettings,
  type BusinessHoursScheduleSettings,
  type UrgentEscalationTriggerKey,
  type WorkplaceContactSettings,
  type WorkspaceGeneralSettings,
} from "../workspace/general-settings";
import { getVoiceSettings } from "../assistant/voice-settings";
import { objectRecord, textValue } from "@kyro/core";
import { writeOrThrow } from "../supabase/write";

type UrgentEscalationInput = {
  /**
   * Set only when `title` and `summary` are a person's own words.
   *
   * They used to win simply by being present, and every caller passes them --
   * they feed trigger detection and stand in when the model cannot be reached.
   * So a guard meant for "a human already said what this is" was tripped by
   * code-built strings on every single escalation, and the alert writer never
   * ran once. Presence is not authorship; this says so out loud.
   */
  alertAuthoredByPerson?: boolean;
  content: string;
  contactId?: string | null;
  conversationId?: string | null;
  existingCustomer?: boolean;
  leadId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  priority?: string | null;
  sourceId?: string | null;
  sourceKey: string;
  sourceType: "email" | "sms" | "voice_call" | "manual" | "system";
  /** Context and last-resort text, not the alert itself. See the flag above. */
  summary?: string | null;
  title?: string | null;
  vipCustomer?: boolean;
};

type EscalationStepRow = {
  attempt_count: number;
  channel: "email" | "app_notification" | "sms" | "phone";
  contact_snapshot: Record<string, unknown> | null;
  id: string;
  incident_id: string;
  max_attempts: number;
  position: number;
  workspace_id: string;
};

type EscalationIncidentRow = {
  acknowledgement_token: string;
  id: string;
  requires_acknowledgement: boolean;
  status: string;
  summary: string;
  title: string;
  workspace_id: string;
};

function boolValue(value: unknown) {
  return value === true || value === "true" || value === 1;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone,
    weekday: "long",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const hour = Number(values.hour) % 24;

  return {
    day: (values.weekday ?? "").toLowerCase(),
    minutes: hour * 60 + Number(values.minute ?? 0),
  };
}

function timeMinutes(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function inTimeWindow(minutes: number, start: number, end: number) {
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

function withinSchedule(
  schedule: BusinessHoursScheduleSettings,
  date: Date,
  timeZone: string,
) {
  const local = localDateParts(date, timeZone);
  const day = schedule.days.find((candidate) => candidate.day === local.day);
  const start = timeMinutes(day?.startTime);
  const end = timeMinutes(day?.endTime);

  return Boolean(
    day?.enabled &&
    start !== null &&
    end !== null &&
    inTimeWindow(local.minutes, start, end),
  );
}

function customHoursApply(settings: WorkspaceGeneralSettings, date: Date) {
  const escalation = settings.businessProfile.urgentEscalation;
  const local = localDateParts(date, settings.timeZone);
  const days = escalation.customDays.toLowerCase();
  const dayEnabled =
    days.includes("every day") ||
    days.includes(local.day) ||
    days.includes(local.day.slice(0, 3));
  const start = timeMinutes(escalation.customStartTime);
  const end = timeMinutes(escalation.customEndTime);

  return Boolean(
    dayEnabled &&
    start !== null &&
    end !== null &&
    inTimeWindow(local.minutes, start, end),
  );
}

function escalationHoursApply(settings: WorkspaceGeneralSettings, date: Date) {
  const mode = settings.businessProfile.urgentEscalation.hoursMode;
  const businessHours = withinSchedule(
    settings.businessProfile.workingHoursSchedule,
    date,
    settings.timeZone,
  );

  if (mode === "business_hours") {
    return businessHours;
  }

  if (mode === "after_hours") {
    return !businessHours;
  }

  if (mode === "custom") {
    return customHoursApply(settings, date);
  }

  return true;
}

/**
 * A negation immediately in front of a trigger word, and nothing looser.
 *
 * Deliberately tight. Suppressing a real emergency is far worse than sending
 * one alert too many, so this only fires when the negator is the word directly
 * before the keyword, optionally through one intensifier. "no water, urgent"
 * keeps its urgency because the comma is not crossed; "I don't think it's
 * urgent" keeps it too, because that is four words away and the reading is
 * genuinely ambiguous.
 */
const IMMEDIATE_NEGATION =
  /\b(?:no|not|non|never|nothing|isn'?t|aren'?t|wasn'?t|won'?t|don'?t|doesn'?t|didn'?t|can'?t|cannot|hardly|barely)\s+(?:particularly\s+|especially\s+|that\s+|too\s+|very\s+|really\s+|super\s+|so\s+|an?\s+)?$/;

/**
 * Whether the text mentions any of these words other than to deny them.
 *
 * A customer writing "no rush, not urgent" was escalated: `\burgent\b` matches
 * the word inside its own negation, so the classifier summarising an inquiry as
 * "No urgent deadline" was enough to text the owner, text them again fifteen
 * minutes later, and ring them at the hour. Saying a thing is not happening is
 * not a report that it is happening.
 *
 * The pattern must be global; each match is checked against what precedes it.
 */
/**
 * The thread a customer's reply quotes back is not something they just said.
 *
 * Reply to Kyro's email with "Thanks, Tuesday at 9 works fine" and the client
 * quotes the whole thread underneath -- including the original "burst pipe,
 * water pouring through the ceiling" and Kyro's own answer repeating it. Every
 * trigger read that as the message. Measured: those five words escalated on
 * explicit_urgency, active_property_damage and after_hours_emergency, waking
 * the owner at midnight over a job already booked. Written alone they escalate
 * on nothing.
 *
 * It is the same fault as escalating on Kyro's paraphrase, arriving by another
 * route: the trigger fires on words the customer did not just write. Left
 * alone, every reply in a thread re-escalates the original emergency for as
 * long as the thread lives.
 *
 * Removes structurally quoted material only -- `>` lines, the attribution line,
 * and forwarded-header blocks -- and never prose, so a reply written underneath
 * the quote survives. If stripping would leave nothing to judge, the original
 * is used instead: an unnecessary alert is a poor outcome, and a missed
 * emergency is a much worse one.
 */
export function withoutQuotedReply(text: string) {
  const kept: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    // Outlook's rule of underscores, and the forwarded-message banner, both
    // mean everything below is the older mail. These clients put the reply
    // above the divider, so nothing the customer just wrote lives past it --
    // and unlike an attribution line, the quoted body below carries no `>`
    // once the HTML has been flattened to text.
    if (
      /^_{10,}$/.test(trimmed) ||
      /^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}$/i.test(trimmed)
    ) {
      break;
    }

    // "On <date>, <person> wrote:", which clients wrap across two lines. Only
    // the attribution goes: a reply written underneath it must still be read.
    if (/^on\b.{0,200}\bwrote:$/i.test(trimmed) || /^wrote:$/i.test(trimmed)) {
      continue;
    }

    // A quoted header block, where a client gives no divider. "From:" is the
    // one header a customer does not write about themselves, so it marks the
    // block; the rest follow it and go with the cut.
    //
    // Dropping those others on sight was wrong and briefly shipped. Plenty of
    // people write a tidy, structured message -- Name, Address, Date, Subject,
    // Phone -- and an emergency stated on the "Subject:" line vanished with it,
    // escalating on nothing. Suppressing a real emergency is the worst outcome
    // available here, so only the block marker cuts.
    if (/^from:\s/i.test(trimmed)) {
      break;
    }

    if (trimmed.startsWith(">")) {
      continue;
    }

    kept.push(line);
  }

  const stripped = kept.join("\n");

  return stripped.trim().length >= 12 ? stripped : text;
}

function mentionsUnnegated(content: string, pattern: RegExp) {
  for (const match of content.matchAll(pattern)) {
    const before = content.slice(0, match.index);
    // Only within the same clause. A negation on the other side of a comma or
    // a full stop is about something else.
    const clause = before.slice(
      Math.max(
        before.lastIndexOf(","),
        before.lastIndexOf("."),
        before.lastIndexOf("!"),
        before.lastIndexOf("?"),
        before.lastIndexOf(";"),
        before.lastIndexOf("\n"),
      ) + 1,
    );

    if (!IMMEDIATE_NEGATION.test(clause)) {
      return true;
    }
  }

  return false;
}

export function detectUrgentEscalationTriggers(
  input: UrgentEscalationInput,
  options: { afterHours: boolean },
) {
  // Triggers are read from the customer's own words and nothing else.
  //
  // `title` and `summary` are both written by Kyro for display. Feeding them to
  // a keyword match let the model's choice of paraphrase decide whether the
  // owner got woken up: an inquiry whose author wrote that a tap "drips" and
  // who explicitly wanted the work spread over a year came back from the
  // classifier as "leaking taps ... an outside tap leak", and `\bleak\b`
  // escalated it as an after-hours emergency at midnight. The customer never
  // used the word.
  //
  // `content` is the real message at every call site -- subject and body for
  // email, the message for SMS, the call note for voice -- so dropping the
  // other two removes invented vocabulary without losing anything the customer
  // actually said. This replaces a narrower guard that excluded titles for
  // voice calls only, which was the same fault seen from one angle.
  const content = withoutQuotedReply(input.content).toLowerCase();
  const triggers = new Set<UrgentEscalationTriggerKey>();

  if (
    input.priority === "urgent" ||
    mentionsUnnegated(
      content,
      // The most-fired trigger in the system caught 3 of 11 ways of saying it.
      // The stand-out: it matched "asap" and not "as soon as possible", which
      // is the same words. Also missed "this can't wait", "straight away",
      // "right away" (it had "right now"), "please hurry", "we're desperate"
      // and "we need this sorted today".
      //
      // Everything here still passes through mentionsUnnegated, so "no rush",
      // "not urgent" and "no hurry" stay quiet -- verified, not assumed.
      // Re-measured against phrasings this comment was NOT written from, which
      // is the only honest version of the test. "Please treat this as a
      // priority" still missed.
      /\b(urgent|emergency|asap|as soon as possible|immediately|right now|right away|straight away|can'?t wait|cannot wait|desperate|hurry|same[- ]day critical|(?:sorted|fixed|done|out|come|someone) today|how (?:quickly|soon|fast)|(?:as a|top|high|utmost) priority|treat (?:this|it) as)\b/g,
    )
  ) {
    triggers.add("explicit_urgency");
  }

  if (
    mentionsUnnegated(
      content,
      // Word order was fixed: "burst pipe" matched and "a pipe has burst under
      // the sink" did not, which is how most people say the most classic
      // emergency there is. 2 of 8 real descriptions fired before this.
      // Re-measured on fresh phrasings and "the kitchen is flooded" did not
      // fire, which is about as plain as an emergency gets. `flood` and
      // `flooding` were both listed and neither matches "flooded", because the
      // trailing \b will not sit inside the word. "Soaking through" missed for
      // the same reason next to "soaked through".
      // "The flood last winter ruined the carpet, we replaced it since" is a
      // customer telling you why they want the work, not an emergency. Only
      // plainly historical markers are excluded: "flooded last night" is an
      // emergency and must keep firing, so "last" alone cannot disqualify.
      /\b(burst pipe|(?:pipe|main|cylinder|tank)s?\s+(?:has |have )?burst|burst (?:main|cylinder|tank)|flood(?:s|ed|ing)?\b(?!\s+(?:last\s+(?:winter|summer|spring|autumn|fall|year|month)|back in|in \d{4}|\d+\s+(?:years?|months?)\s+ago))|water(?:'s)?\s+(?:is\s+)?(?:pouring|gushing|pissing|spurting|streaming)|(?:pouring|gushing|pissing)\s+out|water (?:is )?(?:coming|running|leaking)\s+(?:through|down|into)|ceilings?\s+(?:has |have |is |are )?(?:come down|collapsed|fallen|bulg(?:ed|ing)|sagg(?:ed|ing))|(?:bulging|sagging) ceiling|water everywhere|water damage|soak(?:ed|ing) (?:through|into)|(?:carpet|floor|ceiling)s?\s+(?:is|are)\s+soaked|roof leak|ceiling leak|active leak|property damage)\b/g,
    )
  ) {
    triggers.add("active_property_damage");
  }

  if (
    mentionsUnnegated(
      content,
      // Gas is spelled out at length because it is the highest-consequence
      // trigger in the list and the original only matched "gas leak" and
      // "smell gas". A live SMS reading "Gas smell in the laundry near the hot
      // water unit" missed safety_risk entirely -- it escalated only because
      // the sender happened to also write "urgent". Somebody who is calm about
      // it would not have.
      // Same sweep as the others, and the worst results of any of them: 2 of 7.
      // "I got a shock off the shower switch" wanted the phrase "electric
      // shock". "sparks came out of the socket" wanted "sparking". "a burning
      // smell from the fuse box" matched neither "fire" nor "smoke". Each of
      // those is somebody describing a real electrical danger in the only way
      // they would think to describe it.
      /\b(gas leak|gas smell|gas odou?r|gas escape|smell(?:s|ing)?\s+(?:of\s+)?gas|electric shock|electrical danger|(?:got|had|getting)\s+(?:an?\s+)?(?:shock|belt|jolt|zap)|(?:shock|belt|jolt)\s+off|shocked me|spark(?:s|ed|ing)|burning smell|smell(?:s|ing)?\s+(?:of\s+)?burning|smell(?:s|ing)?\s+hot|overheating|exposed wire|bare wire|wire hanging|wire(?:s)? (?:is|are) exposed|wiring (?:is )?exposed|fire|smoke|injur(?:y|ed)|unsafe|collapse|live wire|carbon monoxide)\b/g,
    )
  ) {
    triggers.add("safety_risk");
  }

  if (
    input.existingCustomer &&
    // A returning customer is not the same thing as a returning customer with
    // a complaint, and only the second one is urgent. The owner's own words:
    // escalate a previous customer indicating an issue with their work, and
    // recognise a previous customer bringing more business without escalating
    // beyond normal.
    //
    // Matching any mention of past work could not tell those apart. "You
    // fitted our boiler and we're after a radiator now" -- a customer offering
    // more money -- escalated as a serious issue, because "you fitted" was
    // enough on its own.
    //
    // So a phrase that already states a fault fires alone, and a phrase that
    // merely refers to earlier work has to arrive with something wrong.
    (mentionsUnnegated(
      content,
      // Each of these says a fault by itself.
      /\b(failed again|has failed|came back|come back|causing damage|made it worse|(?:it|this)(?:'s| is) (?:got )?worse|worse (?:now|again)|still not right|not been fixed)\b/g,
    ) ||
      (mentionsUnnegated(
        content,
        // These only place the job in the past.
        // A trade does more verbs than "fix" and "install". "The drain you
        // cleared is blocked again" missed on the verb alone.
        /\b(your work|your repair|(?:work|job|repair|fix) you did|you (?:fixed|repaired|installed|fitted|cleared|unblocked|serviced|replaced|plumbed|wired|tiled|sealed|rewired)|previous job|last repair|warranty|you were (?:here|out)|(?:since|after) your visit)\b/g,
      ) &&
        mentionsUnnegated(
          content,
          /\b(fail(?:s|ed|ing)?|not right|not been fixed|broke(?:n)?|packed up|playing up|leak(?:s|ed|ing)?|drip(?:s|ped|ping)?|blocked|worse|damag(?:e|ed|ing)|fault|faulty|problem|issue|stopped|not working|does\s?n[o']?t work|wo\s?n[o']?t work|is back)\b/g,
        )))
  ) {
    triggers.add("existing_job_serious_issue");
  }

  if (
    mentionsUnnegated(
      content,
      // 4 of 8. A solicitor, a review and "extremely unhappy" are the three
      // most common ways this arrives and none of them matched.
      /\b(complaint|complain|refund|lawyer|solicitor|attorney|legal action|regulator|ombudsman|trading standards|bad review|leav(?:e|ing) (?:a|an)[^.]{0,12}review|write (?:a|an)[^.]{0,12}review|report you|(?:on|to) (?:google|trustpilot|checkatrade|yelp|facebook)|unacceptable|furious|(?:extremely|very|deeply|thoroughly) (?:unhappy|dissatisfied|disappointed)|never been treated|disgrace(?:ful)?|appalling|shoddy)\b/g,
    )
  ) {
    triggers.add("complaint_or_reputation_risk");
  }

  if (boolValue(input.metadata?.repeatContact)) {
    triggers.add("repeat_contact_short_window");
  }

  if (
    options.afterHours &&
    mentionsUnnegated(
      content,
      // "no power", "no heating" and "no hot water" are themselves the absence
      // of something, so they are matched before the negation check sees them
      // and are not treated as negated mentions of power or water.
      // Swept alongside the rest: 2 of 6 fired. It knew "no hot water" and not
      // "no water at all", knew "no heating" and not "the heating has packed
      // up", and had nothing for an overflowing toilet. Out of hours those are
      // exactly the calls that cannot wait until morning.
      /\b(urgent|emergency|asap|as soon as possible|burst|flood|leak|overflowing|no power|no electricity|no heating|no hot water|no water|(?:heating|boiler|water heater) (?:has )?(?:packed up|broken|failed|died|stopped)|locked out)\b/g,
    )
  ) {
    triggers.add("after_hours_emergency");
  }

  // The big jobs, in the words people use to describe them.
  //
  // This had fired once in 47 incidents. Measured against nine plainly
  // valuable leads, six missed -- "I manage 40 rental units and need a
  // contractor for all of them", "quote for the plumbing on a new build, 12
  // apartments", "we're a property management company looking for a regular
  // contractor", "annual maintenance contract for our three sites",
  // "fit-out for a new restaurant kitchen", "full refurbishment of the pub".
  // It wanted the literal phrase "commercial property" and missed every
  // description of scale.
  //
  // Seventh pattern tonight covering one wording and missing the rest of
  // English, and the only one that costs money rather than goodwill: a sole
  // trader who misses a forty-unit property manager has lost their best lead
  // of the year.
  //
  // A count needs three or more. "we have two bathrooms" is a house.
  if (
    /\b(commercial (?:job|project|property|premises|site|contract|work|client)|industrial (?:job|project|property|premises|site|unit)|insurance (?:claim|job|repair|work)|whole[- ]house (?:renovation|remodel|refurbishment)|full (?:home|house) (?:renovation|remodel|refurbishment)|emergency callout|large project|new[- ]?build|development site|fit[- ]?out|(?:maintenance|service) contract|regular (?:contractor|maintenance)|property (?:management|manager|portfolio)|letting agent|(?:\d{2,}|[3-9]) (?:rental )?(?:units?|properties|flats?|apartments?|sites?|premises)|(?:\d{2,}|[3-9])\s+(?:\w+\s+)?(?:buildings?|offices?)|refurbishment of|block of (?:\d+|\w+) (?:flats?|apartments?|units?)|(?:care|nursing|residential) home|(?:hotel|restaurant|cafe|pub|salon|surgery|practice|school|nursery|warehouse|office block)s?\b.{0,30}\b(?:contractor|quote|maintenance|refurb|fit[- ]?out|work|job)|(?:we|i) (?:run|own|manage|operate) (?:\d+|two|three|four|five|six|several|multiple) )\b/.test(
      content,
    )
  ) {
    triggers.add("high_value_lead");
  }

  if (
    /\b(no (?:hot water|heating|power|electricity)|power outage|locked out|cannot access|vulnerable (?:person|customer))\b/.test(
      content,
    )
  ) {
    triggers.add("essential_service_outage");
  }

  if (input.vipCustomer) {
    triggers.add("vip_customer");
  }

  if (
    input.sourceType === "voice_call" &&
    input.existingCustomer &&
    boolValue(input.metadata?.missedOrVoicemail)
  ) {
    triggers.add("missed_known_customer_call");
  }

  // Asking for the owner, in the ways people ask.
  //
  // The original matched "speak to the owner" and "owner to call" and little
  // else. Measured against ten natural phrasings, five missed: "speak WITH the
  // owner", "can the owner RING me", "get the owner to PHONE me", "put me
  // through to the manager", and "whoever runs the business". Same shape as
  // `can't` versus `cannot` -- one phrasing covered, the rest of English not.
  //
  // Kept away from "the owner of the property will be there", which is about a
  // third party and not a request, by requiring the owner word to sit against
  // a verb of asking or calling.
  if (
    // A third re-measurement, on phrasings neither comment was written from,
    // and three more missed. Two were grammar rather than vocabulary --
    // "speakING to the boss" where only "speak to" was covered -- and one was
    // "whoever's in charge", which the "person in charge" alternative looked
    // like it already handled and did not.
    /\b(?:speak|speaking|talk|talking)\s+(?:to|with)\s+(?:the\s+)?(?:owner|boss|gaffer|guv'?nor|manager|tradie|person in charge|whoever(?:'s| is)?\s+in\s+charge|whoever\s+(?:runs|owns))\b/.test(
      content,
    ) ||
    /\b(?:owner|boss|gaffer|guv'?nor|manager|tradie)\s+(?:to\s+)?(?:call|ring|phone|contact)\b/.test(
      content,
    ) ||
    /\b(?:call|ring|phone)\s+from\s+(?:the\s+)?(?:owner|boss|manager)\b/.test(
      content,
    ) ||
    /\bput\s+me\s+through\s+to\s+(?:the\s+)?(?:owner|boss|manager|tradie)\b/.test(
      content,
    ) ||
    /\b(?:speak|speaking|talk|talking)\s+(?:to|with)\s+whoever\b/.test(content) ||
    // Re-measured on phrasings the comment above was not written from, and
    // three more missed: "is the boss about?", "could the gaffer give me a
    // bell", "I'd rather deal with the person in charge". A trade customer
    // does not say "owner".
    /\b(?:is|are)\s+(?:the\s+)?(?:owner|boss|gaffer|guv'?nor|manager)\s+(?:about|around|there|in|available)\b/.test(
      content,
    ) ||
    /\b(?:owner|boss|gaffer|guv'?nor|manager)\s+(?:to\s+)?give me a (?:bell|call|ring)\b/.test(
      content,
    ) ||
    /\bdeal\s+with\s+(?:the\s+)?(?:owner|boss|gaffer|guv'?nor|manager|person in charge|whoever(?:'s| is)?\s+in\s+charge)\b/.test(
      content,
    )
  ) {
    triggers.add("asks_for_owner_now");
  }

  // A customer withdrawing is releasing the owner, not chasing them.
  //
  // repeat_contact_short_window counts inbound messages since the last
  // outbound and never reads them. Two messages with no answer is real
  // pressure -- but a customer whose second message is "actually, we've
  // decided not to go ahead, please cancel the enquiry" is the opposite of
  // pressure, and the alert opened "Urgent: I'll keep chasing until you reply."
  // Somebody asleep gets woken for a cancellation.
  //
  // Suppressed only when repeat contact is the ONLY reason to escalate. If the
  // message also reports a burst pipe or a gas smell, those triggers stand on
  // their own and the ladder still fires. That bound matters more than the
  // vocabulary below, because a wrong call here means an alert that never
  // arrives -- so the wording stays narrow and deliberately misses withdrawals
  // rather than risk catching somebody who is genuinely chasing.
  if (
    triggers.size === 1 &&
    triggers.has("repeat_contact_short_window") &&
    readsAsWithdrawal(content)
  ) {
    triggers.delete("repeat_contact_short_window");
  }

  return [...triggers];
}

/**
 * Whether a message is calling the work off.
 *
 * The vocabulary triage already had for this -- "not interested", "wrong
 * number", "not needed", "cancel", "do not contact" -- catches 2 of 10 natural
 * withdrawals. Sixth pattern tonight covering one phrasing and missing the
 * rest of English.
 *
 * "cancel" stays a bare verb on purpose. Matching "cancelled" as well would
 * catch "I need this cancelled appointment rebooked urgently", which is a
 * customer chasing hard, and suppress exactly the alert they need.
 */
export function readsAsWithdrawal(text: string) {
  const raw = text.toLowerCase();

  return [
    /\b(?:not interested|wrong number|not needed|do not contact|don'?t contact)\b/,
    /\bno longer\s+(?:need|require|want)\w*\b/,
    // "Cancel" needs an object. Written bare it also caught "can I cancel
    // Tuesday and come Wednesday instead?", which is a customer rearranging a
    // visit, not leaving -- and reading that as withdrawal is what silences
    // the escalation for somebody still waiting. An appointment is
    // deliberately not in this list for the same reason.
    /\bcancel\s+(?:my|our|the)\s+(?:enquiry|inquiry|request|quote|job|order)\b/,
    /\b(?:decided|going)\s+not\s+to\s+(?:go\s+ahead|proceed|bother)\b/,
    /\bnot\s+going\s+(?:to\s+)?(?:go\s+ahead|proceed|bother)\b/,
    /\b(?:leave|leaving)\s+it\s+(?:for\s+now|there|thanks)\b/,
    /\bsorted\s+it\s+(?:ourselves|myself|out)\b/,
    /\bgone\s+with\s+(?:someone|somebody|another)\b/,
    /\bdisregard\b/,
    // Both of these are withdrawals when the sentence ends there and something
    // else entirely when it carries on. "I never mind waiting but this is
    // three weeks now" is a complaint, and "we've had it done before by you"
    // is a returning customer. Anchoring to the end of the message keeps the
    // withdrawal and drops the passing mention. It costs the rarer phrasings
    // like "never mind then", which is the right way to be wrong here: a
    // withdrawal read as ordinary contact is one surplus alert, while ordinary
    // contact read as a withdrawal leaves somebody waiting in silence.
    /\bnever\s*mind\b\s*[.!,]?\s*$/,
    /\b(?:got|had)\s+it\s+(?:fixed|done|sorted)(?:\s+already)?\s*[.!,]?\s*$/,
    /\bfound\s+(?:someone|somebody)\s+else\b/,
    /\bchanged\s+(?:our|my)\s+mind\b/,
    /\bforget\s+it\b/,
    /\b(?:no\s+need|don'?t\s+need\s+it)\s+any\s*more\b/,
    /\bhold\s+off\b/,
    /\btake\s+(?:us|me)\s+off\s+the\s+job\b/,
  ].some((pattern) => pattern.test(raw));
}

async function ownerFallbackContact(
  supabase: SupabaseClient,
  settings: WorkspaceGeneralSettings,
  workspaceId: string,
) {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("owner_user_id")
    .eq("id", workspaceId)
    .maybeSingle();
  const ownerUserId = textValue(workspace?.owner_user_id);
  const owner = ownerUserId
    ? await supabase.auth.admin.getUserById(ownerUserId)
    : null;
  const metadata = owner?.data.user?.user_metadata ?? {};

  return {
    email:
      owner?.data.user?.email ?? settings.businessProfile.publicEmail ?? "",
    id: ownerUserId ?? "workspace-owner",
    name:
      textValue(metadata.name) ??
      textValue(metadata.full_name) ??
      "Workspace owner",
    phoneNumber:
      textValue(metadata.kyroMobileNumber) ??
      textValue(metadata.phone) ??
      settings.businessProfile.publicPhoneNumber,
    role: "Owner",
  };
}

function contactForStep(
  contacts: WorkplaceContactSettings[],
  contactId: string,
) {
  const eligible = contacts.filter((contact) => contact.receivesEscalations);
  const primary =
    contacts.find((contact) => contact.primaryEscalationContact) ??
    eligible[0] ??
    contacts[0];
  const fallback =
    eligible.find((contact) => contact.id !== primary?.id) ?? primary;

  if (contactId === "primary") {
    return primary;
  }

  if (contactId === "fallback") {
    return fallback;
  }

  return contacts.find((contact) => contact.id === contactId) ?? primary;
}

function contactSnapshot(
  contact: Partial<WorkplaceContactSettings> & { id?: string; name?: string },
  settings: WorkspaceGeneralSettings,
) {
  const rawPhone =
    textValue(contact.privatePhoneNumber) ?? textValue(contact.phoneNumber);

  return {
    email: textValue(contact.email),
    id: textValue(contact.id),
    name: textValue(contact.name) ?? "Escalation contact",
    phone: rawPhone
      ? (normalizeContactPhoneForRegion(
          rawPhone,
          settings.defaultPhoneRegion,
        ) ?? rawPhone)
      : null,
    role: textValue(contact.role),
  };
}

export async function createUrgentEscalationIncident(
  supabase: SupabaseClient,
  workspaceId: string,
  input: UrgentEscalationInput,
) {
  const settings = await getWorkspaceGeneralSettings(supabase, workspaceId);
  const policy = settings.businessProfile.urgentEscalation;
  const occurredAt = new Date(input.occurredAt ?? Date.now());

  if (!policy.enabled || !escalationHoursApply(settings, occurredAt)) {
    return { created: false, reason: "policy_inactive" } as const;
  }

  const businessHours = withinSchedule(
    settings.businessProfile.workingHoursSchedule,
    occurredAt,
    settings.timeZone,
  );
  const detected = detectUrgentEscalationTriggers(input, {
    afterHours: !businessHours,
  });
  const triggerKeys = detected.filter((key) =>
    policy.triggerKeys.includes(key),
  );

  if (triggerKeys.length === 0) {
    return { created: false, reason: "no_enabled_trigger" } as const;
  }

  const ownerFallback = await ownerFallbackContact(
    supabase,
    settings,
    workspaceId,
  );
  const sourceKey = input.sourceKey.slice(0, 400);
  const written = await writeEscalationAlert(supabase, workspaceId, {
    input,
    triggerKeys,
  });
  const { data: incident, error: incidentError } = await supabase
    .from("urgent_escalation_incidents")
    .insert({
      metadata: {
        // Who wrote the words the owner is about to read. Without it, telling a
        // model-written alert from the code fallback meant lining up ai_runs
        // timestamps by hand.
        alertGeneratedBy: written.generatedBy,
        ...("generationError" in written
          ? { alertGenerationError: written.generationError }
          : {}),
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        leadId: input.leadId ?? null,
        ...input.metadata,
      },
      occurred_at: occurredAt.toISOString(),
      policy_snapshot: policy,
      requires_acknowledgement: policy.requireAcknowledgement,
      source_id: input.sourceId ?? null,
      source_key: sourceKey,
      source_type: input.sourceType,
      summary: written.summary.slice(0, 1_500),
      title: written.title.slice(0, 240),
      trigger_keys: triggerKeys,
      workspace_id: workspaceId,
    })
    .select("id,acknowledgement_token")
    .single();

  if (incidentError) {
    if (incidentError.code === "23505") {
      const { data: existing } = await supabase
        .from("urgent_escalation_incidents")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", sourceKey)
        .maybeSingle();
      return {
        created: false,
        incidentId: existing?.id ? String(existing.id) : null,
        reason: "duplicate",
      } as const;
    }

    throw new Error(
      `Unable to create urgent escalation: ${incidentError.message}`,
    );
  }

  const steps = policy.steps.map((step, index) => {
    const configuredContact = contactForStep(
      settings.businessProfile.workplaceContacts,
      step.contactId,
    );
    const snapshot = contactSnapshot(
      configuredContact ?? ownerFallback,
      settings,
    );

    return {
      channel: step.channel,
      contact_id: snapshot.id,
      contact_snapshot: snapshot,
      due_at: new Date(
        occurredAt.getTime() + step.delayMinutes * 60_000,
      ).toISOString(),
      incident_id: incident.id,
      policy_step_id: step.id,
      position: index + 1,
      workspace_id: workspaceId,
    };
  });

  if (steps.length > 0) {
    const { error: stepsError } = await supabase
      .from("urgent_escalation_steps")
      .insert(steps);

    if (stepsError) {
      throw new Error(
        `Unable to schedule urgent escalation: ${stepsError.message}`,
      );
    }
  } else {
    await writeOrThrow(
      supabase
        .from("urgent_escalation_incidents")
        .update({ status: "exhausted" })
        .eq("id", incident.id),
      "Unable to mark the urgent escalation incident exhausted",
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "system",
    action: "urgent_escalation.triggered",
    entityType: "urgent_escalation_incident",
    entityId: String(incident.id),
    after: { sourceKey, stepCount: steps.length, triggerKeys },
  });

  return {
    acknowledgementToken: String(incident.acknowledgement_token),
    created: true,
    incidentId: String(incident.id),
    triggerKeys,
  } as const;
}

function acknowledgementUrl(token: string) {
  return `${getPublicAppUrl()}/api/escalations/acknowledge?token=${encodeURIComponent(token)}`;
}

/**
 * The alert the owner actually reads.
 *
 * The block header and the acknowledge line are structure, so they stay in
 * code. What goes between them is a judgement the old version could not make:
 * every escalation used the constant title "Urgent customer inquiry" and pasted
 * the customer's raw message underneath, up to 1,500 characters -- roughly ten
 * SMS segments of unreadable wall. Sometimes the exact words are the point
 * ("get this car off my nature strip"); usually "Anne in Bendigo wants a
 * bathroom quote" is more use at a glance. Only the model can tell those apart,
 * so it writes the title and the body and decides which this is.
 */
/**
 * Replying is how you acknowledge this, so that is what it asks for.
 *
 * It used to lead with an acknowledgement link, which was the only thing that
 * actually stopped the chain -- and nobody taps a link while driving to a job.
 * A reply now settles the incident, so the link is a fallback for anyone who
 * would rather open it, not the instruction.
 */
/**
 * Three texts before the split gives up, matching the inquiry alert.
 *
 * The alert body is prompted to stay under 300 characters and the header,
 * acknowledge line and link add roughly 150 more, so two is the usual answer
 * and the third is headroom. splitIntoSmsMessages never truncates -- the last
 * part absorbs any remainder -- so this bounds the count, not the content.
 */
const MAX_ESCALATION_SMS_PARTS = 3;

function escalationMessage(incident: EscalationIncidentRow) {
  return [
    `URGENT - ${incident.title}`,
    incident.summary,
    "Reply here and I'll stop escalating this.",
    `Or open it: ${acknowledgementUrl(incident.acknowledgement_token)}`,
  ].join("\n");
}

async function escalationAlertContext(
  supabase: SupabaseClient,
  workspaceId: string,
  input: UrgentEscalationInput,
) {
  if (!input.contactId) {
    return null;
  }

  const { data } = await supabase
    .from("contacts")
    .select("name,company,address,contact_type")
    .eq("workspace_id", workspaceId)
    .eq("id", input.contactId)
    .maybeSingle();

  return data
    ? {
        contactAddress: textValue(data.address),
        contactCompany: textValue(data.company),
        contactName: textValue(data.name),
        contactType: textValue(data.contact_type),
      }
    : null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid or nothing -- anything else fails the insert it is written into. */
function escalationAlertUserId(input: UrgentEscalationInput) {
  const candidate = textValue(input.metadata?.userId);

  return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
}

async function writeEscalationAlert(
  supabase: SupabaseClient,
  workspaceId: string,
  context: { input: UrgentEscalationInput; triggerKeys: string[] },
) {
  const { input, triggerKeys } = context;
  const explicitTitle = textValue(input.title);
  const explicitSummary = textValue(input.summary);

  // Nothing overrides a human who already said what this is -- but they have
  // to say they are one. This used to trigger on presence alone, and since all
  // three callers build these strings in code, the model below was unreachable.
  if (input.alertAuthoredByPerson && explicitTitle && explicitSummary) {
    return {
      generatedBy: "person" as const,
      summary: explicitSummary,
      title: explicitTitle,
    };
  }

  try {
    const contact = await escalationAlertContext(supabase, workspaceId, input);
    const written = await generateOperatorAlert({
      contextFacts: {
        ...contact,
        arrivedVia: input.sourceType,
        customerMessage: input.content,
        existingCustomer: input.existingCustomer ?? false,
        priority: input.priority ?? "normal",
        vipCustomer: input.vipCustomer ?? false,
        whyUrgent: triggerKeys,
      },
      purposeRules: [
        "This is an urgent alert about a customer message that needs the owner's attention now.",
        "The subject is a short label for the alert header, at most six words. It names the situation, not the customer's whole message.",
        "The body is one or two short lines. Say who it is and where they are when known, then what they want or what is wrong.",
        "Decide from context.customerMessage whether to quote the customer word for word or to summarise. Quote when the wording is the point; summarise a routine request.",
        "Keep the whole body under 300 characters. It is read on a phone as a text message.",
        "Do not add an acknowledgement link, a greeting, or a sign-off. Those are added around your text.",
      ],
      supabase,
      task: "Write the urgent escalation alert for the business owner.",
      taskType: "urgent_escalation_alert",
      // Null, never a sentinel. usage_events.user_id and ai_runs.user_id are
      // uuid columns, so "system" failed both inserts -- the alert would still
      // have been written, and its cost would have vanished. An escalation is
      // raised by a background sync with no user attached, and no caller sets
      // metadata.userId today; null is the honest answer rather than a string
      // the schema cannot hold.
      userId: escalationAlertUserId(input),
      workspaceId,
    });

    // The model's words win here. Falling back to explicitSummary at this
    // point would spend the call and then throw the result away -- the caller's
    // strings are the safety net below, not a preference.
    return {
      generatedBy: "model" as const,
      summary: written.body,
      title: written.subject,
    };
  } catch (error) {
    // An urgent escalation must never be lost because the model was
    // unavailable. This last resort is labelled facts rather than written
    // prose, and it is the only path that reaches the owner unwritten.
    console.warn("Urgent escalation alert generation failed", {
      error: error instanceof Error ? error.message : "unknown_error",
      workspaceId,
    });

    return {
      // Recorded on the incident, because "was this actually written by Kyro"
      // could previously only be answered by cross-referencing ai_runs
      // timestamps by hand -- which is how the alert writer went its entire
      // life without running and nobody noticed.
      generatedBy: "fallback" as const,
      generationError:
        error instanceof Error ? error.message : "unknown_error",
      summary: explicitSummary ?? input.content,
      title: explicitTitle ?? "Urgent customer inquiry",
    };
  }
}

async function sendEmailStep(
  incident: EscalationIncidentRow,
  contact: Record<string, unknown>,
) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const email = textValue(contact.email);

  if (!apiKey || !email) {
    throw new Error("Urgent escalation email recipient is not configured.");
  }

  const response = await fetchWithTimeout("https://api.resend.com/emails", {
    body: JSON.stringify({
      from:
        process.env.KYRO_ESCALATION_EMAIL_FROM?.trim() ||
        process.env.KYRO_AUTH_EMAIL_FROM?.trim() ||
        "Kyro <no-reply@mail.kyroassistant.com>",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px;margin:0 auto;padding:28px;"><p style="font-size:12px;font-weight:700;color:#dc2626;margin:0 0 8px;">URGENT ESCALATION</p><h1 style="font-size:22px;margin:0 0 14px;">${escapeHtml(incident.title)}</h1><p style="white-space:pre-wrap;">${escapeHtml(incident.summary)}</p><a href="${escapeHtml(acknowledgementUrl(incident.acknowledgement_token))}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:11px 16px;border-radius:6px;font-weight:700;">Acknowledge</a></div>`,
      subject: `Urgent Kyro escalation: ${incident.title}`,
      text: escalationMessage(incident),
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    throw new Error(
      textValue(payload.message) ?? `Resend returned HTTP ${response.status}.`,
    );
  }

  return { messageId: textValue(payload.id), requestId: null };
}

async function sendSmsStep(
  supabase: SupabaseClient,
  incident: EscalationIncidentRow,
  contact: Record<string, unknown>,
) {
  const phone = textValue(contact.phone);

  if (!phone) {
    throw new Error("Urgent escalation SMS recipient is not configured.");
  }

  await recordSmsRecipientPreference(supabase, {
    consentNote: "Configured workplace urgent escalation contact.",
    phoneNumber: phone,
    source: "urgent_escalation",
    status: "staff_internal",
    touch: "outbound",
    workspaceId: incident.workspace_id,
  });
  await assertSmsSendAllowed(supabase, {
    phoneNumber: phone,
    workspaceId: incident.workspace_id,
  });
  const workspaceNumber = await getActiveWorkspaceSmsNumber(
    supabase,
    incident.workspace_id,
  );
  const from =
    workspaceNumber?.phoneNumber ??
    getTwilioConfig()?.defaultFromNumber ??
    null;
  // Same routing the inbound-inquiry alert uses. Without it this went out as a
  // plain SMS from the workspace number, so on a workspace running through the
  // WhatsApp sandbox the alerts arrived and the escalations did not -- one path
  // had been taught about the sandbox and this one had not.
  const transport = twilioMessageTransportForWorkspace({
    recipientPhone: phone,
    workspaceId: incident.workspace_id,
  });
  const body = escalationMessage(incident);
  // WhatsApp takes 4096 characters in one message, so it goes whole. Plain SMS
  // does not, and this is the message that matters most: a carrier that will
  // not concatenate delivers the first segment and drops the rest, which on
  // this path means the owner reads "URGENT -" and never learns what for. The
  // inquiry alert was split for exactly this reason; this one was missed.
  // De-curled before splitting, same as the inquiry alert: one smart quote from
  // the model drops the whole message from GSM-7 to UCS-2 and halves the room
  // per segment, so it costs double and breaks in more places. The model writes
  // these now, so curly punctuation arrives routinely.
  const parts =
    transport === "sms"
      ? splitIntoSmsMessages(smartQuotesToPlain(body), MAX_ESCALATION_SMS_PARTS)
      : [body.trim()].filter(Boolean);
  const markupRate = await resolveWorkspaceUsageMarkupRate(
    supabase,
    incident.workspace_id,
    "TWILIO_MARKUP_RATE",
  );
  let first: Awaited<ReturnType<typeof sendTwilioSmsMessage>> | null = null;

  for (const [index, part] of parts.entries()) {
    let result: Awaited<ReturnType<typeof sendTwilioSmsMessage>>;

    try {
      result = await sendTwilioSmsMessage({
        body: part,
        from,
        to: phone,
        transport,
      });
    } catch (sendError) {
      // Only the first part failing means nothing reached the owner, so that
      // is the one worth throwing on: the step retries with backoff and
      // re-sends from the top. Throwing on a later part would re-send the
      // whole alert on retry and text the urgent header twice, which is worse
      // than a missing tail the owner can read behind the link.
      if (index === 0) {
        throw sendError;
      }

      console.error(
        `Urgent escalation SMS part ${index + 1} of ${parts.length} failed for incident ${incident.id}: ${
          sendError instanceof Error ? sendError.message : "unknown error"
        }`,
      );
      break;
    }

    first ??= result;

    // Escalation is the path that most often runs over the sandbox bridge, so
    // pricing it as SMS charged the workspace's own alert routing at long-code
    // rates and counted segments Twilio never billed. The transport is right
    // here and was simply not being asked.
    const overWhatsApp = transport !== "sms";
    const usage = telephonyUsageCost({
      direction: "outbound",
      kind: overWhatsApp ? "whatsapp" : "sms",
      markupRate,
      providerPrice: result.price,
      providerCurrency: result.priceUnit,
    });

    // A part is not a segment. Splitting sizes every part but the last to one
    // segment, and the last absorbs the remainder, so it can be several. The
    // carrier bills the segments either way, and recording one per part
    // undercounted the tail of every long alert.
    const segments = overWhatsApp ? 1 : Math.max(1, smsSegmentCount(part));
    const billedUnits = usage.source === "configured" ? segments : 1;

    // Billable, so a dropped insert is lost revenue -- the same silent path as
    // the AI and outbound usage writes. Reported rather than thrown: the SMS
    // has already gone out and failing here would not un-send it. One row per
    // part, because the carrier bills each one.
    const { error: usageError } = await supabase.from("usage_events").insert({
      cost_snapshot: String(usage.cost * billedUnits),
      currency: usage.currency,
      customer_charge_snapshot: String(usage.customerCharge * billedUnits),
      markup_snapshot: String(usage.markup),
      metadata: {
        incidentId: incident.id,
        ...(parts.length > 1
          ? { messagePart: index + 1, messageParts: parts.length }
          : {}),
        source: "urgent_escalation",
      },
      provider: TWILIO_PROVIDER,
      provider_usage_id: result.messageId,
      quantity: String(segments),
      service: "sms",
      source_id: incident.id,
      source_type: "urgent_escalation_incident",
      unit: overWhatsApp ? "message" : "segment",
      unit_cost_snapshot: String(usage.cost),
      usage_type: "outbound_sms",
      workspace_id: incident.workspace_id,
    });

    if (usageError) {
      console.error(
        `Unable to record urgent escalation SMS usage for incident ${incident.id}: ${usageError.message}`,
      );
    }
  }

  if (!first) {
    throw new Error("Urgent escalation SMS produced no message to send.");
  }

  // The step row holds one provider id, and the first part is the right one to
  // keep: it is what the owner replies to, and replies acknowledge by phone
  // number and open incident rather than by message id.
  return { messageId: first.messageId, requestId: first.providerRequestId };
}

async function escalationVapiPhoneNumberId(
  supabase: SupabaseClient,
  workspaceId: string,
  fallback: string | null,
) {
  if (fallback) {
    return fallback;
  }

  const { data } = await supabase
    .from("workspace_phone_numbers")
    .select("provider_phone_number_id,metadata")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("assigned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const metadata =
    data?.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};

  return (
    textValue(metadata.vapiPhoneNumberId) ??
    textValue(data?.provider_phone_number_id)
  );
}

/**
 * The in-app notification step.
 *
 * There is no message to push out here: the step row *is* the notification.
 * `getNotificationSummary` selects escalation steps with channel
 * "app_notification" and status "sent" whose incident is still open, and
 * renders each one in the notification bell with a link that acknowledges it.
 * Recording the step as sent is what publishes it.
 *
 * That is a real delivery, not a fake one -- which is why this is not the
 * throwing branch. I previously mistook the null provider id for "nobody was
 * contacted" and made this channel fail, which took the bell's escalation
 * notifications with it. A provider id is absent because the app is the
 * provider, not because nothing happened.
 *
 * The half that does not exist yet is mobile push. The Expo client in the
 * kyro-mobile repo is where that belongs -- it needs to register a device
 * token before this side has anywhere to send one. Until then this reaches
 * the owner only while they have the web app open, which is why it sits at
 * delay 0 alongside email, with SMS and a phone call escalating behind it.
 */
function sendAppNotificationStep() {
  return { messageId: null, requestId: null };
}

async function sendPhoneStep(
  supabase: SupabaseClient,
  incident: EscalationIncidentRow,
  contact: Record<string, unknown>,
) {
  const phone = textValue(contact.phone);
  const settings = await getVoiceSettings(supabase, incident.workspace_id);
  const assistantId = settings.vapiOutboundAssistantId;
  const phoneNumberId = await escalationVapiPhoneNumberId(
    supabase,
    incident.workspace_id,
    settings.vapiPhoneNumberId,
  );

  if (!phone || !assistantId || !phoneNumberId) {
    throw new Error(
      "Urgent escalation phone delivery is not fully configured.",
    );
  }

  const message = escalationMessage(incident);
  const result = await createVapiOutboundCall({
    assistantId,
    assistantOverrides: {
      variableValues: {
        call_instructions: `This is an internal urgent escalation. Explain this clearly and ask the recipient to acknowledge it: ${message}`,
        kyro_context: message,
      },
    },
    customerNumber: phone,
    metadata: {
      direction: "outbound",
      incidentId: incident.id,
      purpose: "urgent_escalation",
      workspaceId: incident.workspace_id,
    },
    phoneNumberId,
  });

  return { messageId: result.id, requestId: null };
}

async function finishIncidentIfExhausted(
  supabase: SupabaseClient,
  incidentId: string,
) {
  const { data } = await supabase
    .from("urgent_escalation_steps")
    .select("status")
    .eq("incident_id", incidentId);
  const statuses = (data ?? []).map((row) => String(row.status));

  if (
    statuses.length > 0 &&
    statuses.every((status) =>
      ["sent", "failed", "skipped", "cancelled"].includes(status),
    )
  ) {
    await writeOrThrow(
      supabase
        .from("urgent_escalation_incidents")
        .update({ status: "exhausted" })
        .eq("id", incidentId)
        .eq("status", "open"),
      "Unable to mark the urgent escalation incident exhausted",
    );
  }
}

async function processClaimedStep(
  supabase: SupabaseClient,
  step: EscalationStepRow,
) {
  const { data, error } = await supabase
    .from("urgent_escalation_incidents")
    .select(
      "id,workspace_id,title,summary,status,requires_acknowledgement,acknowledgement_token",
    )
    .eq("id", step.incident_id)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      `Unable to load escalation incident: ${error?.message ?? "not found"}`,
    );
  }

  const incident = data as EscalationIncidentRow;

  if (incident.status !== "open") {
    await writeOrThrow(
      supabase
        .from("urgent_escalation_steps")
        .update({ status: "cancelled" })
        .eq("id", step.id),
      "Unable to cancel the urgent escalation step",
    );
    return { cancelled: true, stepId: step.id };
  }

  const contact = step.contact_snapshot ?? {};
  const delivery =
    step.channel === "email"
      ? await sendEmailStep(incident, contact)
      : step.channel === "sms"
        ? await sendSmsStep(supabase, incident, contact)
        : step.channel === "phone"
          ? await sendPhoneStep(supabase, incident, contact)
          : step.channel === "app_notification"
            ? sendAppNotificationStep()
            : // Any channel with no delivery at all. Reporting "sent" for one of
              // those is worse than failing, because a failure hands on to the
              // next step while a false success quietly ends the chain.
              (() => {
                throw new Error(
                  `Escalation channel "${step.channel}" has no delivery method, so nobody was contacted.`,
                );
              })();

  await writeOrThrow(
    supabase
      .from("urgent_escalation_steps")
      .update({
        error: null,
        // Release the claim lease so a finished step is never reclaimed.
        lease_expires_at: null,
        provider_message_id: delivery.messageId,
        provider_request_id: delivery.requestId,
        sent_at: new Date().toISOString(),
        status: "sent",
      })
      .eq("id", step.id),
    "Unable to record urgent escalation step delivery",
  );
  await finishIncidentIfExhausted(supabase, step.incident_id);

  return { channel: step.channel, sent: true, stepId: step.id };
}

export async function processDueUrgentEscalations(
  supabase: SupabaseClient,
  options: { limit?: number } = {},
) {
  const { data, error } = await supabase.rpc(
    "claim_due_urgent_escalation_steps",
    { p_limit: Math.max(1, Math.min(options.limit ?? 50, 200)) },
  );

  if (error) {
    throw new Error(`Unable to claim urgent escalation work: ${error.message}`);
  }

  const results = [];

  for (const rawStep of (data ?? []) as EscalationStepRow[]) {
    try {
      results.push(await processClaimedStep(supabase, rawStep));
    } catch (stepError) {
      const terminal = rawStep.attempt_count >= rawStep.max_attempts;
      // Not thrown: the loop still has other steps to process, and stepError
      // below is the failure worth reporting. Losing this write would strand
      // the step holding its lease, which is what the lease expiry exists to
      // recover from -- but it should be visible when it happens.
      const { error: markStepError } = await supabase
        .from("urgent_escalation_steps")
        .update({
          due_at: terminal
            ? new Date().toISOString()
            : new Date(
                Date.now() +
                  Math.min(60, 5 * 2 ** rawStep.attempt_count) * 60_000,
              ).toISOString(),
          error:
            stepError instanceof Error
              ? stepError.message
              : "Urgent escalation delivery failed.",
          // Release the claim lease; the retry is scheduled by due_at above.
          lease_expires_at: null,
          status: terminal ? "failed" : "pending",
        })
        .eq("id", rawStep.id);

      if (markStepError) {
        console.error(
          `Unable to record urgent escalation step ${rawStep.id} failure, lease will expire instead: ${markStepError.message}`,
        );
      }
      await finishIncidentIfExhausted(supabase, rawStep.incident_id);
      results.push({
        error:
          stepError instanceof Error ? stepError.message : "Delivery failed.",
        sent: false,
        stepId: rawStep.id,
      });
    }
  }

  return results;
}

/**
 * Stop the chain once a human is engaged.
 *
 * Shared by both ways in: the acknowledgement link, and simply replying to the
 * message. Cancelling the pending steps is the whole point -- an acknowledged
 * incident that keeps phoning people is worse than one that never escalated.
 */
async function settleAcknowledgedIncident(
  supabase: SupabaseClient,
  incident: {
    id: unknown;
    metadata?: unknown;
    title: unknown;
    workspace_id: unknown;
  },
  input: { source: "reply" | "token"; userId?: string | null },
) {
  await writeOrThrow(
    supabase
      .from("urgent_escalation_steps")
      .update({ status: "cancelled" })
      .eq("incident_id", incident.id)
      .eq("status", "pending"),
    "Unable to cancel pending urgent escalation steps",
  );
  // On the incident as well as in the audit log.
  //
  // The audit log has carried this since the reply path was built, and it was
  // still impossible to answer "does replying actually work" without knowing to
  // join audit_logs on entity_id -- so the question got answered with a guess
  // instead. The row someone actually looks at should say how it was settled.
  const acknowledgedAt = new Date().toISOString();

  await writeOrThrow(
    supabase
      .from("urgent_escalation_incidents")
      .update({
        metadata: {
          ...objectRecord(incident.metadata),
          acknowledgedAt,
          acknowledgedVia: input.source,
        },
      })
      .eq("id", incident.id),
    "Unable to record how the escalation was acknowledged",
  );
  await insertAuditLog(supabase, {
    workspaceId: String(incident.workspace_id),
    actorType: input.userId ? "user" : "system",
    actorId: input.userId ?? undefined,
    action: "urgent_escalation.acknowledged",
    entityType: "urgent_escalation_incident",
    entityId: String(incident.id),
    after: { source: input.source, title: incident.title },
  });

  return {
    id: String(incident.id),
    title: String(incident.title),
    workspaceId: String(incident.workspace_id),
  };
}

export async function acknowledgeUrgentEscalation(
  supabase: SupabaseClient,
  input: { token: string; userId?: string | null },
) {
  const { data: incident, error } = await supabase
    .from("urgent_escalation_incidents")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_user_id: input.userId ?? null,
      status: "acknowledged",
    })
    .eq("acknowledgement_token", input.token)
    .eq("status", "open")
    .select("id,workspace_id,title,metadata")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to acknowledge escalation: ${error.message}`);
  }

  if (!incident) {
    return null;
  }

  return settleAcknowledgedIncident(supabase, incident, {
    source: "token",
    userId: input.userId,
  });
}

/** Last ten digits, so +1 505 555 0177 and 5055550177 are the same person. */
function samePhoneNumber(left: string | null | undefined, right: string) {
  const leftDigits = (left ?? "").replace(/\D/g, "").slice(-10);
  const rightDigits = right.replace(/\D/g, "").slice(-10);

  return Boolean(
    leftDigits &&
    rightDigits &&
    leftDigits.length >= 7 &&
    leftDigits === rightDigits,
  );
}

/**
 * How long after being escalated a reply still counts as acknowledgement.
 *
 * Long enough to cover a phone left in a pocket, short enough that tomorrow's
 * unrelated "morning" does not silently close last night's incident.
 */
const REPLY_ACKNOWLEDGEMENT_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Treat a reply from an escalated contact as acknowledgement.
 *
 * The escalation message used to carry a link, and tapping it was the only way
 * to stop the chain. Replying -- the obvious thing to do, and how every other
 * Kyro alert works -- did nothing, so the owner could answer in writing and
 * still get phoned about it minutes later.
 *
 * Any reply counts. The point is that a human is now engaged, not that they
 * have agreed to anything; requiring a particular word would be the same
 * mistake as telling people to text back "SEND IT".
 *
 * It matches on the incident being open and addressed to this person, not on
 * an escalation message having already gone out. Those are different moments,
 * and the gap between them is where this went wrong: an urgent inquiry raised
 * an incident and sent the ordinary new-inquiry alert eleven seconds later.
 * The owner answered that alert twice within three minutes -- and because no
 * escalation step had been sent yet, there was nothing for the reply to
 * attach to, so the escalation texted him anyway two minutes after he had
 * already dealt with it.
 */
export async function acknowledgeEscalationFromReply(
  supabase: SupabaseClient,
  input: { phoneNumber: string; userId?: string | null; workspaceId: string },
) {
  const since = new Date(
    Date.now() - REPLY_ACKNOWLEDGEMENT_WINDOW_MS,
  ).toISOString();
  const { data, error } = await supabase
    .from("urgent_escalation_incidents")
    .select("id,created_at,urgent_escalation_steps(contact_snapshot)")
    .eq("workspace_id", input.workspaceId)
    .eq("status", "open")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(
      `Unable to look for an escalation to acknowledge: ${error.message}`,
    );
  }

  // Phone formats vary between what was configured and what Twilio reports, so
  // this compares digits rather than asking the database for an exact match.
  const match = (data ?? []).find((incident) => {
    const steps = Array.isArray(incident.urgent_escalation_steps)
      ? incident.urgent_escalation_steps
      : [];

    return steps.some((step) =>
      samePhoneNumber(
        textValue(objectRecord(step.contact_snapshot).phone),
        input.phoneNumber,
      ),
    );
  });

  if (!match) {
    return null;
  }

  const { data: incident, error: incidentError } = await supabase
    .from("urgent_escalation_incidents")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by_user_id: input.userId ?? null,
      status: "acknowledged",
    })
    .eq("id", match.id)
    .eq("workspace_id", input.workspaceId)
    // Only an open incident. A second reply must not reopen or re-audit one
    // that is already settled.
    .eq("status", "open")
    .select("id,workspace_id,title,metadata")
    .maybeSingle();

  if (incidentError) {
    throw new Error(
      `Unable to acknowledge escalation from reply: ${incidentError.message}`,
    );
  }

  if (!incident) {
    return null;
  }

  return settleAcknowledgedIncident(supabase, incident, {
    source: "reply",
    userId: input.userId,
  });
}
