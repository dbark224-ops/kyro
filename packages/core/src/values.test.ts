import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textValue, textValueOrEmpty } from "./values";

/**
 * This replaced 137 copy-pasted definitions across the codebase, so its
 * contract is now load-bearing everywhere rather than in one file.
 */
describe("textValue", () => {
  it("trims surrounding whitespace", () => {
    assert.equal(textValue("  hello  "), "hello");
    assert.equal(textValue("\n\thello\n"), "hello");
  });

  it("returns null for nothing to read", () => {
    assert.equal(textValue(""), null);
    assert.equal(textValue("   "), null);
    assert.equal(textValue("\n\t "), null);
    assert.equal(textValue(null), null);
    assert.equal(textValue(undefined), null);
  });

  it("returns null for anything that is not a string", () => {
    // Database columns and JSON payloads arrive as unknown, so a number or an
    // object must not slip through as text.
    for (const value of [0, 1, true, false, {}, [], new Date()]) {
      assert.equal(
        textValue(value),
        null,
        `${JSON.stringify(value)} is not text`,
      );
    }
  });

  it("keeps a string that is only meaningful after trimming", () => {
    assert.equal(textValue(" 0 "), "0");
    assert.equal(textValue(" false "), "false");
  });

  it("does not treat interior whitespace as trimmable", () => {
    assert.equal(textValue("  two  words  "), "two  words");
  });
});

describe("textValueOrEmpty", () => {
  it("gives an empty string where textValue gives null", () => {
    for (const value of ["", "   ", null, undefined, 42, {}]) {
      assert.equal(textValueOrEmpty(value), "");
    }
  });

  it("otherwise matches textValue exactly", () => {
    for (const value of ["hello", "  hello  ", " 0 "]) {
      assert.equal(textValueOrEmpty(value), textValue(value));
    }
  });

  it("never returns the string 'null', which is why it exists", () => {
    // Callers that concatenate need a string every time; null would render.
    assert.equal(`${textValueOrEmpty(null)}`, "");
  });
});
