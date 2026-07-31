import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  replyDraftMissingInfoGaps,
  canAnswerWithKnownBusinessFacts,
  canAutoReplyWithKnownBusinessFacts,
  directKnownBusinessFactKeys,

  inquiryFactsWithVerifiedAvailability,
  applyResponsePolicyToInquiryFacts,
  extractInquiryFacts,
  loadLatestInboundMessageBody,
  outboundReplyChannelForInquiryContext,
  shouldResolveAvailabilityForTriage,
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

/**
 * Kyro told a customer the business covered a city 225 miles outside its area.
 *
 * "Hi, do you cover Albuquerque?" came back as "yes, we cover Albuquerque"
 * for a business whose service area is Las Cruces. Measured live, not
 * hypothesised.
 *
 * Cause: serviceArea only matched the abstract phrasing -- "what areas do you
 * cover?" -- and not the way people actually ask, which is about their own
 * town. With no service area in the prompt, the model filled the gap.
 *
 * Same failure as `can't` versus `cannot`: a pattern covering one phrasing and
 * missing the ones people write. A prompt rule now also forbids answering the
 * question at all when the fact is absent, because some phrasings are
 * deliberately blocked from auto-answering and suppressing the fact has to
 * suppress the claim too.
 */
describe("asking whether a place is covered", () => {
  const surfaces = (message: string) =>
    directKnownBusinessFactKeys(message).includes("serviceArea");

  it("recognises the question asked about a named place", () => {
    for (const message of [
      "do you cover Albuquerque?",
      "Hi, do you cover Albuquerque? Need a new outdoor tap fitted",
      "does your business service Santa Fe",
      "do you travel to Belen?",
      "are you in my area",
      "what areas do you cover?",
    ]) {
      assert.equal(surfaces(message), true, message);
    }
  });

  it("does not fire on an ordinary job request", () => {
    for (const message of [
      "the shower tray needs re-sealing, can you quote",
      "do you do bathroom refits",
      "are you able to fit a new tap",
      "do you cover the cost of parts",
    ]) {
      assert.equal(surfaces(message), false, message);
    }
  });

  it("still yields to the booking block, which the prompt rule now backs up", () => {
    // "come out" is in KNOWN_FACT_AUTO_REPLY_BLOCKED_PATTERN, so these
    // deliberately surface nothing -- they are closer to a booking request
    // than a factual question. The rule against claiming coverage without the
    // fact is what stops the model answering anyway.
    assert.equal(surfaces("do you come out to Rio Rancho"), false);
    assert.equal(surfaces("can someone come out to Corrales"), false);
  });
});

/**
 * The same sweep that went nine-for-nine on the escalation triggers, applied
 * to the questions customers ask about the business itself.
 *
 * Measured before: 9 of 24 natural phrasings recognised. "what's your address"
 * -- the commonest form there is -- needed the literal word "business" in
 * front of "address". "when are you open" needed "hours" as a noun. The phone
 * pattern knew "call", "phone", "reach" and "contact" but not "ring".
 *
 * Lower stakes than an escalation, and worth saying why: triage.ts passes the
 * whole publicBusinessFacts object into every prompt regardless, so a miss
 * never hid the fact from the model. It only meant the message was not routed
 * through the grounded known-business-fact mode, where the answer is held to
 * the saved value exactly. Crisper answers rather than correct ones.
 *
 * The controls matter more than usual here, because this decides whether a
 * message is treated as a question about the business instead of a job.
 */
describe("questions about the business, however they are asked", () => {
  const recognises = (message: string, key: string) =>
    directKnownBusinessFactKeys(message).includes(key as never);

  it("recognises all of these", () => {
    const cases: Array<[string, string]> = [
      ["can I have your number", "publicPhoneNumber"],
      ["what number can I call you on", "publicPhoneNumber"],
      ["is there a phone number for you", "publicPhoneNumber"],
      ["how do I ring you", "publicPhoneNumber"],
      ["can I email you instead", "publicEmail"],
      ["what email should I use", "publicEmail"],
      ["is there an email I can send photos to", "publicEmail"],
      ["what's your address", "businessAddress"],
      ["where's your shop", "businessAddress"],
      ["whereabouts are you based", "businessAddress"],
      ["what hours do you work", "workingHours"],
      ["when are you open", "workingHours"],
      ["are you open on Saturdays", "workingHours"],
      ["when's a good time to ring", "contactHours"],
    ];

    for (const [message, key] of cases) {
      assert.ok(recognises(message, key), `${key}: ${message}`);
    }
  });

  it("does not treat ordinary job talk as a question about the business", () => {
    // "I'll send you my address later" and "the address is 615 Girard Blvd NE"
    // are the ones to watch: an address in the message is the customer's, not
    // a request for the firm's.
    for (const message of [
      "the shower tray needs re-sealing, can you quote",
      "do you do bathroom refits",
      "are you able to fit a new tap",
      "I'll send you my address later",
      "the address is 615 Girard Blvd NE",
      "we need a new radiator in the back bedroom",
      "can you come Friday at 3pm",
      "do you cover the cost of parts",
    ]) {
      assert.deepEqual(directKnownBusinessFactKeys(message), [], message);
    }
  });
});

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
          informationNeed: null,
          mode: "known_business_fact",
          ownerQuestion: null,
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
          informationNeed: null,
          mode: "known_business_fact",
          ownerQuestion: null,
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
          informationNeed: null,
          mode: "known_business_fact",
          ownerQuestion: null,
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
          informationNeed: null,
          mode: "known_business_fact",
          ownerQuestion: null,
          reason: "Service-area question.",
        },
      }),
      false,
    );
  });
});

