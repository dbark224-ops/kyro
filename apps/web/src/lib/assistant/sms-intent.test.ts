import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assistantSmsBodyFromPrompt,
  looksLikeDirectWorkplaceSmsRequest,
} from "./sms-intent";

/**
 * Talking about a text is not asking for one to be sent.
 *
 * "Text" is both the verb and the noun, so any sentence naming a text and a
 * team member satisfied every condition this reader had. Measured on ten
 * ordinary sentences and eight routed to the send-an-SMS command, including
 * two that say the opposite: "no text from any team member today" and "don't
 * text the team member yet".
 *
 * Nothing was ever sent -- no body can be extracted from those, so the command
 * asks what the message should say. The cost is that this runs BEFORE the
 * planner, so the owner's real question never reaches the model: they ask
 * whether somebody replied and get asked what they would like to send.
 *
 * The body guard is the reason this was a nuisance rather than an incident,
 * and it is asserted below so it stays that way.
 */
describe("asking to send a workplace SMS, versus talking about one", () => {
  it("routes a real instruction", () => {
    for (const prompt of [
      "send an sms to the team contact",
      "text the staff member about the escalation",
      "send a text message to my internal contact",
      "please send an sms to the staff member about the escalation",
      "text the team member saying I'll be late",
    ]) {
      assert.equal(looksLikeDirectWorkplaceSmsRequest(prompt), true, prompt);
    }
  });

  it("leaves a question about a text alone", () => {
    for (const prompt of [
      "did the team member text back yet",
      "I got a text from a staff member",
      "has the staff member sent a text",
      "text message from a staff member came in",
      "why did the staff member get a text",
      "was that text from the team or a customer",
      "the team member texted about the escalation",
      "should I text the staff member or call",
    ]) {
      assert.equal(looksLikeDirectWorkplaceSmsRequest(prompt), false, prompt);
    }
  });

  it("never reads a refusal as an instruction", () => {
    // The two that mattered most: both say not to send, and both routed to
    // sending.
    for (const prompt of [
      "don't text the team member yet",
      "no text from any team member today",
    ]) {
      assert.equal(looksLikeDirectWorkplaceSmsRequest(prompt), false, prompt);
    }
  });

  it("still refuses to send without a message to send", () => {
    // Belt and braces. Even if something slips past the router again, an
    // empty body must stop the send rather than invent one.
    for (const prompt of [
      "did the team member text back yet",
      "text the staff member about the escalation",
    ]) {
      assert.equal(assistantSmsBodyFromPrompt(prompt), null, prompt);
    }
  });
});

/**
 * The regression the first version of the fix caused, kept as a test.
 *
 * Excluding interrogatives anywhere in the sentence broke a real instruction,
 * because "is" appears in plenty of sentences that are still commands. An
 * existing test caught it. Anchoring them to the start is the difference: a
 * question about a text opens with the question word, a command does not.
 */
describe("a command that happens to contain a question word", () => {
  it("is still a command", () => {
    for (const prompt of [
      "can you send the primary workplace contact an sms, i want to test if that functionality is working",
      "send an sms to the team contact when you have a moment, it is urgent",
      "text the staff member and let me know what the reply is",
    ]) {
      assert.equal(looksLikeDirectWorkplaceSmsRequest(prompt), true, prompt);
    }
  });
});
