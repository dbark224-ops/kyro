import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "../supabase/service";

type RateLimitInput = {
  headers: Headers;
  identifier?: string | null;
  maxRequests: number;
  route: string;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function clientAddress(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return (
    forwarded ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function consumeApiRateLimit(
  input: RateLimitInput,
): Promise<RateLimitResult> {
  const fingerprint = [
    input.route,
    clientAddress(input.headers),
    input.identifier?.trim().toLowerCase() ?? "",
  ].join(":");
  const keyHash = createHash("sha256").update(fingerprint).digest("hex");
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_key_hash: keyHash,
    p_max_requests: input.maxRequests,
    p_route: input.route,
    p_window_seconds: input.windowSeconds,
  });

  if (error) {
    throw new Error(`Unable to enforce API rate limit: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object") {
    throw new Error("Unable to enforce API rate limit: no result returned.");
  }

  const result = row as Record<string, unknown>;

  return {
    allowed: result.allowed === true,
    remaining: Math.max(0, numberValue(result.remaining)),
    retryAfterSeconds: Math.max(
      1,
      numberValue(result.retry_after_seconds),
    ),
  };
}
