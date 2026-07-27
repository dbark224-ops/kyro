import type { AddressValidationStatus } from "./types";

/**
 * How an address's verification state reads to the person looking at it.
 *
 * Kept apart from `verify.ts` on purpose: that module imports the Google client
 * and the API key with it, so a client component importing it would either fail
 * the build or ship server code to the browser.
 *
 * Three states, not five. The stored column distinguishes `google_place` from
 * `needs_review` and `manual` from `unverified`, which matters for debugging
 * and for deciding whether to re-check, but a sole trader glancing at a job
 * card only needs to know whether they can trust the address enough to drive
 * to it.
 */
export type AddressVerificationTone = "verified" | "review" | "unverified";

export type AddressVerificationDisplay = {
  label: string;
  title: string;
  tone: AddressVerificationTone;
};

export function addressVerificationDisplay(
  status: string | null | undefined,
): AddressVerificationDisplay | null {
  const normalized = (status ?? "").trim() as AddressValidationStatus | "";

  if (normalized === "validated") {
    return {
      label: "Verified",
      title: "Google confirmed this address.",
      tone: "verified",
    };
  }

  if (normalized === "needs_review") {
    return {
      label: "Check",
      title:
        "Google matched an address but could not confirm every part of it. Worth a look before you rely on it.",
      tone: "review",
    };
  }

  if (normalized === "google_place") {
    return {
      label: "Check",
      title:
        "This came from a Google place but was never put through address validation.",
      tone: "review",
    };
  }

  // "manual", "unverified", null, or anything a future migration adds: nobody
  // has confirmed it. Saying so is the point -- an address that has never been
  // checked used to be indistinguishable from one that had.
  return {
    label: "Not verified",
    title: "Nobody has confirmed this address.",
    tone: "unverified",
  };
}
