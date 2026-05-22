import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRecoverableTokenAccessError } from "./inbound-email-sync";

describe("isRecoverableTokenAccessError", () => {
  it("treats encrypted OAuth token decrypt failures as reconnect-needed", () => {
    assert.equal(
      isRecoverableTokenAccessError("Unsupported state or unable to authenticate data"),
      true,
    );
    assert.equal(isRecoverableTokenAccessError("Invalid authentication tag"), true);
  });

  it("does not hide provider/API failures behind reconnect state", () => {
    assert.equal(isRecoverableTokenAccessError("Gmail API returned 429"), false);
    assert.equal(isRecoverableTokenAccessError("Unable to load email integrations"), false);
  });
});
