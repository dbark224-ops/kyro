import assert from "node:assert/strict";
import { test } from "node:test";
import { trustedInternalPhoneMatches } from "./internal-messaging";

test("matches trusted internal numbers across common formatting", () => {
  assert.equal(
    trustedInternalPhoneMatches("+1 (575) 571-2705", ["+15755712705"]),
    true,
  );
  assert.equal(
    trustedInternalPhoneMatches("whatsapp:+15755712705", ["+1 575 571 2705"]),
    true,
  );
});

test("does not confuse a customer number with an internal number", () => {
  assert.equal(
    trustedInternalPhoneMatches("+15855221939", ["+15755712705"]),
    false,
  );
});
