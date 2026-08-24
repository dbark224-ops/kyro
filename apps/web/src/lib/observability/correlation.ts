/**
 * What ties one customer's journey together.
 *
 * A single inbound SMS produces work in the Twilio webhook, the ingest path,
 * the triage run, the alert to the owner and the outbound send. Nothing joined
 * those, so reconstructing what happened to one person meant matching lines by
 * timestamp and hoping.
 *
 * The fix is not a new trace id. One already exists: `events.id` is created at
 * every inbound entry point before any work is scheduled, and `ai_runs`
 * already records it in `input_refs` for 1,065 of 2,082 runs. The gap was the
 * runs that happen *downstream* of an inbound message and never carried it --
 * 530 inquiry notifications, 220 escalation alerts and 52 WhatsApp turns, all
 * part of a customer's journey and none of them joinable to it.
 *
 * Passing it explicitly, rather than inheriting it from async context, is what
 * makes it survive `after()`. Both deferred paths already hand their input
 * object to the callback, so a field on that object crosses the response
 * boundary by construction -- no AsyncLocalStorage, and nothing that depends
 * on the framework preserving context after the response is sent.
 */
export type Correlation = {
  contactId?: string | null;
  conversationId?: string | null;
  /** The inbound `events` row. The root of anything a customer started. */
  eventId?: string | null;
  leadId?: string | null;
  /**
   * For work the owner started, which has no inbound event. Vercel stamps
   * every request with one; see `requestIdFromHeaders`.
   */
  requestId?: string | null;
};

const KEYS = [
  "contactId",
  "conversationId",
  "eventId",
  "leadId",
  "requestId",
] as const satisfies readonly (keyof Correlation)[];

/**
 * The identifiers worth writing onto a row or a log line.
 *
 * Drops anything absent rather than writing nulls: `input_refs` is read by eye
 * when something has gone wrong, and five null keys on every row makes the one
 * that matters harder to see, not easier.
 */
export function correlationRefs(correlation?: Correlation | null) {
  const refs: Record<string, string> = {};

  if (!correlation) {
    return refs;
  }

  for (const key of KEYS) {
    const value = correlation[key];

    if (typeof value === "string" && value.trim()) {
      refs[key] = value;
    }
  }

  return refs;
}

/**
 * The request id for owner-initiated work.
 *
 * Vercel sets `x-vercel-id` on every request, so this costs nothing and needs
 * no generation. Falls back to the W3C trace header, then to nothing -- a
 * missing request id is a slightly harder debug, not a failure, so this never
 * invents one that would look real but correlate with nothing.
 */
export function requestIdFromHeaders(headers: Headers) {
  const vercelId = headers.get("x-vercel-id")?.trim();

  if (vercelId) {
    return vercelId;
  }

  const traceparent = headers.get("traceparent")?.trim();

  // 00-<32 hex trace id>-<16 hex span id>-<flags>; the trace id is the part
  // that is the same across every hop.
  const traceId = traceparent?.split("-")[1];

  return traceId && /^[0-9a-f]{32}$/.test(traceId) ? traceId : null;
}
