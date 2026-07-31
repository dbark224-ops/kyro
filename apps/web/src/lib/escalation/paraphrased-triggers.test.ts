import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectUrgentEscalationTriggers,
  withoutQuotedReply,
} from "./urgent-escalation";

/**
 * Kyro's own paraphrase was deciding whether the owner got woken up.
 *
 * Found by running a long, deliberately unhurried mock inquiry: a customer
 * listing several small plumbing faults, saying outright that she would rather
 * have them done properly over a year than badly in a week. It escalated on
 * after_hours_emergency at midnight.
 *
 * She wrote that a tap "drips" and that another "drips constantly". The
 * classifier wrote that back as "leaking taps ... an outside tap leak", the
 * summary was fed to the keyword match along with the message, and `\bleak\b`
 * did the rest. No negation was involved and no guard was wrong -- the word
 * being matched was never in the inquiry.
 *
 * Both `title` and `summary` are Kyro's, written for display. Only `content`
 * is the customer: subject and body for email, the message for SMS, the call
 * note for voice. So triggers read `content` and nothing else.
 *
 * The narrower predecessor excluded titles for voice calls only, on exactly
 * this reasoning, and missed that the summary and the email lead title are
 * generated too.
 */
const INQUIRY =
  "The kitchen sink drains slowly and the tap drips. The outside tap drips constantly. Happy to spread this over the year -- I would rather it was done properly than quickly.";

