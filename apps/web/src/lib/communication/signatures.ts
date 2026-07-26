import type {
  CommunicationSettings,
  EmailSignatureSettings,
  SignatureVariant,
} from "./settings";
import type { OutboundAttachment } from "./outbound";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeImageUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.toString();
    }
  } catch {
    return "";
  }

  return "";
}

function signatureLogoDataUrl(signature: EmailSignatureSettings) {
  if (
    signature.logoContentBase64 &&
    signature.logoContentType.startsWith("image/")
  ) {
    return `data:${signature.logoContentType};base64,${signature.logoContentBase64}`;
  }

  return safeImageUrl(signature.logoUrl);
}

function signatureInlineLogoAttachment(
  signature: EmailSignatureSettings,
): OutboundAttachment | null {
  if (
    !signature.logoContentBase64 ||
    !signature.logoContentType.startsWith("image/")
  ) {
    return null;
  }

  return {
    contentBase64: signature.logoContentBase64,
    contentId: "kyro-signature-logo",
    contentType: signature.logoContentType,
    filename: signature.logoFilename || "signature-logo",
    sizeBytes: signature.logoSizeBytes,
    source: "signature_logo",
  };
}

function htmlTextBlock(value: string) {
  return escapeHtml(value.trim()).replace(/\r?\n/g, "<br>");
}

function htmlBodyFromText(value: string) {
  return escapeHtml(value.trim()).replace(/\r?\n/g, "<br>");
}

export function selectEmailSignature(
  settings: CommunicationSettings,
  variant: SignatureVariant,
) {
  if (variant === "ai_generated" && settings.useSeparateAiSignature) {
    return settings.aiGeneratedSignature;
  }

  return settings.manualSignature;
}

export function appendSignatureText(
  body: string,
  signature: EmailSignatureSettings,
) {
  const trimmedBody = body.trim();
  const trimmedSignature = signature.text.trim();

  if (!trimmedSignature || trimmedBody.includes(trimmedSignature)) {
    return trimmedBody;
  }

  return `${trimmedBody}\n\n${trimmedSignature}`;
}

export function buildSignatureHtml(
  signature: EmailSignatureSettings,
  imageSrcOverride?: string,
) {
  const imageUrl = imageSrcOverride ?? signatureLogoDataUrl(signature);
  const hasText = Boolean(signature.text.trim());
  const hasLogo = Boolean(imageUrl);

  if (!hasText && !hasLogo) {
    return null;
  }

  const width = Math.max(32, Math.min(240, Math.round(signature.logoWidthPx)));
  const logoHtml = hasLogo
    ? `<div style="margin-top:10px"><img src="${escapeHtml(imageUrl)}" width="${width}" alt="" style="display:block;max-width:${width}px;height:auto;border:0"></div>`
    : "";
  const textHtml = hasText
    ? `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.45;color:#111827">${htmlTextBlock(signature.text)}</div>`
    : "";

  return `<div style="margin-top:18px">${textHtml}${logoHtml}</div>`;
}

const UNSIGNED_BODY = {
  htmlBody: null,
  inlineAttachments: [] as OutboundAttachment[],
  signatureApplied: false,
};

/**
 * Apply the saved signature only where a signature makes sense.
 *
 * The signature is an *email* signature: display text, an HTML block, and the
 * logo as an inline attachment. On 2026-07-25 an AI-drafted SMS reply went out
 * carrying all three, because three of the five call sites appended it without
 * checking the channel -- the text became part of the SMS body Twilio is handed,
 * pushing a one-segment message to two, with a PNG attached.
 *
 * Channel is a required argument rather than a caller-side `if` so that adding
 * a sixth caller cannot reintroduce the same bug. SMS instead asks the model to
 * write its own short sign-off; see `customerReplyConversationRules`.
 */
export function buildSignedBodyForChannel({
  body,
  channelType,
  includeSignature = true,
  signature,
}: {
  body: string;
  channelType: string;
  includeSignature?: boolean;
  signature: EmailSignatureSettings;
}) {
  if (channelType !== "email" || !includeSignature) {
    return { ...UNSIGNED_BODY, bodyText: body.trim() };
  }

  return buildSignedEmailBody({ body, signature });
}

function buildSignedEmailBody({
  body,
  signature,
}: {
  body: string;
  signature: EmailSignatureSettings;
}) {
  const bodyText = appendSignatureText(body, signature);
  const inlineLogo = signatureInlineLogoAttachment(signature);
  const signatureHtml = buildSignatureHtml(
    signature,
    inlineLogo ? `cid:${inlineLogo.contentId}` : undefined,
  );
  const htmlBody = signatureHtml
    ? `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${htmlBodyFromText(body.trim())}${signatureHtml}</div>`
    : null;

  return {
    bodyText,
    htmlBody,
    inlineAttachments: inlineLogo ? [inlineLogo] : [],
    signatureApplied: Boolean(
      signature.text.trim() ||
        signature.logoUrl.trim() ||
        signature.logoContentBase64.trim(),
    ),
  };
}
