import type { Session } from "@supabase/supabase-js";

import { mobileEnv } from "./env";

export type KyroApiRoute =
  | "/api/assistant/suggestions"
  | "/api/mobile/assistant"
  | "/api/mobile/assistant/vapi-session"
  | "/api/mobile/assistant/vapi-turn"
  | "/api/mobile/assistant/voice-turn"
  | "/api/mobile/bootstrap"
  | "/api/mobile/crm"
  | "/api/mobile/crm/import-contacts"
  | `/api/mobile/crm/${string}`
  | "/api/mobile/documents"
  | `/api/mobile/documents/${string}`
  | `/api/mobile/documents/${string}/pdf`
  | "/api/mobile/file-link"
  | "/api/mobile/file-preview"
  | "/api/mobile/files"
  | "/api/mobile/inbox"
  | `/api/mobile/inbox/${string}`
  | `/api/mobile/inbox/${string}/reply-draft`
  | "/api/mobile/payments"
  | "/api/mobile/reports/pdf"
  | "/api/mobile/settings"
  | "/api/mobile/settings/pronunciation-preview"
  | "/api/mobile/workspace-tools";

export type KyroApiOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | null | undefined>;
  session?: Session | null;
};

export class KyroApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KyroApiError";
    this.status = status;
  }
}

export async function kyroApiFetch<T>(
  route: KyroApiRoute,
  options: KyroApiOptions = {}
): Promise<T> {
  if (!mobileEnv.kyroApiBaseUrl) {
    throw new KyroApiError("Kyro API base URL is not configured.", 0);
  }

  const { query, ...requestOptions } = options;
  const response = await fetch(buildKyroApiUrl(route, query), {
    ...requestOptions,
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.session?.access_token
        ? { Authorization: `Bearer ${options.session.access_token}` }
        : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = getApiFailureMessage(response.status, body);

    throw new KyroApiError(
      message,
      response.status
    );
  }

  return response.json() as Promise<T>;
}

export async function kyroApiFormFetch<T>(
  route: KyroApiRoute,
  formData: FormData,
  options: Omit<KyroApiOptions, "body"> = {}
): Promise<T> {
  if (!mobileEnv.kyroApiBaseUrl) {
    throw new KyroApiError("Kyro API base URL is not configured.", 0);
  }

  const { query } = options;
  const response = await sendFormDataWithXhr(
    buildKyroApiUrl(route, query),
    formData,
    {
      headers: {
        Accept: "application/json",
        ...(options.session?.access_token
          ? { Authorization: `Bearer ${options.session.access_token}` }
          : {}),
        ...options.headers
      },
      method: options.method ?? "POST",
      signal: options.signal
    }
  );

  if (response.status < 200 || response.status >= 300) {
    const message = getApiFailureMessage(response.status, response.body);

    throw new KyroApiError(message, response.status);
  }

  return parseJsonResponse(response.body) as T;
}

function buildKyroApiUrl(
  route: KyroApiRoute,
  query?: KyroApiOptions["query"]
) {
  const url = new URL(route, mobileEnv.kyroApiBaseUrl);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function parseJsonResponse(body: string) {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function getApiFailureMessage(status: number, body: string) {
  const payload = parseJsonResponse(body);

  if (payload && typeof payload === "object" && "error" in payload) {
    return String(payload.error);
  }

  if (
    status === 401 &&
    body.includes("Authentication Required") &&
    body.includes("Vercel Authentication")
  ) {
    return "Kyro backend is blocked by Vercel Authentication. Disable deployment protection for the mobile API domain or point the app at a public backend URL.";
  }

  return status > 0
    ? `Kyro API request failed with status ${status}.`
    : "Kyro API request failed.";
}

function sendFormDataWithXhr(
  url: string,
  formData: FormData,
  options: {
    headers: Record<string, string>;
    method: string;
    signal?: AbortSignal | null;
  }
) {
  return new Promise<{ body: string; status: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    function settle(
      callback: () => void
    ) {
      if (settled) {
        return;
      }

      settled = true;
      options.signal?.removeEventListener("abort", abortRequest);
      callback();
    }

    function abortRequest() {
      xhr.abort();
      settle(() => reject(new KyroApiError("Kyro API request was cancelled.", 0)));
    }

    if (options.signal?.aborted) {
      reject(new KyroApiError("Kyro API request was cancelled.", 0));
      return;
    }

    xhr.open(options.method, url);
    xhr.onload = () => {
      settle(() =>
        resolve({
          body: typeof xhr.responseText === "string" ? xhr.responseText : "",
          status: xhr.status
        })
      );
    };
    xhr.onerror = () => {
      settle(() => reject(new KyroApiError("Kyro API network request failed.", 0)));
    };
    xhr.ontimeout = () => {
      settle(() => reject(new KyroApiError("Kyro API request timed out.", 0)));
    };

    options.signal?.addEventListener("abort", abortRequest);

    for (const [key, value] of Object.entries(options.headers)) {
      if (key.toLowerCase() !== "content-type") {
        xhr.setRequestHeader(key, value);
      }
    }

    xhr.send(formData);
  });
}
