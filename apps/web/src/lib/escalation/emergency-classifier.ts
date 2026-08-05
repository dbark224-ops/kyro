import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAiProvider } from "../http/fetch-with-timeout";
import {
  buildLlmUsageEvents,
  openAiUsageFromResponse,
  recordUsageEvents,
} from "../usage/openai";
import { usageMarkupRate } from "../usage/pricing";
import { objectRecord, textValue } from "@kyro/core";
import type { EscalationModelSignal } from "./model-signals";

/**
 * One question, asked on its own: is this something the owner needs tonight?
 *
 * The keyword triggers catch 4 of 12 emergencies once they are written in
 * words nobody here chose -- a fusebox that banged leaving half a house dark,
 * sewage in the bath, an extractor smoking. That was measured, not guessed.
 *
 * The first attempt at closing it added an escalationSignals field to the big
 * triage schema, riding the call that already runs so it cost no round trip.
 * It returned an empty array for every one of those, and rewriting the prompt
 * changed nothing. Asked the same question on its own, with nothing else to
 * do, the same model got 5 of 5 and no false alarms on ordinary work. So the
 * failure was architectural: a secondary judgement bolted onto a large
 * multi-task schema gets ignored, because the model is busy doing the main job.
 *
 * Hence this. It buys one extra call per inquiry, on the cheap model, against
 * a few hundred characters -- the only per-message cost in the system, agreed
 * with the owner before it was built.
 *
 * IT MUST FAIL OPEN. This sits in the path every inquiry takes. A classifier
 * that is slow, rate-limited, or misconfigured must cost at most an escalation
 * that the keywords would have missed anyway; it must never cost the enquiry
 * itself. Every failure here returns no signal and says nothing.
 */

const CLASSIFIER_TRIGGERS = [
  "active_property_damage",
  "safety_risk",
  "essential_service_outage",
  "existing_job_serious_issue",
  "explicit_urgency",
] as const;

const INSTRUCTIONS = [
  "You screen messages for a sole trader running a plumbing and electrical business.",
  "Decide one thing only: is this something they would want to know about tonight, rather than tomorrow morning?",
  "That means water or sewage escaping, a smell of gas, anything burning, smoking or sparking, no power, no heat or no water, a structure moving or sagging, a vulnerable person left without something essential, an injury, or work of theirs that has failed.",
  "Getting it wrong is not symmetrical. A false alarm costs them a glance at their phone. A miss is somebody standing in a flooded kitchen who never reaches them. When it could reasonably be read either way, say yes.",
  "A quiet, polite message can still be an emergency. People understate, apologise for bothering you, and bury the serious part in the middle. Read what has happened, not how calmly it is written.",
  "Judge it as a tradesperson would, not as a call centre would.",
  `Reply with JSON only: {"urgent": boolean, "trigger": one of ${CLASSIFIER_TRIGGERS.join("|")}, "quote": the customer's own words showing it, copied exactly, several words long, "trade": the kind of work}`,
  "The quote must be a span copied from their message. Do not summarise, tidy or translate it -- a quote that is not found in their message is discarded.",
  'When it is an ordinary enquiry, reply {"urgent": false, "trigger": "explicit_urgency", "quote": ""} and still fill in the trade.',
  // The trade rides along here rather than costing a second call. Text
  // enquiries had no kind of work at all: inbound SMS wrote the literal string
  // "SMS" into that field, so all 97 were filed under the channel they arrived
  // on, and removing that left them empty. Email has always had this, from its
  // own classifier -- which is why email leads read Plumbing and Tiling while
  // every text read SMS.
  'The trade is a short noun phrase for the work itself, in title case, as a tradesperson would write it on a job sheet: "Plumbing - Tap Repair", "Bathroom Renovation", "Hot Water System Replacement", "Electrical - Fault Finding". Never the channel it arrived on, never the customer\'s name, never a whole sentence.',
  'Use null for the trade when the message is not about a job at all -- a supplier pitch, a wrong number, or somebody replying "thanks".',
].join("\n");

