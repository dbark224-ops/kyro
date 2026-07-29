import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  associatedContactContextLine,
  type AssociatedContactMatch,
} from "./associated-contact";
import { readRepoFile } from "../testing/repo-files";

/**
 * The person who answers on someone else's behalf.
 *
 * A contact's second number is deliberately not an identity -- matching an
 * inbound caller on it would merge two people's histories. But refusing to
 * recognise them at all is its own failure: Ike is standing in the flooded
 * garage, the number is saved against Marisol's job, and Kyro declining to
 * discuss work he is physically in front of is not caution, it is uselessness.
 *
 * So this is a third, weaker state between "known customer" and "stranger".
 */
const source = readRepoFile("apps/web/src/lib/crm/associated-contact.ts");

function match(over: Partial<AssociatedContactMatch> = {}) {
  return {
    associatedLabel: "Father-in-law",
    associatedName: "Ike Delacroix",
    contactId: "contact-1",
    contactName: "Marisol Okafor",
    ...over,
  } satisfies AssociatedContactMatch;
}

describe("the lookup stays a weaker signal than a real match", () => {
  it("matches on the secondary number, not the primary", () => {
    assert.match(source, /\.eq\("normalized_secondary_phone", normalized\)/);
    assert.doesNotMatch(source, /\.eq\("normalized_phone"/);
  });

  it("refuses to guess when two contacts share the number", () => {
    // An assistant working for several clients, or a recycled handset. Guessing
    // here attaches one customer's job to another customer's caller.
    assert.match(source, /\.limit\(2\)/);
    assert.match(source, /if \(\(data \?\? \[\]\)\.length !== 1\)/);
  });

  it("skips merged profiles", () => {
    assert.match(source, /\.is\("merged_into_contact_id", null\)/);
  });

  it("degrades to unrecognised rather than failing the call", () => {
    assert.match(source, /console\.warn\("Associated-contact lookup failed"/);
    assert.match(source, /return null;/);
  });
});

describe("what Kyro is told about them", () => {
  it("names who they are and whose job it is", () => {
    const line = associatedContactContextLine(match());

    assert.match(line, /Marisol Okafor's profile/);
    assert.match(line, /Ike Delacroix, Father-in-law/);
  });

  it("permits discussing the job", () => {
    const line = associatedContactContextLine(match());

    assert.match(line, /entitled to discuss/);
    assert.match(line, /access, timing, what is happening on site/);
  });

  it("does not let them become the customer", () => {
    // The whole point of keeping this separate from identity: reachable is not
    // the same as authorised to change things.
    const line = associatedContactContextLine(match());

    assert.match(line, /It does not make them Marisol Okafor/);
    assert.match(line, /do not change account details, prices, or contact information/);
    assert.match(line, /do not discuss any other customer/);
  });

  it("copes with a number saved without a name or role", () => {
    const line = associatedContactContextLine(
      match({ associatedLabel: null, associatedName: null }),
    );

    assert.match(line, /Marisol Okafor's profile/);
    assert.doesNotMatch(line, /\(\)/);
  });

  it("copes with a contact that has no name", () => {
    const line = associatedContactContextLine(match({ contactName: null }));

    assert.match(line, /a saved contact/);
    assert.doesNotMatch(line, /null/);
  });
});

describe("the phone agent only uses it when there is no real match", () => {
  const vapi = readRepoFile("apps/web/src/lib/assistant/vapi-inbound.ts");

  it("does not run the lookup when the caller is already a contact", () => {
    assert.match(
      vapi,
      /purpose === "inbound_user" \|\| inboundCrmContact\s*\?\s*null/,
    );
  });

  it("may discuss the job when the number is saved against the customer", () => {
    assert.match(vapi, /calling on behalf of a customer/);
    assert.match(vapi, /Say what you can help with rather than refusing outright/);
  });

  it("gives nothing away when the number is not saved against them", () => {
    // Including whether the customer exists at all -- otherwise the refusal
    // itself confirms the relationship to anyone who asks.
    assert.match(vapi, /do not confirm or deny anything about that customer/);
    assert.match(vapi, /do not say whether they exist in the system/);
    assert.match(vapi, /call the number on file/);
  });
});
