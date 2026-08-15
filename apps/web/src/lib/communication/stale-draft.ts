import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a drafted reply has outlived the thing it says.
 *
 * A draft is a snapshot of what was true when it was written. Kyro writes one,
 * the owner approves it later, and executeDraftReplyAction sends the body
 * verbatim -- no age check, no date re-validation, no calendar re-check. So a
 * draft written six weeks ago offering "Tuesday morning" sends exactly that,
 * and nobody did anything wrong. Conduct rule 1: never state a time the
 * calendar has not agreed to.
 *
 * Measured across the 393 drafts sitting in pending_approval: 103 carry
 * concrete dated content -- 69 name a weekday, 78 give a clock time, 22 say
 * today or tomorrow or this week. The oldest was ten weeks old.
 *
 * THIS ONLY WARNS. It does not cancel, expire, or regenerate anything. The
 * approval gate exists so that a person decides, and the job here is to give
 * them what they need to decide rather than to decide for them. A warning that
 * turns out to be unnecessary costs a glance; auto-cancelling a draft the
 * owner still wanted loses their work, and swapping the text at the moment
 * they press send is worse than either.
 *
 * Age alone is the wrong test. "Send us a photo and we'll take a look" is fine
 * at any age. What matters is whether the body makes a claim about time that
 * has since passed, so the phrase is quoted back and the owner can see it.
 */

/** A day named outright. Written six weeks ago, that day is long gone. */
const WEEKDAY =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

/** Anchored to the day the draft was written, so it rots within a day. */
const RELATIVE_DAY =
  /\b(today|tomorrow|tonight|this (?:morning|afternoon|evening|week)|next week|first thing)\b/gi;

/**
 * A weekday inside a range is a statement of opening hours, not an offer of a
 * visit. "We're open Monday to Friday" must not read as a stale appointment,
 * and it appears in a great many replies.
 */
const WEEKDAY_RANGE =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:-{1,2}|\u2013|to|through|thru)\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

const DAY_MS = 24 * 60 * 60 * 1000;

export type StaleDraftWarning = {
  /** The customer-visible words that have dated, quoted verbatim. */
  phrase: string;
  reason: string;
};

function ageInDays(writtenAt: string | null | undefined, now: Date) {
  const written = Date.parse(writtenAt ?? "");

  return Number.isFinite(written) ? (now.getTime() - written) / DAY_MS : null;
}

/**
 * What has dated, or an empty list. Never throws: this renders beside an
 * approve button, and a failing warning must not take the button with it.
 */
export function staleDraftWarnings(
  body: string | null | undefined,
  writtenAt: string | null | undefined,
  now: Date = new Date(),
): StaleDraftWarning[] {
  const text = (body ?? "").trim();
  const age = ageInDays(writtenAt, now);

  if (!text || age === null || age < 0) {
    return [];
  }

  const warnings: StaleDraftWarning[] = [];
  const seen = new Set<string>();
  const add = (phrase: string, reason: string) => {
    const key = phrase.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      warnings.push({ phrase, reason });
    }
  };

  // A day on, "tomorrow" means a different day than it did when written.
  if (age >= 1) {
    for (const match of text.matchAll(RELATIVE_DAY)) {
      add(match[0], `"${match[0]}" meant ${Math.floor(age)} days ago`);
    }
  }

  // A week on, whichever day was meant has certainly been and gone.
  if (age >= 7) {
    const ranges = [...text.matchAll(WEEKDAY_RANGE)].map((match) =>
      match[0].toLowerCase(),
    );

    for (const match of text.matchAll(WEEKDAY)) {
      const withinRange = ranges.some((range) =>
        range.includes(match[0].toLowerCase()),
      );

      if (!withinRange) {
        add(match[0], `that ${match[0]} has passed`);
      }
    }
  }

  return warnings;
}

/** One line for the owner, or null when there is nothing worth saying. */
export function staleDraftSummary(warnings: readonly StaleDraftWarning[]) {
  if (warnings.length === 0) {
    return null;
  }

  const phrases = warnings.map((warning) => `"${warning.phrase}"`).join(", ");

  return `Written a while ago and still mentions ${phrases}. Check that still holds before sending.`;
}

/**
 * How long a drafted reply may sit unapproved before it is discarded.
 *
 * Six months rather than three. Trades go quiet seasonally, and a customer who
 * asked about a bathroom in November and comes back in February is ordinary --
 * a three-month rule cuts straight through that cycle. At six months the
 * conversation is unambiguously dead.
 */
export const STALE_DRAFT_MAX_AGE_DAYS = 183;

/**
 * Delete drafted replies nobody ever approved.
 *
 * A draft that was never approved has, by definition, caused nothing: it sent
 * no message, booked nothing, and charged nobody. Every foreign key into
 * `actions` -- usage_events, outbound_messages, quote_drafts,
 * conversation_appointments, conversation_tasks -- is written when an action
 * is EXECUTED, so a pending one has no children. Checked against all 393 in
 * production: zero were referenced by anything.
 *
 * What it is not is a record. The customer's own words stay in `messages`,
 * what was actually sent stays in `outbound_messages`, and the contact, lead
 * and conversation are all untouched. What goes is a suggestion nobody
 * accepted -- and leaving it costs something real, because a pending draft
 * keeps its conversation in the "needs reply" bucket for as long as it exists.
 *
 * DELIBERATELY NARROW. Only pending_approval, only draft_reply, only past the
 * cutoff. An approved, executing, completed or failed action is a record of
 * something that happened and is never touched -- those are also the ones with
 * children hanging off them.
 */
export async function discardStaleDraftReplies(
  supabase: SupabaseClient,
  input: {
    limit?: number;
    now?: Date;
    olderThanDays?: number;
    workspaceId?: string | null;
  } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const olderThanDays = Math.max(
    input.olderThanDays ?? STALE_DRAFT_MAX_AGE_DAYS,
    1,
  );
  const now = input.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - olderThanDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  let query = supabase
    .from("actions")
    .select("id,workspace_id,target_id,created_at")
    .eq("type", "draft_reply")
    .eq("status", "pending_approval")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to find stale drafted replies: ${error.message}`);
  }

  const stale = (data ?? []) as Array<{ id: string; workspace_id: string }>;

  if (stale.length === 0) {
    return { cutoff, discarded: 0, ids: [] as string[] };
  }

  const ids = stale.map((row) => row.id);
  // Re-stated on the delete rather than trusting the ids alone, so a draft
  // approved in the moment between the read and the write is not removed.
  const { error: deleteError } = await supabase
    .from("actions")
    .delete()
    .in("id", ids)
    .eq("type", "draft_reply")
    .eq("status", "pending_approval");

  if (deleteError) {
    throw new Error(
      `Unable to discard stale drafted replies: ${deleteError.message}`,
    );
  }

  // Counted out loud. If this rule is ever wrong, the owner should see a
  // number rather than quietly lose rows.
  console.info("Discarded drafted replies nobody approved", {
    cutoff,
    discarded: ids.length,
    olderThanDays,
  });

  return { cutoff, discarded: ids.length, ids };
}
