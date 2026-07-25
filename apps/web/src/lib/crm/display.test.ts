import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEmailLeadTitle,
  formatLeadTitle,
  formatServiceType,
} from "./display";

describe("CRM display formatting", () => {
  it("capitalizes service names", () => {
    assert.equal(formatServiceType("room addition"), "Room Addition");
  });

  it("shortens email-created lead titles to service plus first name", () => {
    assert.equal(
      formatLeadTitle("room addition email from David Barker"),
      "Room Addition David",
    );
  });

  it("builds compact email lead titles from classification context", () => {
    assert.equal(
      buildEmailLeadTitle({
        contactName: "David Barker",
        serviceType: "room addition",
        subject: "Room add quote",
      }),
      "Room Addition David",
    );
  });
});
