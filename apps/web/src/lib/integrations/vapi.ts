import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VoiceSettings } from "../assistant/voice-settings";

export const VAPI_PROVIDER = "vapi";
export const VAPI_CARRIER_PROVIDER = "twilio";
export const VAPI_WEBHOOK_PATH = "/api/integrations/vapi/webhook";
export const VAPI_TOOL_PATH = "/api/integrations/vapi/tool";
export const VAPI_CALLS_PATH = "/api/voice/calls";
export const VAPI_OUTBOUND_CALL_PATH = "/api/voice/outbound";

const VAPI_API_BASE_URL = "https://api.vapi.ai";

type VapiConfig = {
  apiKey: string;
  appUrl: string | null;
  toolCredentialId: string | null;
  toolSecret: string | null;
  webhookCredentialId: string | null;
  webhookSecret: string | null;
};

export type VapiVoiceOverview = {
  configured: boolean;
  inboundAssistantId: string | null;
  internalAssistantId: string | null;
  outboundAssistantId: string | null;
  phoneNumberId: string | null;
  publicKeyReady: boolean;
  toolCredentialReady: boolean;
  toolSecretReady: boolean;
  toolUrl: string | null;
  voicemailAssistantId: string | null;
  webhookCredentialReady: boolean;
  webhookSecretReady: boolean;
  webhookUrl: string | null;
};

export type VapiOutboundCallResult = {
  id: string | null;
  status: string | null;
  raw: Record<string, unknown>;
};

export type VapiDeleteCallResult = {
  deleted: boolean;
  error: string | null;
  status: number | null;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? null;
}

export function vapiEndpointUrl(path: string) {
  const baseUrl = appUrl();

  return baseUrl ? `${baseUrl}${path}` : null;
}

export function getVapiConfig(): VapiConfig | null {
  const apiKey = process.env.VAPI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    appUrl: appUrl(),
    toolCredentialId: textValue(process.env.VAPI_TOOL_CREDENTIAL_ID),
    toolSecret: textValue(process.env.VAPI_TOOL_SECRET),
    webhookCredentialId: textValue(process.env.VAPI_WEBHOOK_CREDENTIAL_ID),
    webhookSecret: textValue(process.env.VAPI_WEBHOOK_SECRET),
  };
}

export function vapiConfigured() {
  return Boolean(getVapiConfig());
}

export function getVapiVoiceOverview(
  _supabase: SupabaseClient,
  _workspaceId: string,
  voiceSettings: VoiceSettings,
): VapiVoiceOverview {
  const config = getVapiConfig();

  return {
    configured: Boolean(config),
    inboundAssistantId: voiceSettings.vapiInboundAssistantId,
    internalAssistantId: voiceSettings.vapiInternalAssistantId,
    outboundAssistantId: voiceSettings.vapiOutboundAssistantId,
    phoneNumberId: voiceSettings.vapiPhoneNumberId,
    publicKeyReady: Boolean(textValue(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY)),
    toolCredentialReady: Boolean(config?.toolCredentialId),
    toolSecretReady: Boolean(config?.toolSecret),
    toolUrl: vapiEndpointUrl(VAPI_TOOL_PATH),
    voicemailAssistantId: voiceSettings.vapiVoicemailAssistantId,
    webhookCredentialReady: Boolean(config?.webhookCredentialId),
    webhookSecretReady: Boolean(config?.webhookSecret),
    webhookUrl: vapiEndpointUrl(VAPI_WEBHOOK_PATH),
  };
}

export function vapiWebhookCredentialId() {
  return textValue(process.env.VAPI_WEBHOOK_CREDENTIAL_ID);
}

export function vapiToolCredentialId() {
  return textValue(process.env.VAPI_TOOL_CREDENTIAL_ID);
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function requestSecrets(request: Request) {
  const candidates: string[] = [];

  try {
    const url = new URL(request.url);
    candidates.push(
      url.searchParams.get("secret")?.trim() ?? "",
      url.searchParams.get("token")?.trim() ?? "",
    );
  } catch {
    // Ignore malformed URLs and fall back to headers.
  }

  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    candidates.push(authorization.slice("bearer ".length).trim());
  }

  candidates.push(
    request.headers.get("x-vapi-secret")?.trim() ?? "",
    request.headers.get("x-vapi-token")?.trim() ?? "",
    request.headers.get("x-vapi-tool-secret")?.trim() ?? "",
    request.headers.get("x-vapi-webhook-secret")?.trim() ?? "",
    request.headers.get("x-kyro-vapi-secret")?.trim() ?? "",
    request.headers.get("x-kyro-vapi-tool-secret")?.trim() ?? "",
    request.headers.get("x-kyro-vapi-webhook-secret")?.trim() ?? "",
  );

  return candidates.filter(Boolean);
}

