/**
 * What to show a user about a contact whose profile needs attention.
 *
 * `profile_resolution_status = 'needs_review'` covers two unrelated problems --
 * a possible duplicate, and a phone number Kyro cannot dial -- so one shared
 * label ("Needs review") told the user something was wrong without saying what.
 * These give each cause its own label and a sentence explaining the fix.
 *
 * The two are told apart by `profileConflictContactIds`: a duplicate conflict
 * always records the contacts it clashed with, and nothing else does.
 */
export type ProfileResolutionNotice = {
  explanation: string;
  label: string;
  tone: "duplicate" | "unverified";
};

export const DUPLICATE_NOTICE: ProfileResolutionNotice = {
  explanation:
    "This matches an existing contact on email or phone. Review both and merge them if they're the same person.",
  label: "Possible duplicate",
  tone: "duplicate",
};

export const UNVERIFIED_PHONE_NOTICE: ProfileResolutionNotice = {
  explanation:
    "The number saved for this contact isn't a valid phone number, so Kyro can't text or call it. Edit the contact to fix it.",
  label: "Can't verify number",
  tone: "unverified",
};

export function profileResolutionNotice(contact: {
  profileConflictContactIds?: string[] | null;
  profileResolutionStatus?: string | null;
}): ProfileResolutionNotice | null {
  if (contact.profileResolutionStatus !== "needs_review") {
    return null;
  }

  return contact.profileConflictContactIds?.length
    ? DUPLICATE_NOTICE
    : UNVERIFIED_PHONE_NOTICE;
}
