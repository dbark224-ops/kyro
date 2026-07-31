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

/**
 * A regression I shipped and caught the same night, recorded because the fix
 * is only obvious once you know what went wrong.
 *
 * Stripping quoted replies also dropped any line beginning From:, Sent:, To:,
 * Cc:, Subject:, Date: or Reply-To:, on the reasoning that those are the
 * headers of a quoted block. Plenty of people write a tidy, structured message
 * instead -- Name, Address, Date, Subject, Phone -- and an emergency stated on
 * the "Subject:" line went with the strip. That message escalated on nothing.
 *
 * Only "From:" marks the block now, being the one header nobody writes about
 * themselves, and everything below it goes with the cut. Suppressing a real
 * emergency is the worst outcome available here, so the narrower rule wins.
 */
describe("a structured message is not a quoted thread", () => {
  const fires = (content: string) =>
    detectUrgentEscalationTriggers(
      { content, sourceKey: "test", sourceType: "email" },
      { afterHours: true },
    );

  it("reads an emergency written on a Subject: line", () => {
    const found = fires(
      "Name: Sarah Whitlock\nAddress: 100 Vista Del Monte\nDate: today\nSubject: burst pipe, water pouring through the ceiling\nPhone: 505-555-0143",
    );

    assert.ok(found.includes("active_property_damage"), "the emergency was dropped");
  });

  it("reads one even when every line looks like a header", () => {
    assert.ok(
      fires("Subject: URGENT gas smell\nTo: the plumber\nDate: right now").includes(
        "safety_risk",
      ),
    );
  });

  it("still cuts a quoted block that gives no divider", () => {
    // Outlook does this: the reply, then bare headers, then the old message.
    assert.deepEqual(
      fires(
        "That works, thank you.\n\nFrom: Kyro <hello@k.com>\nSent: Tuesday\nSubject: Re: URGENT\n\nburst pipe water pouring through the ceiling\n",
      ),
      [],
    );
  });
});

/**
 * The triggers re-measured against phrasings these tests were NOT written from.
 *
 * Everything above scored well on its own examples. On twenty-one fresh ones
 * the same code scored 10. "The kitchen is flooded" did not escalate, which is
 * about as plain as an emergency gets -- `flood` and `flooding` were both
 * listed and neither matches "flooded", because the trailing word boundary
 * will not sit inside the word. "Is the boss about?" and "could the gaffer
 * give me a bell" missed because a trade customer does not say "owner".
 *
 * Measuring a rule against the examples it was written from proves nothing.
 * That applies to the fixes as much as to the faults, which is what this file
 * exists to demonstrate.
 */
describe("the triggers, measured on words these tests did not invent", () => {
  const fire = (content: string, existingCustomer = false) =>
    detectUrgentEscalationTriggers(
      { content, existingCustomer, sourceKey: "test", sourceType: "email" },
      { afterHours: false },
    );

  it("hears each trigger in an unfamiliar phrasing", () => {
    for (const [key, message, existing] of [
      ["explicit_urgency", "please treat this as a priority", false],
      ["active_property_damage", "the kitchen is flooded", false],
      ["active_property_damage", "it's soaking through into the flat below", false],
      ["safety_risk", "the wire is exposed where the kids play", false],
      ["asks_for_owner_now", "is the boss about?", false],
      ["asks_for_owner_now", "could the gaffer give me a bell", false],
      ["asks_for_owner_now", "I'd rather deal with the person in charge", false],
      ["high_value_lead", "looking for a contractor for our care home", false],
      ["high_value_lead", "we run four salons and need one firm for all of them", false],
      ["complaint_or_reputation_risk", "this is going on Google unless someone calls me", false],
      ["existing_job_serious_issue", "you were here Tuesday and it's worse now", true],
    ] as const) {
      assert.ok(fire(message, existing).includes(key), `${key}: ${message}`);
    }
  });

  it("tells a flood happening now from one that happened years ago", () => {
    // The dangerous half of this fix. Excluding "flood ... last" would have
    // silenced "the kitchen flooded last night", so only plainly historical
    // markers disqualify.
    for (const now of [
      "the kitchen is flooded",
      "the kitchen flooded last night",
      "the bathroom flooded this morning",
      "the utility room flooded yesterday",
      "it's flooding right now",
    ]) {
      assert.ok(fire(now).includes("active_property_damage"), now);
    }

    for (const past of [
      "the flood last winter ruined the carpet, we replaced it since",
      "we had a flood last year and want to prevent it happening again",
      "there was a flood back in 2019",
      "we had a flood 3 years ago",
    ]) {
      assert.ok(!fire(past).includes("active_property_damage"), past);
    }
  });

  it("keeps every one of these out of the owner's evening", () => {
    for (const ordinary of [
      "can you quote to replace a kitchen tap",
      "the outside tap drips a bit",
      "our bathroom needs retiling",
      "I'd like a price for a new radiator",
      "the shower pressure is a little low",
      "could you service the boiler please",
      "we're thinking about a new bathroom next year",
      "no rush at all on this one",
      "we have two bathrooms and both taps drip",
      "the owner of the property will be there",
      "we own the flat above the shop",
      "I run a bit late on Fridays",
    ]) {
      assert.deepEqual(fire(ordinary, true), [], ordinary);
    }
  });
});

