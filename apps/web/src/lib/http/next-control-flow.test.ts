import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile, repoSourceFiles } from "../testing/repo-files";
import { isNextControlFlowSignal, rethrowNextControlFlow } from "./next-control-flow";

function withDigest(digest: unknown) {
  return Object.assign(new Error("boom"), { digest });
}

describe("isNextControlFlowSignal", () => {
  it("recognises a real redirect digest", () => {
    assert.equal(
      isNextControlFlowSignal(withDigest("NEXT_REDIRECT;replace;/inbox;303;")),
      true,
    );
  });

  it("recognises notFound, which throws the same way", () => {
    assert.equal(isNextControlFlowSignal(withDigest("NEXT_NOT_FOUND")), true);
  });

  it("does not mistake a genuine error for navigation", () => {
    assert.equal(isNextControlFlowSignal(new Error("Unable to merge")), false);
    assert.equal(isNextControlFlowSignal(withDigest("SOME_OTHER_DIGEST")), false);
    assert.equal(isNextControlFlowSignal(withDigest(42)), false);
    assert.equal(isNextControlFlowSignal(null), false);
    assert.equal(isNextControlFlowSignal("NEXT_REDIRECT"), false);
  });

  it("does not match a digest that merely starts with the same letters", () => {
    assert.equal(isNextControlFlowSignal(withDigest("NEXT_REDIRECTION")), false);
  });
});

describe("rethrowNextControlFlow", () => {
  it("re-throws navigation so the redirect still happens", () => {
    const signal = withDigest("NEXT_REDIRECT;replace;/inbox;303;");

    assert.throws(
      () => rethrowNextControlFlow(signal),
      (thrown: unknown) => thrown === signal,
    );
  });

  it("returns for a real error so the catch can handle it", () => {
    assert.doesNotThrow(() => rethrowNextControlFlow(new Error("Unable to merge")));
  });
});

describe("no catch block silently swallows a redirect", () => {
  it("guards every try/catch that wraps a redirect helper", () => {
    // redirect() signals by throwing. A catch that wraps one and does not
    // re-throw it turns a completed action into a reported failure, which is
    // exactly the bug this module exists to prevent. Three sites had it.
    const files = repoSourceFiles(
      "apps/web/src/**/*.ts",
      "apps/web/src/**/*.tsx",
    );

    const offenders: string[] = [];

    for (const file of files) {
      const source = readRepoFile(file);

      if (!/\bredirect\w*\(/.test(source)) continue;

      for (const match of source.matchAll(/\btry\s*\{/g)) {
        const start = match.index ?? 0;
        let index = start + match[0].length;
        let depth = 1;

        while (index < source.length && depth > 0) {
          if (source[index] === "{") depth += 1;
          else if (source[index] === "}") depth -= 1;
          index += 1;
        }

        const body = source.slice(start, index);
        const tail = source.slice(index, index + 400);

        if (!/^\s*catch/.test(tail)) continue;
        if (!/\b(redirect|redirectWith\w+)\(/.test(body)) continue;
        if (/rethrowNextControlFlow|isNextControlFlowSignal/.test(tail)) continue;

        offenders.push(`${file}:${source.slice(0, start).split("\n").length}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `these catch a redirect without re-throwing it, so the action reports failure after succeeding:\n  ${offenders.join(
        "\n  ",
      )}`,
    );
  });
});
