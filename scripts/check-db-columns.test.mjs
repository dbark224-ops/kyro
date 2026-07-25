import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findViolations,
  parseSelect,
  splitTopLevel,
} from "./check-db-columns.mjs";

const tables = {
  contacts: ["id", "name", "email", "workspace_id"],
  files: ["id", "filename", "source", "workspace_id"],
  messages: ["id", "direction", "subject", "body_text", "channel_id"],
  outbound_messages: ["id", "channel_type", "status"],
};

describe("splitTopLevel", () => {
  it("splits plain column lists", () => {
    assert.deepEqual(splitTopLevel("id,name,email"), ["id", "name", "email"]);
  });

  it("keeps embedded resources intact", () => {
    assert.deepEqual(splitTopLevel("id,contacts(name,email),status"), [
      "id",
      "contacts(name,email)",
      "status",
    ]);
  });

  it("tolerates whitespace and newlines", () => {
    assert.deepEqual(splitTopLevel("\n  id,\n  name\n"), ["id", "name"]);
  });
});

describe("parseSelect", () => {
  it("reads plain columns", () => {
    assert.deepEqual(parseSelect("id,direction").columns, ["id", "direction"]);
  });

  it("flags a star select without inventing columns", () => {
    const parsed = parseSelect("*");

    assert.equal(parsed.hasStar, true);
    assert.deepEqual(parsed.columns, []);
  });

  it("validates the target of an alias, not the alias name", () => {
    assert.deepEqual(parseSelect("shortName:name").columns, ["name"]);
  });

  it("splits embedded resources out for separate checking", () => {
    const parsed = parseSelect("id,contacts(name,email)");

    assert.deepEqual(parsed.columns, ["id"]);
    assert.deepEqual(parsed.embeds, [
      { select: "name,email", table: "contacts" },
    ]);
  });

  it("handles an !inner embed hint", () => {
    const parsed = parseSelect("id,contacts!inner(name)");

    assert.deepEqual(parsed.embeds, [{ select: "name", table: "contacts" }]);
  });

  it("ignores syntax it does not model rather than guessing", () => {
    // json paths, casts and aggregates must not produce false failures
    assert.deepEqual(parseSelect("metadata->>foo,count()").columns, []);
  });
});

describe("findViolations", () => {
  it("catches the real incident: channel_type on messages", () => {
    const source = `supabase.from("messages").select("direction,channel_type,subject")`;
    const violations = findViolations(source, tables);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].column, "channel_type");
    assert.equal(violations[0].table, "messages");
  });

  it("passes a valid select", () => {
    const source = `supabase.from("messages").select("id,direction,channel_id")`;

    assert.deepEqual(findViolations(source, tables), []);
  });

  it("does not confuse a column that is valid on a different table", () => {
    const ok = `supabase.from("outbound_messages").select("id,channel_type")`;

    assert.deepEqual(findViolations(ok, tables), []);
  });

  it("checks columns inside embedded resources", () => {
    const source = `supabase.from("messages").select("id,contacts(nope)")`;
    const violations = findViolations(source, tables);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].column, "nope");
    assert.equal(violations[0].table, "contacts");
  });

  it("ignores tables that are not in the snapshot", () => {
    const source = `supabase.from("some_view").select("anything")`;

    assert.deepEqual(findViolations(source, tables), []);
  });

  it("does not pair a select with a preceding unrelated from", () => {
    const source = `
      supabase.from("messages").eq("a", 1);
      supabase.from("outbound_messages").select("channel_type");
    `;

    assert.deepEqual(findViolations(source, tables), []);
  });

  it("reports the line number of the offending query", () => {
    const source = `line one\nline two\nsupabase.from("files").select("id,kind")`;
    const violations = findViolations(source, tables);

    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 3);
  });

  it("finds every violation, not just the first", () => {
    const source = `
      supabase.from("files").select("id,kind");
      supabase.from("messages").select("channel_type");
    `;

    assert.equal(findViolations(source, tables).length, 2);
  });
});