describe("a trigger must come from the customer, not from Kyro", () => {
  it("does not escalate the inquiry that started this", () => {
    const found = detectUrgentEscalationTriggers(
      {
        content: INQUIRY,
        sourceKey: "test",
        sourceType: "email",
        // What the classifier made of it, verbatim from the run.
        summary:
          "Gmail email from Constance Aldebrand: Constance Aldebrand requests a plumbing assessment for slow drainage, leaking taps, low water pressure, sink gurgling, an outside tap leak, a smelly floor waste, and hot-water concerns.",
        title: "Plumbing Inspection And Repairs Prioritization",
      },
      { afterHours: true },
    );

    assert.deepEqual(found, []);
  });

  it("ignores a generated title on every source, not just voice calls", () => {
    for (const sourceType of ["email", "sms", "manual", "voice_call"] as const) {
      const found = detectUrgentEscalationTriggers(
        {
          content: "Could you quote for a new vanity unit when you get a chance?",
          sourceKey: "test",
          sourceType,
          title: "Emergency Bathroom Leak",
          summary: "Urgent: burst pipe reported",
        },
        { afterHours: true },
      );

      assert.deepEqual(found, [], `${sourceType} read a generated field`);
    }
  });

  it("still escalates when the customer is the one saying it", () => {
    // The same words, in the message this time. These must keep firing --
    // suppressing a real emergency is far worse than an extra alert.
    const found = detectUrgentEscalationTriggers(
      {
        content: "Urgent -- burst pipe, water pouring through the ceiling.",
        sourceKey: "test",
        sourceType: "email",
        title: "Quote request",
        summary: "Customer would like a quote at some point.",
      },
      { afterHours: true },
    );

    assert.ok(found.includes("explicit_urgency"));
    assert.ok(found.includes("active_property_damage"));
    assert.ok(found.includes("after_hours_emergency"));
  });

  it("hears a request for the owner however it is phrased", () => {
    // Found by auditing which triggers had ever fired: asks_for_owner_now had
    // never fired in 47 incidents. Measured against ten natural phrasings,
    // five missed -- "speak WITH the owner", "can the owner RING me", "get the
    // owner to PHONE me", "put me through to the manager", "whoever runs the
    // business". Fourth instance of one phrasing covered and the rest of
    // English not.
    for (const content of [
      "Can I speak to the owner please",
      "Could I speak with the owner",
      "can the owner ring me",
      "get the owner to phone me",
      "put me through to the manager",
      "I need to speak to whoever runs the business",
      "expecting a call from the owner",
    ]) {
      const found = detectUrgentEscalationTriggers(
        { content, sourceKey: "test", sourceType: "email" },
        { afterHours: false },
      );

      assert.ok(found.includes("asks_for_owner_now"), content);
    }
  });

  it("does not hear one where a third party is merely mentioned", () => {
    for (const content of [
      "can I speak to someone about a quote",
      "the owner of the property will be there",
      "the manager of the shop next door recommended you",
      "we own the property outright",
    ]) {
      const found = detectUrgentEscalationTriggers(
        { content, sourceKey: "test", sourceType: "email" },
        { afterHours: false },
      );

      assert.ok(!found.includes("asks_for_owner_now"), content);
    }
  });

  it("recognises a big job described rather than labelled", () => {
    // Fired once in 47 incidents. It wanted the literal phrase "commercial
    // property" and missed every description of scale -- six of nine plainly
    // valuable leads. The only pattern tonight whose misses cost money rather
    // than goodwill: missing a forty-unit property manager is a lost year.
    for (const content of [
      "I manage 40 rental units and need a contractor for all of them",
      "quote for the plumbing on a new build, 12 apartments",
      "we're a property management company looking for a regular contractor",
      "annual maintenance contract for our three sites",
      "fit-out for a new restaurant kitchen",
      "full refurbishment of the pub, six bathrooms",
      "we look after 8 properties across the city",
      "We need a quote for a commercial project at our office block",
    ]) {
      const found = detectUrgentEscalationTriggers(
        { content, sourceKey: "test", sourceType: "email" },
        { afterHours: false },
      );

      assert.ok(found.includes("high_value_lead"), content);
    }
  });

  it("does not call an ordinary house a high-value lead", () => {
    // A count needs three or more, because "we have two bathrooms" is a house.
    for (const content of [
      "can you replace the tap in my kitchen",
      "our bathroom needs retiling",
      "we have two bathrooms and both taps drip",
      "the shower in our second bathroom is blocked",
      "could you come out to our house",
    ]) {
      const found = detectUrgentEscalationTriggers(
        { content, sourceKey: "test", sourceType: "email" },
        { afterHours: false },
      );

      assert.ok(!found.includes("high_value_lead"), content);
    }
  });

  it("hears an emergency described in ordinary words", () => {
    // A sweep of the four remaining triggers found active_property_damage
    // firing on 2 of 8, safety_risk on 2 of 7, complaint on 4 of 8 and
    // existing_job_serious_issue on 2 of 6.
    //
    // The worst was word order: "burst pipe" matched and "a pipe has burst
    // under the sink" did not, which is how most people say the most classic
    // emergency there is. Nobody writes "I have an electric shock hazard";
    // they write "I got a shock off the shower switch".
    const cases: Array<[string, string, boolean]> = [
      ["a pipe has burst under the sink", "active_property_damage", false],
      ["water is coming through the light fitting", "active_property_damage", false],
      ["the ceiling has come down in the hall", "active_property_damage", false],
      ["I got a shock off the shower switch", "safety_risk", false],
      ["sparks came out of the socket", "safety_risk", false],
      ["there's a burning smell from the fuse box", "safety_risk", false],
      ["my solicitor will be in touch", "complaint_or_reputation_risk", false],
      ["I'll be leaving a review about this", "complaint_or_reputation_risk", false],
      ["the work you did last month has failed", "existing_job_serious_issue", true],
      ["it's still not right after your visit", "existing_job_serious_issue", true],
    ];

    for (const [content, trigger, existingCustomer] of cases) {
      const found = detectUrgentEscalationTriggers(
        { content, existingCustomer, sourceKey: "test", sourceType: "email" },
        { afterHours: false },
      );

      assert.ok(found.includes(trigger as never), `${trigger}: ${content}`);
    }
  });

  it("does not escalate an ordinary job after all that widening", () => {
    // The counterweight. Every pattern above got broader, and none of these
    // may start waking somebody up.
    for (const content of [
      "can you quote to replace a kitchen tap",
      "the outside tap drips a bit",
      "our bathroom needs retiling",
      "I'd like a price for a new radiator",
      "the shower pressure is a little low",
      "could you service the boiler please",
      "we're thinking about a new bathroom next year",
    ]) {
      assert.deepEqual(
        detectUrgentEscalationTriggers(
          {
            content,
            existingCustomer: true,
            sourceKey: "test",
            sourceType: "email",
          },
          { afterHours: false },
        ),
        [],
        content,
      );
    }
  });

  it("escalates a known customer's missed call, and only that", () => {
    // The twelfth trigger, and the only one never exercised end to end -- no
    // known customer in this workspace has had a missed call, so it has never
    // had the chance. Verified here at detector level instead, since building
    // a Vapi payload by hand is more likely to test the payload than the code.
    //
    // Three conditions must all hold, and each is checked by its absence:
    // voice call, known customer, and a missed or voicemail outcome.
    const fires = (over: Record<string, unknown>) =>
      detectUrgentEscalationTriggers(
        {
          content: "Missed call, no voicemail left.",
          sourceKey: "test",
          sourceType: "voice_call",
          ...over,
        },
        { afterHours: false },
      ).includes("missed_known_customer_call");

    assert.equal(
      fires({ existingCustomer: true, metadata: { missedOrVoicemail: true } }),
      true,
    );
    assert.equal(
      fires({ existingCustomer: true, metadata: { missedOrVoicemail: false } }),
      false,
      "an answered call is not a missed one",
    );
    assert.equal(
      fires({ existingCustomer: false, metadata: { missedOrVoicemail: true } }),
      false,
      "a stranger's missed call is not this trigger",
    );
    assert.equal(fires({ existingCustomer: true }), false, "no outcome given");

    const bySms = detectUrgentEscalationTriggers(
      {
        content: "Missed call",
        existingCustomer: true,
        metadata: { missedOrVoicemail: true },
        sourceKey: "test",
        sourceType: "sms",
      },
      { afterHours: false },
    );

    assert.ok(
      !bySms.includes("missed_known_customer_call"),
      "a text is never a missed call",
    );
  });

  it("keeps reading the voice call note, which is all a call has", () => {
    const found = detectUrgentEscalationTriggers(
      {
        content: "Caller reports a gas smell in the kitchen and has left the house.",
        sourceKey: "test",
        sourceType: "voice_call",
      },
      { afterHours: false },
    );

    assert.ok(found.includes("safety_risk"));
  });
});

