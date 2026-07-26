import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileResolutionNotice } from "./profile-resolution-notice";

describe("profileResolutionNotice", () => {
  it("says nothing for a clear contact", () => {
    assert.equal(
      profileResolutionNotice({
        profileConflictContactIds: [],
        profileResolutionStatus: "clear",
      }),
      null,
    );
  });

  it("says nothing for a merged contact", () => {
    assert.equal(
      profileResolutionNotice({
        profileConflictContactIds: [],
        profileResolutionStatus: "merged",
      }),
      null,
    );
  });

  it("names the duplicate when the contact clashed with others", () => {
    const notice = profileResolutionNotice({
      profileConflictContactIds: ["contact-a"],
      profileResolutionStatus: "needs_review",
    });

    assert.equal(notice?.label, "Possible duplicate");
    assert.match(notice?.explanation ?? "", /merge them/);
  });

  it("names the phone problem when there is no conflicting contact", () => {
    // The undialable-number case: flagged at intake, nothing to merge with.
    const notice = profileResolutionNotice({
      profileConflictContactIds: [],
      profileResolutionStatus: "needs_review",
    });

    assert.equal(notice?.label, "Can't verify number");
    assert.match(notice?.explanation ?? "", /can't text or call it/);
  });

  it("treats a missing conflict list as the phone problem, not a duplicate", () => {
    // Older rows and the mobile API omit the field rather than sending [].
    const notice = profileResolutionNotice({
      profileResolutionStatus: "needs_review",
    });

    assert.equal(notice?.label, "Can't verify number");
  });

  it("never reuses one label for both causes", () => {
    const duplicate = profileResolutionNotice({
      profileConflictContactIds: ["contact-a"],
      profileResolutionStatus: "needs_review",
    });
    const unverified = profileResolutionNotice({
      profileConflictContactIds: [],
      profileResolutionStatus: "needs_review",
    });

    assert.notEqual(duplicate?.label, unverified?.label);
    assert.notEqual(duplicate?.explanation, unverified?.explanation);
  });
});
