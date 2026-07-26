/**
 * Trimmed text, or null when there is nothing to read.
 *
 * This was copy-pasted into 137 files. 129 of those copies were byte-identical
 * and are now this one; the rest quietly disagreed -- some returned an empty
 * string instead of null, one returned "USD", and one forgot to trim -- so they
 * were given their own names rather than folded in here, because a shared
 * helper that means six different things is worse than six local ones.
 *
 * Returning null rather than "" is the point: it forces callers to decide what
 * absence means instead of letting an empty string flow onward as if it were a
 * value.
 */
export function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Trimmed text, or an empty string when there is nothing to read.
 *
 * For the handful of callers that genuinely want a string every time -- form
 * echoes and string concatenation, where null would render as "null".
 */
export function textValueOrEmpty(value: unknown): string {
  return textValue(value) ?? "";
}

/**
 * A plain object, or an empty one when the value is anything else.
 *
 * The same story as `textValue`: 73 copies across the codebase, 72 of them
 * functionally identical. Arrays are excluded deliberately -- they are objects
 * to `typeof`, but reading `.someKey` off one is always a mistake.
 *
 * Returning `{}` rather than null means callers can keep reading properties
 * without a guard, which is the whole reason it exists at every JSON and
 * database boundary in the app.
 */
export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
