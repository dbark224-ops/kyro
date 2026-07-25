/**
 * Node's `fetch` has no default timeout, so a hung TCP connection waits forever.
 *
 * That matters most inside `/api/background/process` (`maxDuration = 300`): one
 * stalled Gmail, Stripe or Twilio connection consumes the entire drain budget and
 * starves every other workspace's email sync, calendar sync and outbound
 * delivery. A request that never returns is worse than one that fails, because
 * nothing retries and nothing alerts.
 */

/** Providers expected to answer quickly: Stripe, Twilio, Vapi, Resend, Google APIs. */
export const PROVIDER_TIMEOUT_MS = 30_000;

/**
 * Model calls are legitimately slow -- image generation at high quality can run
 * for a minute or more -- so they get a much longer ceiling. The point is to
 * bound a hang, not to police latency.
 */
export const AI_PROVIDER_TIMEOUT_MS = 120_000;

export class FetchTimeoutError extends Error {
  timeoutMs: number;
  url: string;

  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms.`);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

function describeTarget(input: string | URL | Request) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();

  return input.url;
}

/**
 * `fetch` with a bounded deadline.
 *
 * A caller-supplied `signal` still works -- both are honoured, and whichever
 * fires first wins. Only our own deadline produces a `FetchTimeoutError`; a
 * caller aborting propagates their original AbortError unchanged, so existing
 * cancellation logic keeps behaving the same.
 */
export async function fetchAiProvider(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithTimeout(input, init, AI_PROVIDER_TIMEOUT_MS);
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted && !init?.signal?.aborted) {
      throw new FetchTimeoutError(describeTarget(input), timeoutMs);
    }

    throw error;
  }
}
