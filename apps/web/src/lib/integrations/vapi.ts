import { timingSafeEqual } from "node:crypto";

export const VAPI_TOOL_PATH = "/api/integrations/vapi/tool";
export const VAPI_WEBHOOK_PATH = "/api/integrations/vapi/webhook";

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

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function requestSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return (
    request.headers.get("x-vapi-secret")?.trim() ??
    request.headers.get("x-vapi-webhook-secret")?.trim() ??
    request.headers.get("x-kyro-vapi-secret")?.trim() ??
    ""
  );
}

export function verifyVapiWebhookRequest(request: Request) {
  const secret = textValue(process.env.VAPI_WEBHOOK_SECRET);

  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const providedSecret = requestSecret(request);

  return providedSecret ? safeEquals(providedSecret, secret) : false;
}

export function verifyVapiToolRequest(request: Request) {
  const secret =
    textValue(process.env.VAPI_TOOL_SECRET) ??
    textValue(process.env.VAPI_WEBHOOK_SECRET);

  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const providedSecret = requestSecret(request);

  return providedSecret ? safeEquals(providedSecret, secret) : false;
}
