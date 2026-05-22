import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPronunciationCandidates } from "./pronunciation";

describe("extractPronunciationCandidates", () => {
  it("ignores ordinary football words and possessives", () => {
    const candidates = extractPronunciationCandidates(
      "Premier League latest: Arsenal's table result was correct.",
    );

    assert.deepEqual(candidates, []);
  });

  it("keeps genuinely unusual names, places, and acronyms", () => {
    const candidates = extractPronunciationCandidates(
      "Viktor Gyökeres visited Woolloongabba with QXJ Plumbing and Cooparoo Supplies.",
    );

    assert.ok(candidates.includes("Gyökeres"));
    assert.ok(candidates.includes("Woolloongabba"));
    assert.ok(candidates.includes("QXJ"));
    assert.ok(candidates.includes("Cooparoo"));
  });

  it("deduplicates candidates case-insensitively", () => {
    const candidates = extractPronunciationCandidates(
      "Woolloongabba and Woolloongabba were both mentioned.",
    );

    assert.deepEqual(candidates, ["Woolloongabba"]);
  });
});
