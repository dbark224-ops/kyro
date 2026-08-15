import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { staleDraftSummary, staleDraftWarnings } from "./stale-draft";

const NOW = new Date("2026-08-05T12:00:00.000Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const phrases = (body: string, days: number) =>
  staleDraftWarnings(body, daysAgo(days), NOW).map((warning) =>
    warning.phrase.toLowerCase(),
  );

describe("a draft that has outlived what it says", () => {
  it("catches a day offered weeks ago", () => {
    // The case this exists for. Sent today, this promises a Tuesday that was
    // six weeks back, and nobody did anything wrong to cause it.
    assert.deepEqual(
      phrases("We can come out Tuesday morning to look at the leak.", 42),
      ["tuesday"],
    );
  });

  it("catches tomorrow, which rots in a day", () => {
    assert.deepEqual(phrases("I can pop round tomorrow if that suits.", 3), [
      "tomorrow",
    ]);
  });

  it("catches the rest of the anchored phrases", () => {
    for (const word of [
      "today",
      "tonight",
      "this morning",
      "this afternoon",
      "this week",
      "next week",
      "first thing",
    ]) {
      assert.deepEqual(
        phrases(`We could get to you ${word}.`, 30),
        [word],
        word,
      );
    }
  });

  it("quotes the customer's words back, not a paraphrase", () => {
    // The owner has to judge it, so they need to see the actual sentence.
    const [warning] = staleDraftWarnings(
      "Thursday at 2pm works our end.",
      daysAgo(20),
      NOW,
    );

    assert.equal(warning.phrase, "Thursday");
    assert.match(warning.reason, /passed/);
  });
});

describe("and the many drafts that are fine", () => {
  it("leaves a draft with no dated claim alone at any age", () => {
    assert.deepEqual(
      phrases(
        "Send us a photo of the leak and we'll take a look and come back to you.",
        70,
      ),
      [],
    );
  });

  it("does not treat opening hours as a stale appointment", () => {
    // The false positive worth designing out: this appears in a great many
    // replies and is not an offer of a visit.
    for (const hours of [
      "We're open Monday to Friday, 8am to 4pm.",
      "Our hours are Monday-Friday.",
      "Someone is around Monday through Friday if you need us.",
    ]) {
      assert.deepEqual(phrases(hours, 60), [], hours);
    }
  });

  it("says nothing about a draft written moments ago", () => {
    assert.deepEqual(phrases("I can come tomorrow at 9.", 0), []);
    assert.deepEqual(phrases("Tuesday morning suits us.", 2), []);
  });

  it("waits a full week before doubting a named day", () => {
    // Six days on, "Tuesday" may well still be the Tuesday that was meant.
    assert.deepEqual(phrases("Tuesday morning suits us.", 6), []);
    assert.deepEqual(phrases("Tuesday morning suits us.", 8), ["tuesday"]);
  });
});

describe("it cannot take the approve button down with it", () => {
  it("returns nothing rather than throwing on anything missing", () => {
    for (const [body, written] of [
      [null, null],
      [undefined, undefined],
      ["", daysAgo(30)],
      ["   ", daysAgo(30)],
      ["We can come Tuesday.", null],
      ["We can come Tuesday.", "not a date"],
      // A draft dated in the future is a clock problem, not a stale draft.
      ["We can come Tuesday.", new Date(NOW.getTime() + 86_400_000).toISOString()],
    ] as const) {
      assert.deepEqual(staleDraftWarnings(body, written, NOW), [], String(body));
    }
  });

  it("summarises only when there is something to say", () => {
    assert.equal(staleDraftSummary([]), null);
    assert.match(
      staleDraftSummary(staleDraftWarnings("Come Tuesday.", daysAgo(30), NOW)) ??
        "",
      /Tuesday/,
    );
  });
});
