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
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .eq("contact_id", input.contactId)
    .eq("direction", "inbound")
    .gte("created_at", since);

  if (error) {
    console.warn("Repeat-contact lookup failed", {
      code: error.code,
      workspaceId: input.workspaceId,
    });

    return false;
  }

  return (count ?? 0) >= 2;
}
