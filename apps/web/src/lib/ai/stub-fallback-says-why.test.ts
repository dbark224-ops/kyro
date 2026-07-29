import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * A silent fallback is worse than a loud failure.
 *
 * resolveTriageDecision has three routes to the deterministic stub. Two catch a
 * thrown provider error and pass its message on. The third -- taken when no AI
 * provider is configured at all -- passed nothing, so `fallbackReason` was null
 * on the one path where no exception existed to explain it. The comment on
 * buildStubDecision promises "the draft is empty and `fallbackReason` says
 * why"; on that path it said nothing.
 *
 * Every inquiry taking it gets classified by local rules and no drafted reply.
 * Until 29 Jul 2026 the resulting zero-proposal run crashed, and that crash was
 * the only signal anyone got. Fixing the crash removed the alarm, so without a
 * reason recorded here Kyro would simply stop answering inquiries in silence.
 *
 * AI_PROVIDER="" was the trigger: `?? "stub"` only catches undefined, so an
 * empty value became a mode matching no branch.
 */
const triage = readRepoFile("apps/web/src/lib/ai/triage.ts");

describe("an unset provider is treated as unset", () => {
  it("falls back on empty, not just undefined", () => {
    assert.match(
      triage,
      /process\.env\.AI_PROVIDER\?\.trim\(\)\.toLowerCase\(\) \|\| "stub"/,
    );
    assert.doesNotMatch(
      triage,
      /process\.env\.AI_PROVIDER\?\.trim\(\)\.toLowerCase\(\) \?\? "stub"/,
    );
  });
});

describe("every route to the stub explains itself", () => {
  const resolver = triage.slice(
    triage.indexOf("async function resolveTriageDecision"),
    triage.indexOf("function buildActionProposals"),
  );

  it("no longer calls buildStubDecision with no reason", () => {
    assert.doesNotMatch(resolver, /buildStubDecision\(context\);/);
  });

  it("names the configured mode in the reason", () => {
    assert.match(resolver, /AI_PROVIDER=\$\{aiProviderMode\(\)\}/);
    assert.match(resolver, /no reply was drafted/);
  });

  it("logs it rather than only storing it", () => {
    // fallbackReason lands in the ai_run row, which nobody reads until they
    // already suspect something. A silent degradation needs to reach the logs.
    assert.match(resolver, /console\.error\(`Triage fell back to the stub/);
  });

  it("still passes the provider error through on the other two routes", () => {
    assert.match(resolver, /"Local Ollama triage failed\."/);
    assert.match(resolver, /"OpenAI triage request failed\."/);
  });

  it("passes the reason positionally, as buildStubDecision expects", () => {
    assert.match(resolver, /return buildStubDecision\(context, reason\);/);
  });
});
