/**
 * Whether a new enquiry is the same job as one already open.
 *
 * A customer who emails and then texts twenty minutes later, because they have
 * not heard back and they are worried, has one problem. Kyro was raising two
 * jobs for it and annotating the second as a possible duplicate, which left
 * the owner to work it out. Measured across the leads in this workspace: 27
 * contacts have more than one lead, and 31 consecutive pairs were raised
 * within half an hour of each other.
 *
 * The owner's decision was that this should be one job where Kyro can identify
 * it, and that one contact inside the window is one job even when the two
 * messages ask for different trades. A sole trader who does plumbing and
 * electrical does not want a customer split across two jobs on the same
 * afternoon; they want one visit, labelled with both. So the kind of work no
 * longer decides anything here -- it is accumulated onto the job instead, by
 * mergeTradeLabels below.
 *
 * That reverses an earlier rule, and measuring it is why. service_type is free
 * text an LLM writes fresh for each enquiry: production holds "Plumbing",
 * "Plumbing Repair", "Plumbing - Tap Repair" and "Plumbing Inspection And
 * Repairs" as four separate values. Comparing those as strings does not tell a
 * drain from a socket -- it tells one plumbing job from the same plumbing job
 * described a second time, and splits it.
 *
 * Time carries the decision now, and it still declines when unsure.
 */

/** Statuses that mean the job is finished, one way or the other. */
const SETTLED_STATUSES = new Set([
  "archived",
  "cancelled",
  "closed",
  "completed",
  "lost",
  "not_fit",
  "won",
]);

/**
 * Six hours, which covers the real pattern -- chasing the same problem on a
 * second channel the same day -- without reaching into tomorrow, when a second
 * message is more likely to be a second job. At 30 minutes it caught 31 of the
 * pairs in this workspace and at six hours 58; going out to 24 hours would add
 * only 13 more and start merging across days.
 */
export const SAME_JOB_WINDOW_MS = 6 * 60 * 60 * 1000;

export type OpenLead = {
  createdAt: string;
  id: string;
  serviceType?: string | null;
  status?: string | null;
  title: string;
};

export type SameJobInput = {
  /** True when contact resolution was not confident this is the same person. */
  hasProfileConflict?: boolean;
  now?: Date;
  openLead: OpenLead | null;
};

/** Trade labels are joined with this, so a job can carry more than one. */
export const TRADE_SEPARATOR = " + ";

/** Past this many trades the label stops being readable on a job card. */
const MAX_TRADE_LABELS = 4;

/** And past this many characters it stops fitting one. */
const MAX_TRADE_LABEL_LENGTH = 120;

/**
 * Comparable form of a trade label: case, punctuation and spacing removed.
 *
 * "Plumbing - Tap Repair" and "plumbing tap repair" are the same trade written
 * by the model twice, and the only thing separating them is formatting.
 */
function comparableTrade(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Whether two labels name the same work, allowing for one being more specific.
 *
 * Containment has to respect word boundaries or "Tiling" would swallow
 * "Retiling", which is a different job.
 */
function namesTheSameTrade(left: string, right: string) {
  const a = comparableTrade(left);
  const b = comparableTrade(right);

  if (!a || !b) {
    return false;
  }

  if (a === b) {
    return true;
  }

  const contains = (haystack: string, needle: string) =>
    haystack.startsWith(`${needle} `) ||
    haystack.endsWith(` ${needle}`) ||
    haystack.includes(` ${needle} `);

  return contains(a, b) || contains(b, a);
}

function splitTradeLabels(value: string | null | undefined) {
  return (value ?? "")
    .split(/\s*\+\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Add a trade to a job that may already name one.
 *
 * The owner's decision: one customer contacting twice about different work is
 * one job carrying both trades, not two jobs. A firm that does plumbing and
 * electrical wants "Plumbing + Electrical" on one visit.
 *
 * The awkward part is that these labels are free text from a model, so the
 * same trade arrives spelled four ways. Where one label already covers the
 * other this keeps the more specific of the two rather than listing both --
 * "Plumbing" then "Plumbing - Tap Repair" is one job, described better the
 * second time, and "Plumbing + Plumbing - Tap Repair" would read as two.
 *
 * Returns the existing label unchanged when the result would be too long or
 * too crowded to read, because a job card that says everything says nothing.
 */
export function mergeTradeLabels(
  existing: string | null | undefined,
  incoming: string | null | undefined,
) {
  const addition = (incoming ?? "").trim();
  const parts = splitTradeLabels(existing);
  const current = parts.length ? parts.join(TRADE_SEPARATOR) : null;

  if (!addition) {
    return current;
  }

  if (!parts.length) {
    return addition;
  }

  let absorbed = false;
  const merged = parts.map((part) => {
    if (!namesTheSameTrade(part, addition)) {
      return part;
    }

    absorbed = true;

    // Whichever names the work in more detail is the one worth keeping.
    return addition.length > part.length ? addition : part;
  });

  if (!absorbed) {
    if (merged.length >= MAX_TRADE_LABELS) {
      return current;
    }

    merged.push(addition);
  }

  const label = merged.join(TRADE_SEPARATOR);

  return label.length > MAX_TRADE_LABEL_LENGTH ? current : label;
}

export type SameJobDecision =
  | { attach: true; leadId: string; reason: string }
  | { attach: false; reason: string };

export function decideSameJob(input: SameJobInput): SameJobDecision {
  const { openLead } = input;

  if (!openLead) {
    return { attach: false, reason: "no open job for this contact" };
  }

  // Contact resolution was unsure this is even the same person. Merging two
  // people's jobs is the worst outcome available here.
  if (input.hasProfileConflict) {
    return { attach: false, reason: "contact profile match is unresolved" };
  }

  if (SETTLED_STATUSES.has((openLead.status ?? "").trim().toLowerCase())) {
    return { attach: false, reason: "the earlier job is already settled" };
  }

  const createdAt = Date.parse(openLead.createdAt);

  if (!Number.isFinite(createdAt)) {
    return { attach: false, reason: "the earlier job has no usable date" };
  }

  const now = (input.now ?? new Date()).getTime();
  const age = now - createdAt;

  // A lead dated in the future is a clock problem, not a duplicate.
  if (age < 0 || age > SAME_JOB_WINDOW_MS) {
    return { attach: false, reason: "the earlier job is outside the window" };
  }

  // The kind of work deliberately does not appear here. Two trades from one
  // customer within a few hours is one visit with two tasks on it, and the
  // labels are merged onto the job by mergeTradeLabels rather than used to
  // split it.
  return {
    attach: true,
    leadId: openLead.id,
    reason: "same contact, within hours",
  };
}

/** What to leave on the job so the owner can see why it has two threads. */
export function sameJobNote(channelLabel: string) {
  return `Also got in touch by ${channelLabel} about this -- same job, both threads attached`;
}
