import { consumeApiRateLimit } from "../../../../../lib/security/rate-limit";

/**
 * Throttle the two unauthenticated Google Places routes used during signup.
 *
 * Their authenticated equivalents under /api/addresses require a workspace and
 * meter the spend with recordGoogleApiUsage. These copies necessarily have
 * neither -- there is no account yet -- which left them as open, paid endpoints
 * whose only visible trace would be the Google invoice.
 *
 * Limits are per client IP and sized for a real signup: address autocomplete
 * fires while typing, place details only on selection.
 */
const LIMITS = {
  autocomplete: { maxRequests: 60, windowSeconds: 600 },
  place: { maxRequests: 20, windowSeconds: 600 },
} as const;

export async function withinPlacesRateLimit(
  headers: Headers,
  kind: keyof typeof LIMITS,
): Promise<boolean> {
  const limit = LIMITS[kind];

  try {
    const { allowed } = await consumeApiRateLimit({
      headers,
      maxRequests: limit.maxRequests,
      route: `public.create_account_places_${kind}`,
      windowSeconds: limit.windowSeconds,
    });

    return allowed;
  } catch {
    // The limiter itself is down. Signup matters more than the lookup, so allow
    // the call rather than blocking account creation on a rate-limit outage.
    return true;
  }
}