describe("inbound inquiry requirements", () => {
  it("resolves a real slot when inquiry autonomy allows Kyro to propose one", () => {
    assert.equal(
      shouldResolveAvailabilityForTriage({
        inboundInquiryMode: "propose_for_approval",
        preferredTime: "next week",
        responseMode: "service_inquiry",
      }),
      true,
    );
    assert.equal(
      shouldResolveAvailabilityForTriage({
        inboundInquiryMode: "capture_notify",
        preferredTime: "next week",
        responseMode: "service_inquiry",
      }),
      false,
    );
  });

  // This assertion used to require the opposite -- that preferredTime be
  // replaced by the slot label -- and so encoded the defect rather than
  // guarding against it. That overwrite made one field mean "what the customer
  // asked for" before a calendar lookup and "what Kyro offered" after, and the
  // stored answer was later re-parsed as the next request, walking an urgent
  // job's appointment five days out.
  it("closes the preferred-time gap without rewriting what was asked", () => {
    const facts = inquiryFactsWithVerifiedAvailability(
      {
        address: null,
        budget: null,
        fit: "likely_fit",
        jobType: "Bond clean",
        missingInfo: ["Job address", "Preferred time", "Email address"],
        preferredTime: "next week",
        urgency: "normal",
      },
      {
        endsAt: "2026-07-27T17:00:00.000Z",
        label: "Monday, July 27 at 10:00 AM MDT",
        startsAt: "2026-07-27T16:00:00.000Z",
        timeZone: "America/Denver",
      },
    );

    assert.equal(facts.preferredTime, "next week");
    assert.deepEqual(facts.missingInfo, ["Job address", "Email address"]);
  });

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
        informationNeed: null,
        mode: "simple_business_message",
        ownerQuestion: null,
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

  it("does not attach job-intake requirements to an uncommon business question", () => {
    const facts = applyResponsePolicyToInquiryFacts(
      {
        address: null,
        budget: null,
        fit: "likely_fit",
        jobType: "General inquiry",
        missingInfo: ["Job address", "Preferred time", "Phone number"],
        preferredTime: null,
        urgency: "normal",
      },
      {
        inboundChannelType: "email",
        latestMessage:
          "Can your team leave the side gate unlocked after the inspection?",
      },
      {
        factKeys: [],
        informationNeed: "Whether the team can leave the side gate unlocked",
        mode: "tool_assisted_business_message",
        ownerQuestion:
          "Should I tell the customer the team can leave the side gate unlocked?",
        reason: "Only the business can confirm this operating preference.",
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
        informationNeed: null,
        mode: "service_inquiry",
        ownerQuestion: null,
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
    // A draft that asks for neither reports both as still outstanding.
    assert.deepEqual(
      replyDraftMissingInfoGaps({ body: "Thanks, I will take a look.", subject: null }, facts),
      ["Job address", "Phone number"],
    );
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
    assert.ok(
      replyDraftMissingInfoGaps({ body: "No worries, I can help.", subject: null }, facts).includes("Email address"),
    );
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

  it("reports only the requirements the draft has not asked about", () => {
    const facts: InquiryFacts = {
      address: null,
      budget: null,
      fit: "likely_fit",
      jobType: "Bathroom remodel",
      missingInfo: ["Job address", "Preferred time", "Phone number"],
      preferredTime: null,
      urgency: "normal",
    };
    // This draft asks for the address and the time, but not a phone number.
    const gaps = replyDraftMissingInfoGaps(
      {
        subject: "Re: Bathroom remodel",
        body: "Thanks for reaching out about your bathroom remodel for the vanity sink and shower/bath. To arrange a quote visit next week, could you please provide the job address and your preferred day or time? Looking forward to helping you with this project.",
      },
      facts,
    );

    assert.deepEqual(gaps, ["Phone number"]);
  });

  it("treats an empty draft as covering nothing", () => {
    const facts: InquiryFacts = {
      address: null,
      budget: null,
      fit: "likely_fit",
      jobType: "Bathroom remodel",
      missingInfo: ["Job address", "Preferred time"],
      preferredTime: null,
      urgency: "normal",
    };

    assert.deepEqual(
      replyDraftMissingInfoGaps({ body: null, subject: null }, facts),
      ["Job address", "Preferred time"],
    );
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

/**
 * Re-measured after #81 widened these, using phrasings they were NOT written
 * from. That distinction is the whole test: measuring a pattern against its own
 * examples proves nothing, and #81 scored 24 of 24 on its own set while scoring
 * 10 of 20 here.
 *
 * One apparent miss turned out to be correct and is recorded below, because it
 * would otherwise be "fixed" by the next person who measures this.
 */
describe("a question about the business, asked the way people ask it", () => {
  it("recognises phrasings the patterns were not written from", () => {
    for (const [key, message] of [
      ["publicPhoneNumber", "whats the best number to get hold of you on"],
      ["publicPhoneNumber", "do you have a mobile I can text"],
      ["publicPhoneNumber", "who do I ring about this"],
      ["publicEmail", "where should I send the photos"],
      ["businessAddress", "have you got a shop I can come to"],
      ["serviceArea", "are we in your patch"],
      ["serviceArea", "how far do you travel"],
      ["workingHours", "do you work weekends"],
      ["contactHours", "when's the best time to call you"],
      ["contactHours", "what time can I reach someone"],
    ] as const) {
      assert.ok(
        directKnownBusinessFactKeys(message).includes(key),
        `${key}: ${message}`,
      );
    }
  });

  it("does not answer from stored facts when the customer is describing their own job", () => {
    // "you" is load-bearing in several of these patterns. Somebody writing
    // about their own shop, their own mobile or their own working week is not
    // asking anything about the business.
    for (const message of [
      "I've got a shop that needs rewiring",
      "we have a workshop out the back that floods",
      "my mobile is 505-555-0143 if you need it",
      "I'll send the photos over later",
      "the shop next door had you in last week",
      "I work weekends so mornings are hard",
      "best time for me is after four",
      "how far is the leak from the meter",
    ]) {
      assert.deepEqual(directKnownBusinessFactKeys(message), [], message);
    }
  });

  it("still withholds an auto-answer when a visit is being asked for", () => {
    // "do you come out to Rio Rancho" looks like a coverage question and is
    // deliberately blocked: "come out" means they want somebody there, which
    // is not a fact to be recited. Measured as a miss at first -- it is not.
    assert.deepEqual(directKnownBusinessFactKeys("do you come out to Rio Rancho"), []);
  });
});

/**
 * Measured a third time, on words neither earlier pass was written from.
 * Seventeen of twenty, and the miss that mattered was the plainest form the
 * question takes: "what's your number?".
 *
 * Every pattern wanted the word "phone" sitting next to "number", and nobody
 * says "what is your phone number" when "what's your number" will do.
 */
describe("asking for the number the way people actually ask", () => {
  it("recognises the short forms", () => {
    for (const [message, key] of [
      ["what's your number?", "publicPhoneNumber"],
      ["what is your number", "publicPhoneNumber"],
      ["is there a landline I can ring", "publicPhoneNumber"],
      ["have you got a mobile I can try", "publicPhoneNumber"],
      ["can I get a contact number for you", "publicPhoneNumber"],
      ["whereabouts are you based", "businessAddress"],
      ["is Corrales within your patch", "serviceArea"],
      ["how far out do you travel", "serviceArea"],
      ["do you work weekends", "workingHours"],
      ["when's the best time to call you", "contactHours"],
    ] as Array<[string, string]>) {
      assert.ok(
        directKnownBusinessFactKeys(message).includes(key as never),
        `${key}: ${message}`,
      );
    }
  });

  it("still refuses anything that is not a plain fact question", () => {
    // The blocked pattern is the guard that stops a known-fact auto-reply
    // answering a price, a booking or a complaint. Widening the fact patterns
    // must never reach past it.
    //
    // "Do you come out to Rio Rancho" is blocked by design and stays that way:
    // "come out" reads as a booking. The cost is that a coverage question goes
    // unanswered rather than answered wrongly, which is the right direction.
    for (const message of [
      "how much does a new boiler cost",
      "can I book Tuesday",
      "what's your best price",
      "I need someone urgently",
      "my boiler is broken and I want a refund",
      "do you come out to Rio Rancho",
    ]) {
      assert.deepEqual(directKnownBusinessFactKeys(message), [], message);
    }
  });
});
