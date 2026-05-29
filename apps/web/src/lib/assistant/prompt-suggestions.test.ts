import assert from "node:assert/strict";
import test from "node:test";
import {
  containsUnsafeAssistantPromptSuggestionSpecifics,
  deterministicAssistantPromptSuggestionsFromTextSamples,
  normalizeAssistantPromptSuggestions,
  rotateAssistantPromptSuggestions,
} from "./prompt-suggestions";

test("normalizes reusable prompt suggestions and rejects customer-specific details", () => {
  const suggestions = normalizeAssistantPromptSuggestions([
    "  1. Show me leads needing reply!  ",
    "Show me leads needing reply",
    "What happened with Jamie Redknapp",
    "Email sarah@example.com",
    "Call +61 400 000 000",
    "Generate a project concept image.",
  ]);

  assert.deepEqual(suggestions, [
    "Show me leads needing reply",
    "Generate a project concept image",
  ]);
  assert.equal(
    containsUnsafeAssistantPromptSuggestionSpecifics(
      "Show me the Jason Tindall inquiry",
    ),
    true,
  );
});

test("builds deterministic fallback suggestions from repeated workflows", () => {
  const suggestions = deterministicAssistantPromptSuggestionsFromTextSamples([
    "Show me leads that need a reply",
    "Any quotes ready to send today?",
    "Can you generate an image of a bathroom renovation concept?",
    "Show me usage and billing costs",
  ]);

  assert.ok(suggestions.includes("Show me leads needing reply"));
  assert.ok(suggestions.includes("What quote drafts are ready"));
  assert.ok(suggestions.includes("Generate a project concept image"));
  assert.ok(suggestions.includes("Show usage and costs"));
});

test("rotates visible suggestions without changing the stored suggestion set", () => {
  const suggestions = [
    "One reusable action",
    "Two reusable action",
    "Three reusable action",
    "Four reusable action",
    "Five reusable action",
  ];
  const visible = rotateAssistantPromptSuggestions(
    suggestions,
    new Date("2026-05-28T00:00:00.000Z"),
    4,
  );

  assert.equal(visible.length, 4);
  assert.equal(new Set(visible).size, 4);
  assert.deepEqual(suggestions, [
    "One reusable action",
    "Two reusable action",
    "Three reusable action",
    "Four reusable action",
    "Five reusable action",
  ]);
});
