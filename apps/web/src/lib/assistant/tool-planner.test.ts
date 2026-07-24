import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAssistantToolPlanResponse } from "./tool-planner";

describe("assistant LLM tool planner response parsing", () => {
  it("extracts a Kyro tool call from an OpenAI Responses payload", () => {
    const selection = parseAssistantToolPlanResponse(
      {
        output: [
          {
            arguments: JSON.stringify({
              confidence: 0.91,
              mode: "edit_previous_image",
              prompt: "make the previous bathroom render nighttime",
              reason: "The user is asking to edit the prior generated image.",
            }),
            name: "kyro_image_generation",
            type: "function_call",
          },
        ],
      },
      "can you make it night time",
    );

    assert.equal(selection?.name, "image_generation");
    assert.equal(selection?.mode, "edit_previous_image");
    assert.equal(
      selection?.prompt,
      "make the previous bathroom render nighttime",
    );
  });

  it("returns null when the model does not call a Kyro tool", () => {
    const selection = parseAssistantToolPlanResponse(
      {
        output_text: "No tool needed.",
      },
      "how are you today",
    );

    assert.equal(selection, null);
  });

  it("extracts assistant history search tool calls", () => {
    const selection = parseAssistantToolPlanResponse(
      {
        output: [
          {
            arguments: JSON.stringify({
              confidence: 0.88,
              mode: "direct",
              prompt: "what did we discuss about the bathroom render yesterday",
              reason: "The user is asking for older assistant chat history.",
            }),
            name: "kyro_history_search",
            type: "function_call",
          },
        ],
      },
      "what did we talk about yesterday",
    );

    assert.equal(selection?.name, "history_search");
    assert.equal(selection?.mode, "direct");
  });

  it("extracts public web search tool calls", () => {
    const selection = parseAssistantToolPlanResponse(
      {
        output: [
          {
            arguments: JSON.stringify({
              confidence: 0.93,
              mode: "direct",
              prompt: "latest QBCC pool fencing rule",
              reason: "The user asks for current public regulatory information.",
            }),
            name: "kyro_web_search",
            type: "function_call",
          },
        ],
      },
      "look up the latest QBCC pool fencing rule",
    );

    assert.equal(selection?.name, "web_search");
    assert.equal(selection?.mode, "direct");
  });

  it("extracts an owner answer for a pending customer inquiry", () => {
    const selection = parseAssistantToolPlanResponse(
      {
        output: [
          {
            arguments: JSON.stringify({
              confidence: 0.97,
              mode: "direct",
              prompt: "Yes, tell them the team can leave the side gate unlocked.",
              reason:
                "The owner answered Kyro's focused question about the current inquiry.",
            }),
            name: "kyro_inquiry_internal_answer",
            type: "function_call",
          },
        ],
      },
      "yes, that is fine",
    );

    assert.equal(selection?.name, "inquiry_internal_answer");
    assert.equal(
      selection?.prompt,
      "Yes, tell them the team can leave the side gate unlocked.",
    );
  });

  it("extracts a resolved calendar operation for a contextual follow-up", () => {
    const selection = parseAssistantToolPlanResponse(
      {
        output: [
          {
            arguments: JSON.stringify({
              calendarOperation: "create",
              confidence: 0.98,
              mode: "direct",
              prompt:
                "Half day off on Friday, July 24, 2026 from 9:00 AM to 1:00 PM",
              reason:
                "The user supplied the missing time window for the requested block.",
            }),
            name: "kyro_calendar_event",
            type: "function_call",
          },
        ],
      },
      "Between 9 and 1 as you said",
    );

    assert.equal(selection?.name, "calendar_event");
    assert.equal(selection?.calendarOperation, "create");
    assert.equal(
      selection?.prompt,
      "Half day off on Friday, July 24, 2026 from 9:00 AM to 1:00 PM",
    );
  });
});