/**
 * The owner's decision, 2026-07-30, replacing the VIP trigger he declined:
 * escalate a previous customer indicating an issue with their work, and
 * recognise a previous customer bringing more business without escalating
 * beyond normal.
 *
 * Matching any mention of past work could not tell those apart. "You fitted
 * our boiler and we're after a radiator now" -- a customer offering more money
 * -- escalated as a serious issue, because "you fitted" was enough on its own.
 * A phrase that states a fault now fires alone; a phrase that merely places
 * the job in the past has to arrive with something wrong.
 */
describe("a returning customer with a complaint, not a returning customer", () => {
  const isIssue = (content: string, existingCustomer = true) =>
    detectUrgentEscalationTriggers(
      { content, existingCustomer, sourceKey: "test", sourceType: "email" },
      { afterHours: false },
    ).includes("existing_job_serious_issue");

  it("escalates work that has gone wrong", () => {
    for (const message of [
      "the boiler you fitted last year has packed up again",
      "the leak you fixed is back",
      "you were here Tuesday and it's worse now",
      "the work you did in March has failed",
      "it's still not right after your visit",
      "your repair has come back",
      "the work you did is causing damage",
      "the tap you fitted is dripping again",
      "the drain you cleared is blocked again",
      "the shower you installed has stopped working",
      "the unit you serviced is faulty",
      "your work has made it worse",
    ]) {
      assert.ok(isIssue(message), message);
    }
  });

  it("does not escalate a returning customer offering more work", () => {
    for (const message of [
      "you did our bathroom last year, could you quote for the kitchen",
      "we'd like you back to do the ensuite",
      "hi again, we've got another job if you're free",
      "you fitted our boiler and we're after a radiator now",
      "great job last time -- can you look at the garage?",
      "you were here in March for the shower, now we want the loo done",
      "the work you did was great, can you price the utility room",
      "since your visit we've decided to do the whole upstairs",
      "you cleared our drain last year, can you do a full survey now",
    ]) {
      assert.ok(!isIssue(message), message);
    }
  });

  it("stays gated on their actually being a customer", () => {
    assert.ok(!isIssue("the boiler you fitted has failed", false));
  });
});

/**
 * A third re-measurement, on phrasings taken from neither the code nor the
 * earlier tests. The triggers caught 14 of 21.
 *
 * The misses were not exotic. Two were grammar rather than vocabulary --
 * "speakING to the boss" where only "speak to" was covered, and "the ceiling
 * IS bulging" where only "has" was allowed after the noun. Two were trade
 * slang: "water's pissing out", "got a belt off the cooker switch". One was
 * "whoever's in charge", which the existing "person in charge" alternative
 * looked like it already handled. One was a count with an adjective in the
 * way: "5 office buildings" where "5 units" matched.
 *
 * Kept deliberately narrow on the count: allowing any word between the number
 * and the noun would make "our 3 bedroom house" a high-value lead, so only
 * building words take an adjective.
 */
describe("the words a third set of customers used", () => {
  const fires = (content: string) =>
    detectUrgentEscalationTriggers(
      { content, sourceKey: "test", sourceType: "email" },
      { afterHours: false },
    );

  it("hears all of them", () => {
    const cases: Array<[string, string]> = [
      ["water's pissing out from under the boiler", "active_property_damage"],
      ["the ceiling is bulging and dripping", "active_property_damage"],
      ["theres water coming down the walls", "active_property_damage"],
      ["my kitchen is flooding", "active_property_damage"],
      ["got a belt off the cooker switch", "safety_risk"],
      ["the fuse box is making a buzzing noise and smells hot", "safety_risk"],
      ["there's smoke coming from the boiler", "safety_risk"],
      ["I need someone out today please", "explicit_urgency"],
      ["this can't wait till next week", "explicit_urgency"],
      ["I'm going to have to report this to trading standards", "complaint_or_reputation_risk"],
      ["I'll be putting this on Google reviews", "complaint_or_reputation_risk"],
      ["is there any chance of speaking to the boss", "asks_for_owner_now"],
      ["could you get the guv'nor to call me", "asks_for_owner_now"],
      ["I'd rather deal with whoever's in charge", "asks_for_owner_now"],
      ["we've got 22 flats needing a gas safety check", "high_value_lead"],
      ["looking for someone to maintain 5 office buildings", "high_value_lead"],
      ["it's for a hotel refurb, 30 ensuites", "high_value_lead"],
      ["we're a letting agent with a portfolio to cover", "high_value_lead"],
    ];

    for (const [content, trigger] of cases) {
      assert.ok(fires(content).includes(trigger as never), `${trigger}: ${content}`);
    }
  });

  it("and still wakes nobody for an ordinary job", () => {
    // The counterweight, widened each time the triggers are. "3 bedroom house"
    // is the one that would break first if the count rule were loosened.
    for (const content of [
      "our 3 bedroom house needs a new boiler",
      "the ceiling in the spare room could do with painting",
      "we have 2 bathrooms",
      "the owner of the property will be there to let you in",
      "I got a quote from someone else last year",
      "we own the property outright",
      "could you service the boiler please",
      "the shower pressure is a little low",
    ]) {
      assert.deepEqual(
        detectUrgentEscalationTriggers(
          { content, existingCustomer: true, sourceKey: "test", sourceType: "email" },
          { afterHours: false },
        ),
        [],
        content,
      );
    }
  });
});
