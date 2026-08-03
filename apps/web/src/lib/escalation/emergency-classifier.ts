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
  `Reply with JSON only: {"urgent": boolean, "trigger": one of ${CLASSIFIER_TRIGGERS.join("|")}, "quote": the customer's own words showing it, copied exactly, several words long}`,
  "The quote must be a span copied from their message. Do not summarise, tidy or translate it -- a quote that is not found in their message is discarded.",
  'When it is an ordinary enquiry, reply {"urgent": false, "trigger": "explicit_urgency", "quote": ""}.',
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
): Promise<EscalationModelSignal[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const message = customerMessage.trim();

  if (!apiKey || !message) {
    return [];
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
      return [];
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
    return [];
  }
}

/** Split out so the parsing is testable without a provider. */
export function signalsFromReply(text: string): EscalationModelSignal[] {
  const cleaned = text.replace(/```json|```/g, "").trim();

  if (!cleaned) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // A model that answers in prose has still not told us anything we may act
    // on, since the evidence check needs an exact quote.
    return [];
  }

  const record = objectRecord(parsed);

  if (record.urgent !== true) {
    return [];
  }

  const quote = textValue(record.quote);
  const trigger = textValue(record.trigger);

  if (!quote || !trigger) {
    return [];
  }

  return [{ evidence: quote, trigger }];
}
