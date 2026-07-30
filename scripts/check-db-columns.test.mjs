import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findViolations,
  findWriteViolations,
  parseObjectKeys,
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

/**
 * The columns a query WRITES were never checked, only the ones it reads.
 *
 * Found the hard way. `metadata: {...}` was added to the leads insert; leads
 * has no metadata column; every inbound enquiry would have failed at lead
 * creation. typecheck passed, lint passed, and this script passed, because it
 * had nothing to say about insert(). Only a live run against the database
 * caught it.
 *
 * A bad select breaks one screen. A bad insert breaks a whole ingest path.
 */
describe("findWriteViolations", () => {
  it("catches the insert that started this", () => {
    const source = `supabase.from("contacts").insert({ name: n, metadata: { a: 1 } })`;
    const violations = findWriteViolations(source, tables);

    assert.deepEqual(
      violations.map((violation) => violation.column),
      ["metadata"],
    );
  });

  it("checks update and upsert too", () => {
    for (const method of ["update", "upsert"]) {
      const source = `supabase.from("contacts").${method}({ name: n, nickname: x })`;

      assert.deepEqual(
        findWriteViolations(source, tables).map((v) => v.column),
        ["nickname"],
        method,
      );
    }
  });

  it("reads a row inside an array", () => {
    const source = `supabase.from("contacts").insert([{ name: n, nickname: x }])`;

    assert.deepEqual(
      findWriteViolations(source, tables).map((v) => v.column),
      ["nickname"],
    );
  });

  it("passes a write that only uses real columns", () => {
    const source = `supabase.from("contacts").insert({ name: n, email: e, workspace_id: w })`;

    assert.deepEqual(findWriteViolations(source, tables), []);
  });
});

describe("parseObjectKeys", () => {
  it("does not mistake a ternary colon for a key", () => {
    // `completed_at: done ? now : null` yielded "now" and "null" as columns
    // before member-start tracking, and the first run reported 19 of them --
    // every one a false positive.
    assert.deepEqual(parseObjectKeys(`{ a: done ? now : null }`, 0), ["a"]);
  });

  it("ignores keys of nested objects", () => {
    assert.deepEqual(parseObjectKeys(`{ a: { inner: 1 }, b: 2 }`, 0), ["a", "b"]);
  });

  it("returns null rather than a partial list", () => {
    // A spread, a template literal or a quoted key hides members this cannot
    // see. Reporting the ones it can read as if they were the whole object
    // would turn an unknown into a false pass on the rest.
    assert.equal(parseObjectKeys(`{ ...base, a: 1 }`, 0), null);
    assert.equal(parseObjectKeys("{ a: `x${y}` }", 0), null);
    assert.equal(parseObjectKeys(`{ "a": 1 }`, 0), null);
  });
});
