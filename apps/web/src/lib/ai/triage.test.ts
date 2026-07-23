import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildReplyBody,
  canAnswerWithKnownBusinessFacts,
  canAutoReplyWithKnownBusinessFacts,
  directKnownBusinessFactKeys,
  ensureReplyDraftCoversMissingInfo,
  applyResponsePolicyToInquiryFacts,
  extractInquiryFacts,
  loadLatestInboundMessageBody,
  outboundReplyChannelForInquiryContext,
  type InquiryFacts,
} from "./triage";

const publicFacts = {
  businessAddress: "100 Main Street",
  businessName: "Kyro Plumbing",
  contactHours: "Monday to Friday, 8:00 AM to 5:00 PM",
  industry: "Plumbing",
  publicEmail: "hello@example.com",
  publicPhoneNumber: "+15755550123",
  serviceArea: "Las Cruces",
  workingHours: "Monday to Friday, 7:00 AM to 4:00 PM",
};

describe("known business fact auto replies", () => {
  it("recognizes a plain-language request for the business phone number", () => {
    assert.deepEqual(
      directKnownBusinessFactKeys(
        "Hi - can yall give me a phone number to call?",
      ),
      ["publicPhoneNumber"],
    );
  });

  it("allows a grounded public phone-number answer from the primary model", () => {
    assert.equal(
      canAutoReplyWithKnownBusinessFacts({
        enabled: true,
        latestMessage: "What phone number can I call?",
        providerUsed: "openai",
        publicBusinessFacts: publicFacts,
        replyBody: "You can call Kyro Plumbing on +1 575 555 0123.",
        responsePolicy: {
          factKeys: ["publicPhoneNumber"],
          mode: "known_business_fact",
          reason: "The caller asked for a saved public business detail.",
        },
      }),
      true,
    );
  });

  it("does not accept job-intake boilerplate as a grounded fact reply", () => {
    assert.equal(
      canAnswerWithKnownBusinessFacts({
        publicBusinessFacts: publicFacts,
        replyBody:
          "Please send the job address, preferred time, and a phone number.",
        responsePolicy: {
          factKeys: ["publicPhoneNumber"],
          mode: "known_business_fact",
          reason: "The customer asked for the business phone number.",
        },
      }),
      false,
    );
  });

  it("keeps quotes and ungrounded facts behind approval", () => {
    assert.equal(
      canAutoReplyWithKnownBusinessFacts({
        enabled: true,
        latestMessage: "Can you quote this and come out tomorrow?",
        providerUsed: "openai",
        publicBusinessFacts: publicFacts,
        replyBody: "We can come tomorrow.",
        responsePolicy: {
          factKeys: ["workingHours"],
          mode: "known_business_fact",
          reason: "Availability request.",
        },
      }),
      false,
    );

    assert.equal(
      canAutoReplyWithKnownBusinessFacts({
        enabled: true,
        latestMessage: "What is your service area?",
        providerUsed: "openai",
        publicBusinessFacts: {
          ...publicFacts,
          serviceArea: "",
        },
        replyBody: "We service Las Cruces.",
        responsePolicy: {
          factKeys: ["serviceArea"],
          mode: "known_business_fact",
          reason: "Service-area question.",
        },
      }),
      false,
    );
  });
});

describe("inbound inquiry requirements", () => {
  it("does not attach job-intake requirements to a simple business message", () => {
    const facts = applyResponsePolicyToInquiryFacts(
      {
        address: null,
        budget: null,
        fit: "likely_fit",
        jobType: "Bathroom Quote",
        missingInfo: ["Job address", "Preferred time", "Phone number"],
        preferredTime: null,
        urgency: "normal",
      },
      {
        contactEmail: "david@example.com",
        inboundChannelType: "email",
        latestMessage: "Can I send you photos before the quote?",
      },
      {
        factKeys: [],
        mode: "simple_business_message",
        reason: "The customer asked a standalone process question.",
      },
    );

    assert.deepEqual(facts, {
      address: null,
      budget: null,
      fit: "likely_fit",
      jobType: null,
      missingInfo: [],
      preferredTime: null,
      urgency: "normal",
    });
  });

  it("retains required details after the model classifies a genuine service inquiry", () => {
    const facts = applyResponsePolicyToInquiryFacts(
      {
        address: null,
        budget: null,
        fit: "likely_fit",
        jobType: "Bathroom Renovation Quote",
        missingInfo: [],
        preferredTime: null,
        urgency: "normal",
      },
      {
        contactEmail: "david@example.com",
        inboundChannelType: "email",
      },
      {
        factKeys: [],
        mode: "service_inquiry",
        reason: "The customer requested a quote for specific work.",
      },
    );

    assert.deepEqual(facts.missingInfo, [
      "Job address",
      "Preferred time",
      "Phone number",
    ]);
  });

  it("asks email-originated inquiries for address, preferred time, and phone when missing", () => {
    const facts = extractInquiryFacts({
      contactEmail: "david@example.com",
      inboundChannelType: "email",
      leadTitle: "Room Addition Quote",
      summary:
        "Gmail email from David: Do you have availability to come out and quote on a room add-on this week? House in Mesilla.",
    });

    assert.equal(facts.jobType, "Room Addition Quote");
    assert.deepEqual(facts.missingInfo, ["Job address", "Phone number"]);
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

  it("keeps SMS inquiries on SMS for generated replies", () => {
    assert.equal(
      outboundReplyChannelForInquiryContext({
        inboundChannelType: "sms",
        source: "developer.mock_sms",
      }),
      "sms",
    );
    assert.equal(
      outboundReplyChannelForInquiryContext({
        inboundChannelType: "email",
        source: "gmail.poll",
      }),
      "email",
    );
  });

  it("folds missing requirements into one natural reply ask", () => {
    const facts: InquiryFacts = {
      address: null,
      budget: null,
      fit: "likely_fit",
      jobType: "Bathroom remodel",
      missingInfo: ["Job address", "Preferred time", "Phone number"],
      preferredTime: null,
      urgency: "normal",
    };
    const draft = ensureReplyDraftCoversMissingInfo(
      {
        subject: "Re: Bathroom remodel",
        body: "Thanks for reaching out about your bathroom remodel for the vanity sink and shower/bath. To arrange a quote visit next week, could you please provide the job address and your preferred day or time? Looking forward to helping you with this project.",
      },
      facts,
    );

    assert.match(draft.body ?? "", /job address/i);
    assert.match(draft.body ?? "", /preferred day or time/i);
    assert.match(draft.body ?? "", /phone number/i);
    assert.doesNotMatch(draft.body ?? "", /could you also/i);
  });
});

describe("latest inbound message loading", () => {
  it("reads the canonical body_text column used by the messages table", async () => {
    let selectedColumn = "";
    const query = {
      eq() {
        return query;
      },
      maybeSingle() {
        return Promise.resolve({
          data: { body_text: "Landscaping enquiry body" },
          error: null,
        });
      },
      select(column: string) {
        selectedColumn = column;
        return query;
      },
    };
    const supabase = {
      from(table: string) {
        assert.equal(table, "messages");
        return query;
      },
    } as unknown as SupabaseClient;

    const body = await loadLatestInboundMessageBody(
      supabase,
      "workspace-1",
      "message-1",
    );

    assert.equal(selectedColumn, "body_text");
    assert.equal(body, "Landscaping enquiry body");
  });
});
