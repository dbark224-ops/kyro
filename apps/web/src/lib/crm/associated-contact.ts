import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeContactPhoneForRegion } from "./identity";
import { getWorkspacePhoneRegion } from "../workspace/general-settings";
import { textValue } from "@kyro/core";

/**
 * The person who answers on someone else's behalf.
 *
 * A contact can carry a second number for a partner, an assistant, or whoever
 * is actually on site. That number is deliberately not an identity: it is not
 * indexed, and the inbound contact lookup matches `normalized_phone` only, so
 * matching on it would attach one person's conversation to another person's
 * profile and merge two histories that happen to share a handset.
 *
 * But refusing to recognise them at all is its own failure. Ike is standing in
 * the flooded garage; when he rings, Kyro should know the number is listed
 * against Marisol's job and be able to talk to him about it, rather than
 * treating him as a stranger and declining to discuss work he is physically
 * standing in front of.
 *
 * So this is a separate, weaker signal. It says "this number is listed on that
 * contact, as this person, in this role". It never becomes the contact.
 */
export type AssociatedContactMatch = {
  /** The contact the number is listed against -- not the caller. */
  contactId: string;
  contactName: string | null;
  /** What the contact called them, e.g. "Ike Delacroix". */
  associatedName: string | null;
  /** What they are to the contact, e.g. "Father-in-law". */
  associatedLabel: string | null;
};

/**
 * A caller whose number is a contact's secondary number, or null.
 *
 * Returns null when the number matches more than one contact. Two customers
 * listing the same second number is exactly the case where guessing is worse
 * than not knowing -- an assistant working for several clients, or a recycled
 * handset. Kyro can still ask who they are calling about.
 */
export async function findContactByAssociatedPhone(
  supabase: SupabaseClient,
  workspaceId: string,
  callerNumber: string | null,
): Promise<AssociatedContactMatch | null> {
  if (!callerNumber) {
    return null;
  }

  const normalized = normalizeContactPhoneForRegion(
    callerNumber,
    await getWorkspacePhoneRegion(supabase, workspaceId),
  );

  if (!normalized) {
    return null;
  }

  const { data, error } = await supabase
    .from("contacts")
    .select("id,name,secondary_phone_name,secondary_phone_label")
    .eq("workspace_id", workspaceId)
    .eq("normalized_secondary_phone", normalized)
    .is("merged_into_contact_id", null)
    .order("updated_at", { ascending: false })
    .limit(2);

  if (error) {
    // Not fatal: this only ever adds context. Losing it degrades Kyro to
    // treating the caller as unrecognised, which is the old behaviour.
    console.warn("Associated-contact lookup failed", {
      code: error.code,
      workspaceId,
    });

    return null;
  }

  if ((data ?? []).length !== 1) {
    return null;
  }

  const contact = data![0];

  return {
    associatedLabel: textValue(contact.secondary_phone_label),
    associatedName: textValue(contact.secondary_phone_name),
    contactId: String(contact.id),
    contactName: textValue(contact.name),
  };
}

/**
 * How Kyro should describe the association to itself.
 *
 * Deliberately phrased as a fact about the number rather than a claim about
 * who the caller is: the handset is listed, the person holding it is not
 * verified, and the difference matters when deciding what may be discussed.
 */
export function associatedContactContextLine(match: AssociatedContactMatch) {
  const who = [match.associatedName, match.associatedLabel]
    .filter(Boolean)
    .join(", ");
  const onBehalfOf = match.contactName ?? "a saved contact";

  return `This number is saved on ${onBehalfOf}'s profile as their second contact number${
    who ? ` (${who})` : ""
  }. Treat them as someone entitled to discuss ${onBehalfOf}'s job -- access, timing, what is happening on site -- because ${onBehalfOf} gave you this number for that purpose. It does not make them ${onBehalfOf}: do not change account details, prices, or contact information on their say-so, and do not discuss any other customer.`;
}
