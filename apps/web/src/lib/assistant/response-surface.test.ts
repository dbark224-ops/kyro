import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assistantResponseSurface,
  projectAssistantResultForSurface,
} from "./response-surface";
import type { AssistantTurnResult } from "./types";

const result: AssistantTurnResult = {
  content: "The event was created for Friday at 10:00 AM.",
  id: "run-1",
  intent: "calendar_event",
  links: [{ href: "/calendar?event=event-1", label: "View event" }],
  model: "test-model",
  provider: "test-provider",
  role: "assistant",
  toolCalls: [],
  uiBlocks: [
    {
      links: [{ href: "/calendar?event=event-1", label: "View event" }],
      title: "Calendar event created",
      type: "link_cards",
    },
  ],
};

test("classifies SMS and WhatsApp Sandbox as text-only surfaces", () => {
  assert.equal(assistantResponseSurface("sms"), "text_only");
  assert.equal(assistantResponseSurface("whatsapp"), "text_only");
  assert.equal(assistantResponseSurface("whatsapp_sandbox"), "text_only");
  assert.equal(assistantResponseSurface("typed"), "interactive");
  assert.equal(assistantResponseSurface("voice"), "interactive");
});

test("removes invisible links and UI blocks from text-only results", () => {
  const projected = projectAssistantResultForSurface(result, "sms");

  assert.equal(projected.content, result.content);
  assert.deepEqual(projected.contextLinks, result.links);
  assert.deepEqual(projected.links, []);
  assert.deepEqual(projected.uiBlocks, []);
  assert.deepEqual(projectAssistantResultForSurface(result, "typed"), result);
});

test("replaces invisible UI references with the command's text answer", () => {
  const projected = projectAssistantResultForSurface(
    {
      ...result,
      content: "I created the event. See the card below for the details.",
    },
    "whatsapp_sandbox",
    "I created Site visit for Friday at 10:00 AM.",
  );

  assert.equal(
    projected.content,
    "I created Site visit for Friday at 10:00 AM.",
  );
});

test("rewrites known fallback references when no cleaner answer exists", () => {
  const projected = projectAssistantResultForSurface(
    {
      ...result,
      content: "Open the inquiry below if you want to review it.",
    },
    "sms",
  );

  assert.equal(
    projected.content,
    "Open Kyro's Inbox if you want to review it.",
  );
});
