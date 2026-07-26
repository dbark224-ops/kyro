import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAssistantCurrentTimeContext } from "../assistant/current-time";
import { buildReplyDraftPrompt } from "./reply-draft-generation";

/**
 * The writer has to know what day it is.
 *
 * Asked on Sunday 26 July 2026 to offer the customer a time "on Monday", Kyro
 * offered Monday the 20th -- six days in the past. The date parser was never at
 * fault: calendarDateRangeFromPrompt resolves that same phrase to Monday 27
 * July correctly. The reply writer simply had no idea what "today" was, so when
 * no verified slot was attached it invented a plausible-sounding Monday.
 *
 * These tests assert the workspace clock reaches the prompt, because that is
 * the part that silently went missing.
 */
const SUNDAY = new Date("2026-07-26T18:00:00Z");

function promptFor(currentTime: ReturnType<typeof buildAssistantCurrentTimeContext> | null) {
  return buildReplyDraftPrompt({
    channelType: "sms",
    currentTime,
    prompt: "see what time we have free on Monday and offer him a time",
    source: "conversation",
  });
}

describe("the reply writer knows what day it is", () => {
  it("puts the workspace date in the prompt", () => {
    const prompt = promptFor(
      buildAssistantCurrentTimeContext("America/Denver", SUNDAY),
    );

    assert.match(prompt, /2026-07-26/, "the workspace-local date must be present");
    assert.match(prompt, /Sunday/, "the weekday must be present");
    assert.match(prompt, /America\/Denver/);
  });

  it("names tomorrow, so 'Monday' resolves forwards", () => {
    const prompt = promptFor(
      buildAssistantCurrentTimeContext("America/Denver", SUNDAY),
    );

    // Sunday the 26th -> Monday the 27th. The bug offered the 20th.
    assert.match(prompt, /2026-07-27/);
    assert.doesNotMatch(
      prompt,
      /2026-07-20/,
      "nothing should point the model at the previous Monday",
    );
  });

  it("uses the workspace timezone, not the server's", () => {
    // 18:00Z on the 26th is still the 26th in Denver but the 27th in Sydney.
    const denver = buildAssistantCurrentTimeContext("America/Denver", SUNDAY);
    const sydney = buildAssistantCurrentTimeContext("Australia/Sydney", SUNDAY);

    assert.match(promptFor(denver), /2026-07-26/);
    assert.match(promptFor(sydney), /2026-07-27/);
  });

  it("tells the model the local date wins over UTC", () => {
    const prompt = promptFor(
      buildAssistantCurrentTimeContext("America/Denver", SUNDAY),
    );

    assert.match(prompt, /only source of truth for today/i);
    assert.match(prompt, /Never substitute the UTC calendar date/i);
  });

  it("omits the clock line rather than inventing one when absent", () => {
    const prompt = promptFor(null);

    assert.doesNotMatch(prompt, /Authoritative workspace date/);
  });
});
