import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVapiCallerRecognition,
  buildVapiInternalNumberDetails,
} from "./vapi-caller-recognition";
import type { VapiUserIdentity } from "./vapi-user-context";

const accountUser: VapiUserIdentity = {
  email: "david@example.com",
  firstName: "David",
  id: "user-1",
  name: "David Barker",
  phone: "+15755550123",
};

describe("Vapi inbound caller recognition", () => {
  it("automatically trusts the mobile number captured for the account user", () => {
    const result = buildVapiInternalNumberDetails({
      accountUser,
      voiceNumberDetails: [],
      voiceNumbers: [],
      workplaceContacts: [],
    });

    assert.deepEqual(result, [
      {
        name: "David Barker",
        phoneNumber: "+15755550123",
        role: null,
      },
    ]);
  });

  it("uses Business Profile workplace contacts as the internal caller source of truth", () => {
    const result = buildVapiInternalNumberDetails({
      voiceNumberDetails: [],
      voiceNumbers: [],
      workplaceContacts: [
        {
          name: "David Barker",
          phoneNumber: "+1 (575) 571-2705",
          privatePhoneNumber: "+1 (575) 555-0199",
          role: "Owner",
        },
      ],
    });

    assert.deepEqual(result, [
      {
        name: "David Barker",
        phoneNumber: "+1 (575) 571-2705",
        role: "Owner",
      },
      {
        name: "David Barker",
        phoneNumber: "+1 (575) 555-0199",
        role: "Owner",
      },
    ]);
  });

  it("deduplicates legacy voice numbers behind the workplace contact", () => {
    const result = buildVapiInternalNumberDetails({
      voiceNumberDetails: [
        {
          name: null,
          phoneNumber: "+15755712705",
          role: null,
        },
      ],
      voiceNumbers: ["+1 575 571 2705"],
      workplaceContacts: [
        {
          name: "David Barker",
          phoneNumber: "+1 (575) 571-2705",
          role: "Owner",
        },
      ],
    });

    assert.deepEqual(result, [
      {
        name: "David Barker",
        phoneNumber: "+1 (575) 571-2705",
        role: "Owner",
      },
    ]);
  });

  it("keeps the workplace contact label when it matches the account number", () => {
    const result = buildVapiInternalNumberDetails({
      accountUser,
      voiceNumberDetails: [],
      voiceNumbers: [],
      workplaceContacts: [
        {
          name: "David Barker",
          phoneNumber: "+1 (575) 555-0123",
          role: "Owner",
        },
      ],
    });

    assert.deepEqual(result, [
      {
        name: "David Barker",
        phoneNumber: "+1 (575) 555-0123",
        role: "Owner",
      },
    ]);
  });

  it("greets a configured internal caller by first name", () => {
    const result = buildVapiCallerRecognition({
      businessName: "WFA Plumbing",
      callerNumber: "+15755550123",
      crmContact: null,
      internalCaller: true,
      internalNumberDetails: [
        {
          name: "David Barker",
          phoneNumber: "+1 (575) 555-0123",
          role: "Owner",
        },
      ],
      userIdentity: accountUser,
    });

    assert.equal(result.kind, "internal_user");
    assert.equal(result.firstName, "David");
    assert.equal(result.greeting, "Hey David");
    assert.equal(
      result.voicemailGreeting,
      "Hey David, you've reached WFA Plumbing. No one was able to answer, but I can help or take a message.",
    );
  });

  it("greets a matched CRM caller without granting internal status", () => {
    const result = buildVapiCallerRecognition({
      businessName: "WFA Plumbing",
      callerNumber: "+15755550999",
      crmContact: {
        company: null,
        contactType: "client",
        id: "contact-1",
        name: "Maria Lopez",
      },
      internalCaller: false,
      internalNumberDetails: [],
      userIdentity: accountUser,
    });

    assert.equal(result.kind, "crm_contact");
    assert.equal(result.firstName, "Maria");
    assert.equal(result.greeting, "Hey Maria");
    assert.equal(
      result.voicemailGreeting,
      "Hey Maria, you've reached WFA Plumbing. No one was able to answer, but I can help or take a message.",
    );
  });

  it("falls back to the business greeting when a match has no usable name", () => {
    const result = buildVapiCallerRecognition({
      businessName: "WFA Plumbing",
      callerNumber: "+15755550999",
      crmContact: {
        company: null,
        contactType: "client",
        id: "contact-1",
        name: "+1 575 555 0999",
      },
      internalCaller: false,
      internalNumberDetails: [],
      userIdentity: accountUser,
    });

    assert.equal(result.recognized, true);
    assert.equal(result.firstName, "");
    assert.equal(
      result.greeting,
      "Hi, this is WFA Plumbing. You're speaking with Kyro!",
    );
    assert.equal(
      result.voicemailGreeting,
      "Hi, you've reached WFA Plumbing. You're speaking with Kyro. No one was able to answer, but I can help or take a message.",
    );
  });

  it("uses the generic greeting for an unknown caller", () => {
    const result = buildVapiCallerRecognition({
      businessName: "WFA Plumbing",
      callerNumber: null,
      crmContact: null,
      internalCaller: false,
      internalNumberDetails: [],
      userIdentity: accountUser,
    });

    assert.equal(result.kind, "unknown");
    assert.equal(result.recognized, false);
    assert.equal(
      result.greeting,
      "Hi, this is WFA Plumbing. You're speaking with Kyro!",
    );
    assert.equal(
      result.voicemailGreeting,
      "Hi, you've reached WFA Plumbing. You're speaking with Kyro. No one was able to answer, but I can help or take a message.",
    );
  });
});