function openAiModel() {
  return (
    process.env.OPENAI_ESCALATION_MODEL?.trim() ||
    process.env.OPENAI_TRIAGE_MODEL?.trim() ||
    "gpt-4.1-mini"
  );
}

/**
 * Returns signals for the escalation detector, which checks the quote against
 * the customer's real message before believing any of it. Two independent
 * guards, because this one decides whether somebody's evening is interrupted.
 */
export async function classifyEmergency(
  customerMessage: string,
  meter?: {
    supabase: SupabaseClient;
    userId?: string | null;
    workspaceId: string;
  },
): Promise<ClassifiedMessage> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const message = customerMessage.trim();

  if (!apiKey || !message) {
    return EMPTY;
  }

  try {
    const response = await fetchAiProvider("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: message.slice(0, 4000),
        instructions: INSTRUCTIONS,
        model: openAiModel(),
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      return EMPTY;
    }

    const payload = objectRecord(await response.json());

    // Meter it. This call happens on every inquiry, so leaving it unrecorded
    // would recreate the exact fault fixed for Twilio tonight -- a real,
    // recurring cost the owner cannot see. Its own failures are swallowed: a
    // usage row is worth less than the enquiry it is attached to.
    if (meter) {
      try {
        await recordUsageEvents(meter.supabase, {
          context: "escalation:emergency_classifier",
          events: buildLlmUsageEvents({
            context: {
              metadata: { source: "emergency_classifier" },
              usageMarkupRate: usageMarkupRate("OPENAI_LLM_MARKUP_RATE"),
              userId: meter.userId ?? null,
              workspaceId: meter.workspaceId,
            },
            model: openAiModel(),
            usage: openAiUsageFromResponse(payload),
          }),
          userId: meter.userId ?? null,
          workspaceId: meter.workspaceId,
        });
      } catch {
        // Never let metering cost an escalation.
      }
    }

    const text = (Array.isArray(payload.output) ? payload.output : [])
      .flatMap((item) => {
        const content = objectRecord(item).content;
        return Array.isArray(content) ? content : [];
      })
      .map((part) => textValue(objectRecord(part).text) ?? "")
      .join("");

    return signalsFromReply(text);
  } catch {
    // Timeout, network, a provider having a bad day. The inquiry carries on
    // and the keywords still stand; this only ever adds.
    return EMPTY;
  }
}

export type ClassifiedMessage = {
  signals: EscalationModelSignal[];
  /** The kind of work, or null when the message is not about a job. */
  trade: string | null;
};

const EMPTY: ClassifiedMessage = { signals: [], trade: null };

/**
 * A trade long enough to be a trade and short enough not to be a sentence.
 *
 * Guards against the two ways this field has already been wrong: the channel
 * written in as "SMS", and a model answering with a whole description of the
 * job. Anything unreasonable is dropped rather than stored, because a blank
 * field is honest and a wrong one is not.
 */
function usableTrade(value: string | null) {
  const trade = (value ?? "").trim();

  if (!trade || trade.length > 60 || trade.split(/\s+/).length > 7) {
    return null;
  }

  // The exact fault being fixed. A model told to name the work should never
  // answer with how the message arrived.
  if (/^(sms|text|whatsapp|email|phone|call|voice|manual)$/i.test(trade)) {
    return null;
  }

  return trade;
}

/** Split out so the parsing is testable without a provider. */
export function signalsFromReply(text: string): ClassifiedMessage {
  const cleaned = text.replace(/```json|```/g, "").trim();

  if (!cleaned) {
    return EMPTY;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // A model that answers in prose has still not told us anything we may act
    // on, since the evidence check needs an exact quote.
    return EMPTY;
  }

  const record = objectRecord(parsed);
  const trade = usableTrade(textValue(record.trade));
  const quote = textValue(record.quote);
  const trigger = textValue(record.trigger);

  if (record.urgent !== true || !quote || !trigger) {
    // Not urgent, or urgent without usable evidence. The trade still stands --
    // most enquiries are ordinary, and those are exactly the ones whose kind
    // of work was going unrecorded.
    return { signals: [], trade };
  }

  return { signals: [{ evidence: quote, trigger }], trade };
}
