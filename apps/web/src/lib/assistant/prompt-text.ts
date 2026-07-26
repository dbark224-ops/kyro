/**
 * Flatten a user prompt for keyword matching.
 *
 * Lowercases, drops punctuation and collapses whitespace, so "Can you CANCEL
 * Tuesday's 9am?" and "cancel tuesdays 9am" match the same rules. Intent
 * detection across the assistant depends on this exact shape, which is why it
 * is one function rather than the 72 call sites' worth of local copies it had
 * inside commands.ts.
 */
export function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
