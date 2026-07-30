import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * The address badge said "Check" on every address, including perfect ones.
 *
 * Found by auditing stored values rather than by reading code: of 102 contacts,
 * exactly 1 had address_validation_status "validated". Sixty read
 * "needs_review", which the UI shows as "Check".
 *
 * The cause was hasInferredComponents in the needs-review test. Google sets it
 * whenever it ADDS anything the sender did not type, and it adds something to
 * almost every address -- the country, and a ZIP+4 extension.
 *
 * Measured by calling the API directly with its own headquarters:
 *
 *   1600 Amphitheatre Parkway, Mountain View, CA 94043
 *     validationGranularity  PREMISE
 *     addressComplete        true
 *     hasUnconfirmedComponents false
 *     hasReplacedComponents    false
 *     hasInferredComponents    TRUE   <- for "USA" and "-1351"
 *
 * So the most canonical address available would have been badged "Check". A
 * warning that fires on everything tells the owner nothing and teaches them to
 * ignore the one that matters -- the opposite failure to a switch that can
 * never fire, and just as useless.
 *
 * The other three flags each describe something genuinely wrong: a component
 * Google could not confirm, one it had to change, or a missing part.
 */
const source = readRepoFile("apps/web/src/lib/addresses/google.ts");

describe("routine normalisation is not a fault", () => {
  it("no longer treats an inferred component as needing review", () => {
    const test = source.slice(
      source.indexOf("const needsReview ="),
      source.indexOf("return {", source.indexOf("const needsReview =")),
    );

    assert.doesNotMatch(test, /hasInferredComponents/);
  });

  it("keeps the three flags that describe a real problem", () => {
    const test = source.slice(
      source.indexOf("const needsReview ="),
      source.indexOf("return {", source.indexOf("const needsReview =")),
    );

    assert.match(test, /hasUnconfirmedComponents/);
    assert.match(test, /hasReplacedComponents/);
    assert.match(test, /!verdict\.addressComplete/);
  });

  it("still records why, so the decision stays explainable", () => {
    assert.match(source, /validationStatus: needsReview \? "needs_review" : "validated"/);
  });
});
