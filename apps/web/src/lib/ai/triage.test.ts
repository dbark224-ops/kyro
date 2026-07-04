import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReplyBody, extractInquiryFacts } from "./triage";

describe("inbound inquiry requirements", () => {
  it("asks email-originated inquiries for address, preferred time, and phone when missing", () => {
    const facts = extractInquiryFacts({
      contactEmail: "david@example.com",
      inboundChannelType: "email",
      leadTitle: "Room Addition Quote",
      summary:
        "Gmail email from David: Do you have availability to come out and quote on a room add-on this week? House in Mesilla.",
    });

    assert.equal(facts.jobType, "Room Addition Quote");
    assert.deepEqual(facts.missingInfo, [
      "Job address",
      "Phone number",
    ]);
    assert.match(buildReplyBody(facts), /job address/i);
    assert.match(buildReplyBody(facts), /phone number/i);
  });

  it("does not ask for phone when the CRM profile already has one", () => {
    const facts = extractInquiryFacts({
      contactEmail: "david@example.com",
      contactPhone: "+15755712705",
      inboundChannelType: "email",
      summary:
        "Gmail email from David: Can you quote a bathroom renovation on Friday at 10 Smith Street?",
    });

    assert.equal(facts.missingInfo.includes("Phone number"), false);
  });

  it("asks SMS-originated inquiries for email when missing", () => {
    const facts = extractInquiryFacts({
      contactPhone: "+15755712705",
      inboundChannelType: "sms",
      summary:
        "Inbound SMS from David: Need a bathroom quote at 10 Smith Street tomorrow.",
    });

    assert.equal(facts.missingInfo.includes("Email address"), true);
    assert.match(buildReplyBody(facts), /email address/i);
  });
});
