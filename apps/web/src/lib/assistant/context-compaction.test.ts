import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactAssistantMessagesForSnapshot } from "./context-compaction";

describe("assistant context compaction", () => {
  it("summarizes user requests and assistant outcomes without dropping source message ids", () => {
    const snapshot = compactAssistantMessagesForSnapshot({
      messages: [
        {
          content:
            "Can you create a high-end bathroom image overlooking Sydney Harbour?",
          createdAt: "2026-05-27T01:00:00.000Z",
          id: "message-1",
          role: "user",
        },
        {
          content: "I generated the image and saved it to Kyro files.",
          createdAt: "2026-05-27T01:01:00.000Z",
          id: "message-2",
          intent: "image_generation",
          role: "assistant",
          uiBlocks: [
            {
              images: [
                {
                  prompt:
                    "High-end luxury bathroom overlooking Sydney Harbour",
                },
              ],
              type: "generated_image",
            },
          ],
        },
      ],
      periodEnd: new Date("2026-05-27T01:01:00.000Z"),
      periodStart: new Date("2026-05-27T00:00:00.000Z"),
      snapshotType: "daily",
    });

    assert.equal(snapshot.messageCount, 2);
    assert.deepEqual(snapshot.sourceMessageIds, ["message-1", "message-2"]);
    assert.match(snapshot.summary, /bathroom image/i);
    assert.match(snapshot.summary, /image_generation/i);
    assert.ok(
      snapshot.keyPoints.some((point) =>
        point.includes("High-end luxury bathroom"),
      ),
    );
  });

  it("keeps compacted summaries short enough for prompt context", () => {
    const snapshot = compactAssistantMessagesForSnapshot({
      messages: Array.from({ length: 30 }, (_, index) => ({
        content: `Message ${index} about a long-running quote, contact, generated image, and customer follow-up workflow.`,
        createdAt: `2026-05-27T01:${String(index).padStart(2, "0")}:00.000Z`,
        id: `message-${index}`,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      })),
      periodEnd: new Date("2026-05-27T01:30:00.000Z"),
      periodStart: new Date("2026-05-27T00:00:00.000Z"),
      snapshotType: "daily",
    });

    assert.ok(snapshot.summary.length <= 2400);
    assert.ok(snapshot.keyPoints.length <= 12);
  });
});
