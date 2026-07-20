export type KyroDeepLinkOpenError =
  | "invalid-conversation"
  | "missing-conversation";

export type KyroDeepLinkDestination =
  | {
      conversationId: string;
      key: string;
      kind: "inbox-conversation";
      receivedAt: number;
      sourceUrl: string;
    }
  | {
      key: string;
      kind: "inbox-list";
      openError: KyroDeepLinkOpenError;
      receivedAt: number;
      sourceUrl: string;
    };

const conversationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const kyroDeepLinkErrorMessages: Record<KyroDeepLinkOpenError, string> = {
  "invalid-conversation": "That inbox link was not valid. Showing inbox instead.",
  "missing-conversation": "That inbox link did not include a conversation. Showing inbox instead.",
};

export function isValidConversationId(value?: string | null) {
  return Boolean(value && conversationIdPattern.test(value.trim()));
}

export function parseKyroDeepLink(
  rawUrl: string,
): KyroDeepLinkDestination | null {
  const url = parseUrl(rawUrl);

  if (!url || getSupportedRoute(url) !== "inbox") {
    return null;
  }

  const sourceUrl = rawUrl;
  const receivedAt = Date.now();
  const conversationId = normalizeConversationId(
    url.searchParams.get("conversationId"),
  );

  if (!conversationId) {
    return {
      key: "inbox:missing-conversation",
      kind: "inbox-list",
      openError: "missing-conversation",
      receivedAt,
      sourceUrl,
    };
  }

  if (!isValidConversationId(conversationId)) {
    return {
      key: `inbox:invalid-conversation:${conversationId.slice(0, 32)}`,
      kind: "inbox-list",
      openError: "invalid-conversation",
      receivedAt,
      sourceUrl,
    };
  }

  return {
    conversationId,
    key: `inbox:${conversationId}`,
    kind: "inbox-conversation",
    receivedAt,
    sourceUrl,
  };
}

function parseUrl(rawUrl: string) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function getSupportedRoute(url: URL) {
  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  if (protocol === "kyro:") {
    if (hostname === "inbox" || segments[0] === "inbox") {
      return "inbox";
    }

    if (hostname === "open" && segments[0] === "inbox") {
      return "inbox";
    }
  }

  if (
    (protocol === "https:" || protocol === "http:") &&
    (hostname === "kyroassistant.com" || hostname === "www.kyroassistant.com")
  ) {
    if (segments[0] === "open" && segments[1] === "inbox") {
      return "inbox";
    }

    if (segments[0] === "inbox") {
      return "inbox";
    }
  }

  return null;
}

function normalizeConversationId(value: string | null) {
  const normalized = value?.trim() ?? "";

  if (!normalized || normalized.length > 128) {
    return null;
  }

  return normalized;
}
