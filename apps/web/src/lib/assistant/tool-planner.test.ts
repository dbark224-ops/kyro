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
});
