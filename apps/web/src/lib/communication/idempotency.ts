import { createHash } from "node:crypto";

/**
 * Fallback dedupe window used when a caller cannot supply a submission key.
 * Two identical manual replies to the same conversation inside this window
 * collapse into one send.
 */
export const MANUAL_REPLY_DEDUPE_WINDOW_MS = 60_000;

/**
 * Builds the `outbound_messages.idempotency_key` for a user-written manual reply.
 *
 * Why this exists: `recordOutboundMessage` falls back to a random UUID when no key
 * is supplied, which defeats the unique index on (workspace_id, idempotency_key)
 * and lets a double-tap or network retry deliver the same message to a customer
 * twice.
 *
 * Preferred path — the caller passes `submissionKey`, a value generated once per
 * composed message and reused across retries. This is exact: retries dedupe, and a
 * genuinely new message always gets a new key.
 *
 * Fallback path — older clients that send no submission key get a content hash
 * bucketed into MANUAL_REPLY_DEDUPE_WINDOW_MS. This catches the common accidental
 * double-send. Known limitation: two sends either side of a bucket boundary both
 * go through, and two *intentional* identical messages inside one window collapse
 * to one. That trade is deliberate — delivering a duplicate to a customer is worse
 * than delaying a repeated "ok" by a minute. Clients should send a submission key
 * so this path is never used.
 */
export function manualReplyIdempotencyKey(input: {
  body: string;
  channelType: string;
  conversationId: string;
  now?: Date;
  source: string;
  subject?: string | null;
  submissionKey?: string | null;
}) {
  const submission =
    typeof input.submissionKey === "string" ? input.submissionKey.trim() : "";

  if (submission) {
    return `${input.source}.${input.conversationId}.${submission}`;
  }

  const digest = createHash("sha256")
    .update(`${input.subject ?? ""}\n${input.body}`)
    .digest("hex")
    .slice(0, 16);
  const bucket = Math.floor(
    (input.now?.getTime() ?? Date.now()) / MANUAL_REPLY_DEDUPE_WINDOW_MS,
  );

  return `${input.source}.${input.conversationId}.${input.channelType}.${digest}.${bucket}`;
}
