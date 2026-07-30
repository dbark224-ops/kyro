import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Someone contacting again before anyone has answered the first time.
 *
 * "Repeat contact pressure" is a default-enabled escalation trigger, described
 * to the owner as "the same person tries multiple channels or contacts
 * repeatedly within a short window". It has never fired for any workspace,
 * because detectUrgentEscalationTriggers reads metadata.repeatContact and no
 * caller anywhere ever set it. A setting that is on and does nothing is worse
 * than one that is off.
 *
 * Counted across channels rather than within a thread, because the behaviour
 * being detected is exactly someone who emailed, got nothing, and then rang.
 */
const REPEAT_CONTACT_WINDOW_MINUTES = 30;

/**
 * Whether Kyro has dealt with this person before today's message.
 *
 * "existingCustomer" was derived from whether an email threaded onto an open
 * conversation, which is not the same question. A customer whose bathroom was
 * done in March and who emails afresh in July about it failing starts a new
 * thread, so they read as a brand new lead -- and existing_job_serious_issue,
 * the trigger for exactly that complaint, cannot fire. Reporting a failed job
 * months later by starting a new email is the normal way it happens.
 *
 * History means any earlier message either way, so a contact created moments
 * ago by this very inquiry does not count as one.
 */
export async function hasPriorContactHistory(
  supabase: SupabaseClient,
  input: {
    before?: string;
    contactId: string | null;
    workspaceId: string;
  },
) {
  if (!input.contactId) {
    return false;
  }

  const query = supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .eq("contact_id", input.contactId);
  const { count, error } = await (input.before
    ? query.lt("created_at", input.before)
    : query);

  if (error) {
    console.warn("Prior-history lookup failed", {
      code: error.code,
      workspaceId: input.workspaceId,
    });

    return false;
  }

  return (count ?? 0) > 0;
}

/**
 * Whether this contact has already reached out inside the window.
 *
 * The message that triggered this is normally saved before the escalation is
 * evaluated, so anything at or above two inbound messages means a genuine
 * repeat rather than the first contact counting itself.
 *
 * Returns false on any error. A missed escalation trigger is a worse outcome
 * than a slow one, but an inbound message failing outright because a
 * supporting count did not come back would be worse still.
 */
export async function hasRepeatContactPressure(
  supabase: SupabaseClient,
  input: {
    contactId: string | null;
    since?: Date;
    workspaceId: string;
  },
) {
  if (!input.contactId) {
    return false;
  }

  const since = new Date(
    (input.since ?? new Date()).getTime() -
      REPEAT_CONTACT_WINDOW_MINUTES * 60_000,
  ).toISOString();

  // Anything the business has already said to them resets it.
  //
  // Counting every inbound message in the window made an ordinary conversation
  // look like pressure: a customer who was sent a time and replied "that works,
  // book it in" escalated as though they were chasing an unanswered message.
  // Pressure is going unanswered, so only messages since the last reply count.
  const { data: lastOutbound } = await supabase
    .from("messages")
    .select("created_at")
    .eq("workspace_id", input.workspaceId)
    .eq("contact_id", input.contactId)
    .eq("direction", "outbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const unansweredSince = lastOutbound?.created_at
    ? String(lastOutbound.created_at)
    : since;
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .eq("contact_id", input.contactId)
    .eq("direction", "inbound")
    .gt("created_at", unansweredSince);

  if (error) {
    console.warn("Repeat-contact lookup failed", {
      code: error.code,
      workspaceId: input.workspaceId,
    });

    return false;
  }

  return (count ?? 0) >= 2;
}
