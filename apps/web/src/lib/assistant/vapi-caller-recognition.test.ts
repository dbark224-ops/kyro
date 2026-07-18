import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVapiCallerRecognition } from "./vapi-caller-recognition";
import type { VapiUserIdentity } from "./vapi-user-context";

const accountUser: VapiUserIdentity = {
  email: "david@example.com",
  firstName: "David",
  id: "user-1",
  name: "David Barker",
  phone: "+15755550123",
};

describe("Vapi inbound caller recognition", () => {
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
  });
});
