import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";
import { writeOrThrow } from "./write";

describe("writeOrThrow", () => {
  it("passes the result through when the write succeeded", async () => {
    const result = await writeOrThrow(
      Promise.resolve({ data: [{ id: 1 }], error: null }),
      "Unable to do the thing",
    );

    assert.deepEqual(result.data, [{ id: 1 }]);
  });

  it("throws with the operation and the database message", async () => {
    await assert.rejects(
      writeOrThrow(
        Promise.resolve({ error: { message: "duplicate key" } }),
        "Unable to record the invoice",
      ),
      /Unable to record the invoice: duplicate key/,
    );
  });

  it("still throws when the database gives no message", async () => {
    await assert.rejects(
      writeOrThrow(Promise.resolve({ error: {} }), "Unable to record"),
      /Unable to record: unknown database error/,
    );
  });
});

/**
 * PostgREST returns errors rather than throwing them, so a bare
 * `await supabase.from(x).update(y)` is a statement that succeeds whether or
 * not the write did. Across the app that is mostly harmless. On these modules
 * it is not -- they move money, record that a message was delivered, or decide
 * whether an escalation keeps escalating -- so every write here has to be
 * checked, one way or another.
 *
 * Not repo-wide on purpose: a blanket rule would be noise on the paths where
 * fire-and-forget is genuinely fine, and a rule that cries wolf gets muted.
 */
const MUST_CHECK_WRITES = [
  "src/lib/billing/dunning.ts",
  "src/lib/billing/kyro-billing-engine.ts",
  "src/lib/communication/outbound.ts",
  "src/lib/escalation/urgent-escalation.ts",
];

describe("writes on money and delivery paths are checked", () => {
  for (const file of MUST_CHECK_WRITES) {
    it(`has no unchecked write in ${file}`, () => {
      const source = readRepoFile(`apps/web/${file}`);
      const offenders: string[] = [];

      for (const match of source.matchAll(
        /((?:const|let)\s*(?:\{[^}]*\}|\w+)\s*=\s*)?await\s+(?:supabase|input\.supabase|client|admin)\b/g,
      )) {
        const start = match.index ?? 0;
        const line = source.slice(0, start).split("\n").length;

        // Only look inside this statement, so a `.select()` above cannot be
        // paired with an `.update()` belonging to the next one.
        const statement = source.slice(start, start + 1200).split(";")[0];

        if (!/\.(insert|update|upsert|delete)\(/.test(statement)) continue;

        const assignment = match[1];

        // Destructured with `error`, so the caller can see a failure.
        if (assignment && /\berror\b/.test(assignment)) continue;

        // Captured, then handed to throwOnDatabaseError or similar.
        const name = assignment?.match(/(?:const|let)\s+(\w+)\s*=/)?.[1];

        if (name) {
          const after = source.slice(start, start + 3000);

          if (new RegExp(`[A-Za-z]\\w*\\(\\s*${name}\\b`).test(after)) continue;
          if (new RegExp(`${name}\\.error`).test(after)) continue;
        }

        offenders.push(`${file}:${line}`);
      }

      assert.deepEqual(
        offenders,
        [],
        `wrap in writeOrThrow, or destructure { error } and handle it:\n  ${offenders.join(
          "\n  ",
        )}`,
      );
    });
  }
});
