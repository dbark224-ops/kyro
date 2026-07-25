import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSyntheticInboundEmailName,
  resolveInboundEmailContactName,
} from "./inbound-email-identity";

describe("resolveInboundEmailContactName", () => {
  it("uses a reliable provider display name", () => {
    assert.equal(
      resolveInboundEmailContactName({
        bodyText: "Could you quote a renovation?",
        fromEmail: "mikelmarino@gmail.com",
        fromName: "Mikel Marino",
      }),
      "Mikel Marino",
    );
  });

  it("uses a human sign-off when the provider supplies no display name", () => {
    assert.equal(
      resolveInboundEmailContactName({
        bodyText:
          "Hi, could you quote a complete renovation?\n\nKind regards,\nMikel Marino",
        fromEmail: "renovation.enquiry@gmail.com",
        fromName: null,
      }),
      "Mikel Marino",
    );
  });

  it("supports a same-line sign-off", () => {
    assert.equal(
      resolveInboundEmailContactName({
        bodyText: "Could you come next week?\nThanks, David.",
        fromEmail: "customer@example.com",
        fromName: null,
      }),
      "David",
    );
  });

  it("does not turn an email local part into a contact name", () => {
    assert.equal(
      resolveInboundEmailContactName({
        bodyText: "Could you quote a renovation?",
        fromEmail: "mikelmarino@gmail.com",
        fromName: "mikelmarino",
      }),
      null,
    );
  });

  it("rejects company and mail-client signature lines as person names", () => {
    assert.equal(
      resolveInboundEmailContactName({
        bodyText:
          "Could you quote this?\n\nRegards,\nWFA Contractors\nGet Outlook for iOS",
        fromEmail: "quotes@example.com",
        fromName: null,
      }),
      null,
    );
  });
});

describe("isSyntheticInboundEmailName", () => {
  it("recognizes a previously fabricated local-part name", () => {
    assert.equal(
      isSyntheticInboundEmailName("Mikelmarino", "mikelmarino@gmail.com"),
      true,
    );
    assert.equal(
      isSyntheticInboundEmailName("Mikel Marino", "mikelmarino@gmail.com"),
      false,
    );
  });
});
