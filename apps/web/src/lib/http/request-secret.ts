import { timingSafeEqual } from "node:crypto";

type RequestSecretOptions = {
  headerNames?: readonly string[];
  queryParamNames?: readonly string[];
};

const DEFAULT_SECRET_HEADERS = ["x-kyro-sync-secret"] as const;

export function envSecret(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

export function envSecrets(...keys: string[]) {
  return keys
    .map((key) => process.env[key]?.trim() ?? "")
    .filter((value) => value.length > 0);
}

export function requestBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || null;
}

export function requestSecret(
  request: Request,
  {
    headerNames = DEFAULT_SECRET_HEADERS,
    queryParamNames = [],
  }: RequestSecretOptions = {},
) {
  const bearer = requestBearerToken(request);

  if (bearer) {
    return bearer;
  }

  for (const headerName of headerNames) {
    const value = request.headers.get(headerName)?.trim();

    if (value) {
      return value;
    }
  }

  if (queryParamNames.length > 0) {
    const url = new URL(request.url);

    for (const paramName of queryParamNames) {
      const value = url.searchParams.get(paramName)?.trim();

      if (value) {
        return value;
      }
    }
  }

  return null;
}

export function secretMatches(provided: string | null, expected: string) {
  if (!provided || !expected) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function hasValidRequestSecret(
  request: Request,
  expected: string,
  options?: RequestSecretOptions,
) {
  return secretMatches(requestSecret(request, options), expected);
}

export function hasAnyValidRequestSecret(
  request: Request,
  expectedSecrets: readonly string[],
  options?: RequestSecretOptions,
) {
  const provided = requestSecret(request, options);

  return expectedSecrets.some((expected) => secretMatches(provided, expected));
}
