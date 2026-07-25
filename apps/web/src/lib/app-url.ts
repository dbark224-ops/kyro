const DEFAULT_PUBLIC_APP_URL = "https://www.kyroassistant.com";

function normalizeBaseUrl(value: string | undefined | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, "");
}

function isLocalBaseUrl(value: string | null) {
  if (!value) {
    return false;
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function publicCandidate(value: string | undefined | null, allowLocal: boolean) {
  const normalized = normalizeBaseUrl(value);

  if (!allowLocal && isLocalBaseUrl(normalized)) {
    return null;
  }

  return normalized;
}

export function getPublicAppUrl(fallbackOrigin?: string | null) {
  const allowLocal = !isProductionRuntime();

  return (
    publicCandidate(process.env.NEXT_PUBLIC_APP_URL, allowLocal) ??
    publicCandidate(process.env.NEXT_PUBLIC_SITE_URL, allowLocal) ??
    publicCandidate(process.env.APP_URL, allowLocal) ??
    publicCandidate(process.env.SITE_URL, allowLocal) ??
    publicCandidate(process.env.VERCEL_PROJECT_PRODUCTION_URL, allowLocal) ??
    publicCandidate(process.env.VERCEL_URL, allowLocal) ??
    publicCandidate(fallbackOrigin, allowLocal) ??
    DEFAULT_PUBLIC_APP_URL
  );
}

export function getAuthCallbackUrl(fallbackOrigin?: string | null) {
  return `${getPublicAppUrl(fallbackOrigin)}/auth/callback`;
}
