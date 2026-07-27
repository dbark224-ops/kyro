import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deleteConversationCommand,
  restoreConversationCommand,
} from "./conversation-mailbox-intent";

/**
 * Deleting the wrong conversation is the failure that matters here, so these
 * cover which one gets picked rather than the update itself.
 *
 * Kyro previously had no tool for this at all: asked over SMS to delete a
 * message it had just listed, it dropped the message from its own reply and
 * moved on, which reads as "done" while the inbox is untouched.
 */
const WORKSPACE = { id: "ws-1" };
const USER = { id: "user-1" } as never;

/** Minimal stand-ins for the two calls the command actually makes. */
function fakeSupabase(rows: unknown[]) {
  const updates: Array<Record<string, unknown>> = [];

  return {
    client: {
      from(table: string) {
        return {
          insert() {
            return Promise.resolve({ error: null });
          },
          update(values: Record<string, unknown>) {
            const chain = {
              eq() {
                return chain;
              },
              then(resolve: (value: { error: null }) => unknown) {
                return Promise.resolve({ error: null }).then(resolve);
              },
            };

            if (table === "conversations") {
              updates.push(values);
            }

            return chain;
          },
        };
      },
      rows,
    } as never,
    updates,
  };
}

/**
 * getConversationList is module-scoped, so rather than intercept it these tests
 * drive the command through the one path that does not need it -- no recent
 * mention -- plus direct checks on the shape it returns. The resolution rules
 * themselves are covered by recentInquiryConversationForPrompt's own tests.
 */
describe("deleting a conversation the assistant just mentioned", () => {
  it("asks which one when nothing was mentioned recently", async () => {
    const { client } = fakeSupabase([]);

    const result = await deleteConversationCommand({
      prompt: "delete that one",
      recentMessages: [],
      supabase: client,
      user: USER,
      workspace: WORKSPACE,
    });

    assert.equal(result.intent, "conversation_delete");
    assert.equal(result.context.changed, false);
    assert.match(result.fallbackAnswer, /which conversation/i);
  });

  it("does not claim to have deleted anything when it has not", async () => {
    const { client, updates } = fakeSupabase([]);

    const result = await deleteConversationCommand({
      prompt: "delete that one",
      recentMessages: [],
      supabase: client,
      user: USER,
      workspace: WORKSPACE,
    });

    assert.equal(updates.length, 0, "no write should have been attempted");
    assert.doesNotMatch(result.fallbackAnswer, /deleted|removed/i);
  });

  it("points at the inbox so the user can act themselves", async () => {
    const { client } = fakeSupabase([]);

    const result = await deleteConversationCommand({
      prompt: "delete that one",
      recentMessages: [],
      supabase: client,
      user: USER,
      workspace: WORKSPACE,
    });

    assert.ok(result.links.some((link) => link.href === "/inbox"));
  });
});

describe("restoring a conversation", () => {
  it("asks which one when nothing was mentioned recently", async () => {
    const { client } = fakeSupabase([]);

    const result = await restoreConversationCommand({
      prompt: "put that back",
      recentMessages: [],
      supabase: client,
      user: USER,
      workspace: WORKSPACE,
    });

    assert.equal(result.intent, "conversation_restore");
    assert.equal(result.context.changed, false);
    assert.match(result.fallbackAnswer, /which conversation/i);
  });
});
