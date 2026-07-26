import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeInquiryAvailabilityOfferRequest } from "./inquiry-intent";

/**
 * This gate decides whether Kyro resolves a real calendar slot and hands it to
 * the reply writer. When it misses, the writer has nothing specific to offer
 * and falls back to "we can come Tuesday, what time suits" -- the vagueness
 * the owner kept hitting.
 *
 * The original matcher wanted offer/propose/suggest adjacent to
 * time/slot/availability and missed half of how people actually ask.
 */
describe("recognises a request to offer a time", () => {
  for (const prompt of [
    "see what time we have free on Monday and offer him a time then",
    "look at the calendar and offer him a time on Monday",
    "check the calendar and suggest a time on Tuesday",
    "offer him a time on Monday",
    // All of these used to fall through.
    "look at the calendar and book him in Tuesday",
    "what days are we free this week, offer him one",
    "reply and give him a time on monday",
    "see when we're free monday and let him know",
    "look at my calendar and propose something for Monday",
    "offer them an appointment on Monday",
    "check availability monday and reply",
    "find him a slot on Thursday",
    "pencil him in for a time on Friday",
  ]) {
    it(`matches: ${prompt}`, () => {
      assert.equal(looksLikeInquiryAvailabilityOfferRequest(prompt), true);
    });
  }
});

describe("leaves other instructions alone", () => {
  for (const prompt of [
    // Dictating the message, not asking for a calendar check. The reply writer
    // already treats a day the user supplies as authorised availability.
    "tell him we can come Tuesday",
    "reply saying we are based in NM and Florida work incurs travel costs",
    "let him know the quote is attached",
    // Asking for advice is not asking Kyro to reserve anything.
    "what should I say to him about Monday",
    "how should we reply to this",
  ]) {
    it(`does not match: ${prompt}`, () => {
      assert.equal(looksLikeInquiryAvailabilityOfferRequest(prompt), false);
    });
  }
});
