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
 * it. "Where it can identify it" is doing the work in that sentence, so the
 * rules here are deliberately narrow, and the asymmetry runs one way: two
 * entries for one job is untidy, while two jobs collapsed into one loses the
 * owner work they were going to be paid for. When unsure, this declines.
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
  incomingServiceType?: string | null;
  now?: Date;
  openLead: OpenLead | null;
};

function normalizedService(value: string | null | undefined) {
  const text = (value ?? "").trim().toLowerCase();

  return text ? text : null;
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

  const existingService = normalizedService(openLead.serviceType);
  const incomingService = normalizedService(input.incomingServiceType);

  // Two named trades that disagree are two jobs -- a blocked drain and a dead
  // socket on the same afternoon are not one visit. An unnamed one on either
  // side is not evidence of anything, so it does not block the match.
  if (existingService && incomingService && existingService !== incomingService) {
    return { attach: false, reason: "a different kind of work" };
  }

  return {
    attach: true,
    leadId: openLead.id,
    reason: "same contact, same kind of work, within hours",
  };
}

/** What to leave on the job so the owner can see why it has two threads. */
export function sameJobNote(channelLabel: string) {
  return `Also got in touch by ${channelLabel} about this -- same job, both threads attached`;
}