/**
 * The same fault as escalating on Kyro's paraphrase, arriving by another route.
 *
 * Reply to Kyro's email with "Thanks, Tuesday at 9 works fine" and the client
 * quotes the whole thread underneath, original emergency and all. Measured
 * before the fix: those words escalated on explicit_urgency,
 * active_property_damage and after_hours_emergency, waking the owner at
 * midnight over a job already booked. Written alone they escalate on nothing.
 *
 * Untouched in production so far only because 1 of 387 inbound messages is a
 * reply into a thread -- almost everything is still first contact. It gets
 * worse with use, and every reply re-escalates for as long as the thread lives.
 */
describe("a trigger must come from what the customer just wrote", () => {
  const fires = (content: string) =>
    detectUrgentEscalationTriggers(
      { content, sourceKey: "test", sourceType: "email" },
      { afterHours: true },
    );

  it("does not escalate an emergency the customer is only quoting", () => {
    for (const [client, body] of [
      [
        "gmail",
        "Thanks, Tuesday at 9 works fine. See you then.\n\nOn Tue, 28 Jul 2026 at 18:04, Kyro <hello@k.com> wrote:\n> burst pipe -- water pouring through the ceiling, urgent\n",
      ],
      [
        "outlook",
        "That works for us, thank you.\n\n________________________________\nFrom: Kyro <hello@k.com>\nSent: Tuesday, 28 July 2026 18:04\nSubject: Re: URGENT burst pipe\n\nThanks for getting in touch about the burst pipe - water pouring through the ceiling.\n",
      ],
      [
        "forwarded",
        "Can you look at this one please.\n\n---------- Forwarded message ---------\nFrom: Sarah <s@e.com>\n\nURGENT burst pipe water pouring through the ceiling\n",
      ],
    ] as const) {
      assert.deepEqual(fires(body), [], `${client} quoted history escalated`);
    }
  });

  it("still escalates the emergency the customer is actually reporting", () => {
    // The counterweight. Suppressing a real emergency is far worse than an
    // extra alert, so each of these must keep firing.
    for (const [name, body] of [
      [
        "new emergency, old thread quoted",
        "URGENT - burst pipe, water pouring through the ceiling, please help\n\nOn Mon, 27 Jul 2026, Kyro wrote:\n> Thanks for your enquiry about a new tap.\n",
      ],
      [
        "written underneath the quote",
        "On Tue, 28 Jul 2026 at 18:04, Kyro wrote:\n> Can I confirm Tuesday at 9am?\n\nActually no -- there is now water pouring through the ceiling, it is an emergency.\n",
      ],
      [
        "nothing but the quote, so it is all we have",
        "> burst pipe water pouring through the ceiling urgent",
      ],
    ] as const) {
      assert.ok(fires(body).includes("active_property_damage"), name);
    }
  });

  it("leaves a message with no thread in it exactly as it was", () => {
    const plain = "Hi, the kitchen tap drips. No rush at all.";

    assert.equal(withoutQuotedReply(plain), plain);
  });
});
