import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * A triage that proposed nothing crashed instead of reporting itself.
 *
 * Found by running a real inquiry through the real ingest path: the model
 * response stubbed out, no actions were proposed, and the run died with
 * "Cannot read properties of undefined (reading 'id')" -- after classification,
 * triage, address verification and the action inserts had all completed and been
 * persisted. Everything upstream succeeded and the caller got an exception.
 *
 * Zero proposals was already made non-fatal once, and the comment above
 * primaryAction claimed "each is guarded rather than left to fail on `.id` of
 * undefined". Two of the four reads were guarded. The audit log and the returned
 * actionId were not.
 *
 * This is the path a truncated or stubbed model response takes, so the failure
 * most likely to happen was also the one that crashed.
 */
const triage = readRepoFile("apps/web/src/lib/ai/triage.ts");
const tail = triage.slice(triage.indexOf("const primaryAction ="));

describe("triage survives proposing nothing", () => {
  it("does not dereference primaryAction outside a guard", () => {
    // The four reads inside `if (primaryAction ...)` blocks are safe and stay
    // bare -- TypeScript narrows them, and it is the compiler rather than a
    // regex that keeps them honest, since primaryAction is `T | undefined`.
    //
    // The two that were broken sit outside any such block: the reply_drafted
    // audit log, guarded only on conversationId, and the return value. Both are
    // asserted individually below. What this checks is that the region after
    // the auto-reply block -- where no guard is in scope -- has no bare read
    // left in it.
    const afterGuards = tail.slice(tail.indexOf('if (context.conversationId &&'));

    assert.doesNotMatch(afterGuards, /(?<!\? )String\(primaryAction\.id\)/);
  });

  it("returns a null actionId rather than throwing", () => {
    assert.match(
      tail,
      /actionId: primaryAction \? String\(primaryAction\.id\) : null/,
    );
  });

  it("does not assume actions is an array in the return", () => {
    assert.match(tail, /\(actions \?\? \[\]\)\.map\(/);
  });

  it("does not assume actions is an array in the audit log", () => {
    assert.match(tail, /proposedActionCount: actions\?\.length \?\? 0/);
  });

  it("still guards the two sites that were already correct", () => {
    assert.match(tail, /if \(\s*primaryAction &&/);
    assert.match(tail, /if \(knownFactAutoReply && primaryAction\)/);
  });

  it("keeps the comment honest about what is guarded", () => {
    // The previous comment asserted a property the code did not have, which is
    // worse than no comment -- it is why the two unguarded reads survived a
    // review that was looking for exactly this.
    const comment = triage.slice(
      triage.indexOf("// Undefined when nothing was proposed"),
      triage.indexOf("const primaryAction ="),
    );

    assert.match(comment, /every read of it is guarded/);
    assert.match(comment, /only two of the four sites were/);
  });
});
