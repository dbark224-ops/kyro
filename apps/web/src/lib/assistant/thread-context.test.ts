import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recentWorkQueueConversationIds } from "./conversation-links";
import type { AssistantRecentMessage } from "./types";

/**
 * Replying to an inquiry briefing over SMS has to find the conversation.
 *
 * It could not. On a text surface the assistant result is deliberately
 * stripped of links and UI blocks for display -- you cannot tap a card in a
 * text message -- and the only surviving record of which conversations a
 * message was about is metadata.contextLinks. The refresh pass then rebuilt
 * `links` from the UI blocks alone, which on those surfaces are empty, so
 * every texted turn came back with no links at all.
 *
 * The visible symptom: reply to a new-inquiry alert and Kyro answers "I need
 * to know which inquiry you mean", straight after telling you about it.
 *
 * These assert the reader's contract. A message that carries conversation
 * links must yield their ids regardless of whether those links arrived in UI
 * blocks or in contextLinks.
 */
function assistantMessage(
  overrides: Partial<AssistantRecentMessage> = {},
): AssistantRecentMessage {
  return {
    content: "Here is what needs a response.",
    createdAt: new Date().toISOString(),
    intent: "work_queue",
    links: [],
    role: "assistant",
    uiBlocks: [],
    ...overrides,
  } as AssistantRecentMessage;
}

describe("finding the conversation a texted briefing was about", () => {
  it("reads ids from links even with no UI blocks", () => {
    // Exactly the SMS shape: blocks stripped, links preserved.
    const ids = recentWorkQueueConversationIds([
      assistantMessage({
        links: [
          { href: "/inbox/conv-a", label: "+15855556666" },
          { href: "/inbox/conv-b", label: "David inquiry" },
        ],
      }),
    ]);

    assert.deepEqual(ids, ["conv-a", "conv-b"]);
  });

  it("accepts the query-string href the briefing uses", () => {
    // saveInquiryBriefingToFieldThread writes /inbox?conversationId=…
    const ids = recentWorkQueueConversationIds([
      assistantMessage({
        intent: "inquiry_owner_question",
        links: [{ href: "/inbox?conversationId=conv-c", label: "Marcus" }],
      }),
    ]);

    assert.deepEqual(ids, ["conv-c"]);
  });

  it("ignores messages that are not about the work queue", () => {
    const ids = recentWorkQueueConversationIds([
      assistantMessage({
        intent: "general_chat",
        links: [{ href: "/inbox/conv-d", label: "Someone" }],
      }),
    ]);

    assert.deepEqual(ids, []);
  });

  it("ignores the user's own messages", () => {
    const ids = recentWorkQueueConversationIds([
      assistantMessage({
        links: [{ href: "/inbox/conv-e", label: "Someone" }],
        role: "user",
      }),
    ]);

    assert.deepEqual(ids, []);
  });

  it("drops mentions older than the window", () => {
    const ids = recentWorkQueueConversationIds(
      [
        assistantMessage({
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          links: [{ href: "/inbox/conv-f", label: "Stale" }],
        }),
      ],
      { maxAgeMs: 30 * 60 * 1000 },
    );

    assert.deepEqual(ids, []);
  });

  it("returns the most recently mentioned first", () => {
    // "that one" means the last thing discussed.
    const ids = recentWorkQueueConversationIds([
      assistantMessage({
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        links: [{ href: "/inbox/older", label: "Older" }],
      }),
      assistantMessage({
        links: [{ href: "/inbox/newer", label: "Newer" }],
      }),
    ]);

    assert.equal(ids[0], "newer");
  });
});
