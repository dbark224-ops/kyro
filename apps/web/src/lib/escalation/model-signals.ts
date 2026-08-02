import type { UrgentEscalationTriggerKey } from "../workspace/general-settings";

/**
 * A second opinion on what the customer said, from the model, kept honest.
 *
 * Nine hand-written readers in this codebase were each measured against
 * phrasings their author had not chosen, and each scored around half -- after
 * every one had already been "fixed" once, and while passing its own tests.
 * Nine out of nine is not nine coincidences. Matching words has a ceiling, and
 * the escalation triggers sit above it: they decide whether somebody standing
 * in a flooded kitchen reaches the owner.
 *
 * The regex is NOT replaced. It is deterministic, free, instant, and it does
 * not have bad days -- it stays as the floor, and adding this cannot make it
 * worse. What this adds is a model reading the same message and saying what it
 * sees, riding on the triage call that already runs over every inquiry, so it
 * costs no extra round trip.
 *
 * The guard that makes it safe to trust:
 *
 * Kyro once escalated an inquiry at midnight because its own summary described
 * a tap that "drips" as "an outside tap leak", and the keyword matched a word
 * the customer never wrote. Letting a model raise triggers reopens exactly that
 * door -- so a signal is only accepted when the model quotes the customer, and
 * the quote is checked against the real message. A model that paraphrases,
 * embellishes, or invents an emergency is ignored, because its evidence will
 * not be found in what the customer actually typed.
 */

export type EscalationModelSignal = {
  /** The trigger the model believes applies. */
  trigger: string;
  /** The customer's own words that show it. Checked, not trusted. */
  evidence: string;
};

/**
 * Words as the comparison sees them: case, punctuation and runs of whitespace
 * all removed. A model that quotes accurately but re-punctuates should still
 * be believed; one that invents a phrase should not.
 */
function comparable(value: string) {
  return value
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Long enough that a match means something. "It" and "the leak" appear in
 * half the messages ever sent and would wave through any claim at all.
 */
const MIN_EVIDENCE_WORDS = 3;

export function evidenceIsFromCustomer(
  evidence: string,
  customerContent: string,
) {
  const quote = comparable(evidence);

  if (quote.split(" ").filter(Boolean).length < MIN_EVIDENCE_WORDS) {
    return false;
  }

  return comparable(customerContent).includes(quote);
}

/**
 * The triggers a model opinion may raise.
 *
 * Only the ones that read the message itself. `after_hours_emergency` and
 * `repeat_contact_short_window` are decided from the clock and the history, where
 * code is exact and a model would only add noise. `missed_known_customer_call`
 * and `vip_customer` come from call metadata and the CRM, not from words.
 */
const MODEL_READABLE: ReadonlySet<string> = new Set<UrgentEscalationTriggerKey>([
  "active_property_damage",
  "asks_for_owner_now",
  "complaint_or_reputation_risk",
  "existing_job_serious_issue",
  "explicit_urgency",
  "high_value_lead",
  "safety_risk",
  "essential_service_outage",
] as UrgentEscalationTriggerKey[]);

export type AcceptedSignals = {
  accepted: UrgentEscalationTriggerKey[];
  /** Kept for the audit trail: what was claimed and why it was not believed. */
  rejected: Array<{ trigger: string; evidence: string; reason: string }>;
};

export function acceptModelSignals(
  signals: readonly EscalationModelSignal[] | null | undefined,
  customerContent: string,
): AcceptedSignals {
  const accepted = new Set<UrgentEscalationTriggerKey>();
  const rejected: AcceptedSignals["rejected"] = [];

  for (const signal of signals ?? []) {
    const trigger = String(signal?.trigger ?? "").trim();
    const evidence = String(signal?.evidence ?? "");

    if (!MODEL_READABLE.has(trigger)) {
      rejected.push({
        evidence,
        reason: "not a trigger the model may raise from the message",
        trigger,
      });
      continue;
    }

    if (!evidenceIsFromCustomer(evidence, customerContent)) {
      // The midnight false alarm, prevented structurally rather than by asking
      // the model nicely.
      rejected.push({
        evidence,
        reason: "the quote is not in the customer's message",
        trigger,
      });
      continue;
    }

    accepted.add(trigger as UrgentEscalationTriggerKey);
  }

  return { accepted: [...accepted], rejected };
}
