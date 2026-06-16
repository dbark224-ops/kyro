function normalizeBaseUrl(value: string | undefined | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, "");
}

export function getPublicAppUrl(fallbackOrigin?: string | null) {
  return (
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeBaseUrl(process.env.APP_URL) ??
    normalizeBaseUrl(process.env.SITE_URL) ??
    normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeBaseUrl(process.env.VERCEL_URL) ??
    normalizeBaseUrl(fallbackOrigin) ??
    "https://kyroassistant.com"
  );
}

export function getAuthCallbackUrl(fallbackOrigin?: string | null) {
  return `${getPublicAppUrl(fallbackOrigin)}/auth/callback`;
}
