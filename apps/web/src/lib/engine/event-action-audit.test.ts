import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signatureVariantFromActionInput } from "./event-action-audit";

/**
 * Which signature a reply carries is a claim about who wrote it. Getting it
 * wrong means an AI-drafted message going out under the manual signature, or a
 * message the owner actually wrote being labelled AI-generated.
 */
describe("signatureVariantFromActionInput", () => {
  it("honours an explicit variant over anything inferred", () => {
    assert.equal(
      signatureVariantFromActionInput(
        { signatureVariant: "manual", userEditedDraft: false },
        "ai_generated",
      ),
      "manual",
    );
    assert.equal(
      signatureVariantFromActionInput(
        { signatureVariant: "ai_generated", userEditedDraft: true },
        "manual",
      ),
      "ai_generated",
    );
  });

  it("falls back when the explicit variant is not a real one", () => {
    for (const signatureVariant of ["", "  ", "MANUAL", "custom", 42, null]) {
      assert.equal(
        signatureVariantFromActionInput({ signatureVariant }, "ai_generated"),
        "ai_generated",
        `${JSON.stringify(signatureVariant)} is not a variant`,
      );
    }
  });

  it("treats an edited draft as the owner's own message", () => {
    assert.equal(
      signatureVariantFromActionInput(
        { userEditedDraft: true },
        "ai_generated",
      ),
      "manual",
    );
    assert.equal(
      signatureVariantFromActionInput(
        { editedByUserId: "user-1" },
        "ai_generated",
      ),
      "manual",
    );
  });

  it("keeps the fallback when nothing says a human touched it", () => {
    assert.equal(signatureVariantFromActionInput({}, "ai_generated"), "ai_generated");
    assert.equal(signatureVariantFromActionInput({}, "manual"), "manual");
    assert.equal(
      signatureVariantFromActionInput(
        { editedByUserId: null, userEditedDraft: false },
        "ai_generated",
      ),
      "ai_generated",
    );
  });

  it("does not read an empty editor id as a human edit", () => {
    // An empty string is absence, not evidence that someone edited the draft.
    assert.equal(
      signatureVariantFromActionInput({ editedByUserId: "" }, "ai_generated"),
      "ai_generated",
    );
  });
});