function requestHasMatchingSecret(request: Request, validSecrets: string[]) {
  const cleanValidSecrets = validSecrets
    .map((secret) => secret.trim())
    .filter(Boolean);

  if (cleanValidSecrets.length === 0) {
    return process.env.NODE_ENV !== "production";
  }

  return requestSecrets(request).some((providedSecret) =>
    cleanValidSecrets.some((validSecret) => safeEquals(providedSecret, validSecret)),
  );
}

export function vapiRequestAuthDiagnostics(request: Request) {
  let hasQueryCredential = false;

  try {
    const url = new URL(request.url);
    hasQueryCredential = Boolean(
      url.searchParams.get("secret")?.trim() ||
        url.searchParams.get("token")?.trim(),
    );
  } catch {
    hasQueryCredential = false;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const authorizationScheme = authorization.split(/\s+/)[0]?.trim() || null;
  const checkedHeaderNames = [
    "x-vapi-secret",
    "x-vapi-token",
    "x-vapi-tool-secret",
    "x-vapi-webhook-secret",
    "x-kyro-vapi-secret",
    "x-kyro-vapi-tool-secret",
    "x-kyro-vapi-webhook-secret",
  ];

  return {
    authorizationScheme,
    checkedHeaderNames: checkedHeaderNames.filter((name) =>
      Boolean(request.headers.get(name)?.trim()),
    ),
    hasAuthorization: Boolean(authorization.trim()),
    hasQueryCredential,
  };
}

export function verifyVapiWebhookRequest(request: Request) {
  const secret = process.env.VAPI_WEBHOOK_SECRET?.trim();

  return requestHasMatchingSecret(request, secret ? [secret] : []);
}

export function verifyVapiToolRequest(request: Request) {
  return requestHasMatchingSecret(request, [
    process.env.VAPI_TOOL_SECRET?.trim() ?? "",
    process.env.VAPI_WEBHOOK_SECRET?.trim() ?? "",
  ]);
}

export async function createVapiOutboundCall(input: {
  assistantId: string;
  assistantOverrides?: Record<string, unknown>;
  customerNumber: string;
  metadata?: Record<string, unknown>;
  phoneNumberId: string;
}): Promise<VapiOutboundCallResult> {
  const config = getVapiConfig();

  if (!config) {
    throw new Error("Vapi is not configured. Add VAPI_API_KEY first.");
  }

  const response = await fetch(`${VAPI_API_BASE_URL}/call`, {
    body: JSON.stringify({
      assistantId: input.assistantId,
      assistantOverrides: input.assistantOverrides,
      customer: {
        number: input.customerNumber,
      },
      metadata: input.metadata ?? {},
      phoneNumberId: input.phoneNumberId,
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    throw new Error(
      textValue(payload.message) ??
        textValue(payload.error) ??
        `Vapi outbound call failed with HTTP ${response.status}.`,
    );
  }

  return {
    id: textValue(payload.id),
    raw: payload,
    status: textValue(payload.status),
  };
}

export async function deleteVapiCallData(
  callId: string,
): Promise<VapiDeleteCallResult> {
  const config = getVapiConfig();

  if (!config) {
    return {
      deleted: false,
      error: "VAPI_API_KEY is not configured.",
      status: null,
    };
  }

  const response = await fetch(
    `${VAPI_API_BASE_URL}/call/${encodeURIComponent(callId)}`,
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      method: "DELETE",
    },
  );

  if (response.ok || response.status === 404) {
    return {
      deleted: true,
      error: null,
      status: response.status,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  return {
    deleted: false,
    error:
      textValue(payload.message) ??
      textValue(payload.error) ??
      `Vapi delete call failed with HTTP ${response.status}.`,
    status: response.status,
  };
}
