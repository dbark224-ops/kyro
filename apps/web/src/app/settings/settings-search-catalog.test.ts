import assert from "node:assert/strict";
import test from "node:test";
import { searchSettings } from "./settings-search-catalog";

test("finds voicemail overflow from missed-call language", () => {
  const [result] = searchSettings("missed calls");

  assert.equal(result?.id, "voicemail-overflow");
});

test("understands regional spelling for brand colours", () => {
  const results = searchSettings("brand colours");

  assert.ok(results.some((result) => result.id === "brand-colours"));
});

test("finds payment method from credit card language", () => {
  const results = searchSettings("credit card");

  assert.ok(results.some((result) => result.id === "payment-method"));
});

test("finds the combined Phone and SMS screen from purchase language", () => {
  const [result] = searchSettings("buy a phone number");

  assert.equal(result?.id, "phone-sms");
  assert.equal(result?.panel, "phone-sms");
});

test("finds email accounts from provider names", () => {
  const googleResults = searchSettings("connect gmail");
  const microsoftResults = searchSettings("office 365");

  assert.ok(googleResults.some((result) => result.id === "google-account"));
  assert.ok(
    microsoftResults.some((result) => result.id === "microsoft-account"),
  );
});

test("tolerates a common pronunciation misspelling", () => {
  const [result] = searchSettings("pronounciation");

  assert.equal(result?.id, "pronunciation");
});

test("keeps developer results hidden from normal accounts", () => {
  assert.equal(searchSettings("provider ids").length, 0);
  assert.equal(searchSettings("mock inquiry").length, 0);
  assert.equal(
    searchSettings("provider ids", { includeDeveloper: true })[0]?.id,
    "provider-ids",
  );
  assert.ok(
    searchSettings("mock inquiry", { includeDeveloper: true }).some(
      (result) => result.id === "mock-inquiries",
    ),
  );
});
