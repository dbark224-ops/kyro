# Kyro Code Quality Findings

Created: 2026-07-25
Status: living document — update as items are fixed

## What this is

A multi-dimension code quality audit of the Kyro web app and backend, run because
the owner wanted an honest answer to "is this spaghetti code?"

**Headline verdict: no, it is not spaghetti.** The evidence for that is worth
keeping in mind whenever this list feels long:

- Only **4 circular dependencies** across 478 files / 175k lines. Spaghetti
  codebases have dozens to hundreds. This rules out the "tangled ball" failure mode.
- **Zero** `any`, `as any`, `@ts-ignore`, or `@ts-expect-error` in the entire codebase.
- **Zero** `TODO`/`FIXME`/`HACK` markers.
- **Zero** cross-workspace data leaks found across 95 API routes, 101 server actions,
  and all 66 tables' RLS policies.
- The durable job queue and outbound message ledger are genuinely production-grade
  (leases, `FOR UPDATE SKIP LOCKED`, backoff, dead-lettering, DB-level idempotency).
- 346 tests, all passing, and the ones that exist are real tests with negative cases.

The problems below are overwhelmingly **missing safety nets and operational
integrity gaps**, not structural rot. That is a much better problem to have.

## How to use this document

Work top-down. Tier 1 items are small and verified. Do not skip to the interesting
refactors — the boring safety items protect everything else.

**Read the verification tag on every item before acting on it.**

| Tag | Meaning |
| --- | --- |
| `[VERIFIED]` | Checked directly against the code or the live production database. Trust it. |
| `[UNVERIFIED]` | Reported by an audit agent but never independently checked. **Confirm before acting.** |
| `[FIXED]` | Resolved. Kept for history. |

This distinction matters. The audit's adversarial verification passes were killed by
a rate limit, so **most findings below were never fact-checked**. When the checks did
run, they caught real errors — see "Corrections" at the bottom. Treat `[UNVERIFIED]`
items as leads, not facts.

---

## Fixed

- `[FIXED]` **No CI.** Nothing ran the test suite automatically, ever — no `.github`,
  no hooks, no deploy gate. Added `.github/workflows/ci.yml` running typecheck, lint,
  and the 346-test suite on every push and PR. Commit `fdebd29`.
- `[FIXED]` **No error boundary anywhere.** A render crash showed customers a raw
  browser error and notified nobody. Added `app/error.tsx` and `app/global-error.tsx`,
  both reporting to `/api/internal/bug-report`, deduped by error digest. Commit `dac1f2b`.
  - Known gap: that endpoint requires auth, so crashes on signed-out pages
    (sign-in, marketing, `/quote/approve/[token]`) show the UI but do not notify.
- `[FIXED]` **`/calendar` shipped 1.4MB of server code to the browser.** One runtime
  import of `googleMapsDirectionsUrl` from `lib/calendar/events.ts` pulled in the action
  engine and `provider-sync` (Google Calendar + Microsoft Graph clients). Moved the pure
  helper to `lib/calendar/directions.ts`; made the remaining import type-only.
  Measured: client chunks 3807.8 KB → 2382.3 KB. Commit `4718b2d`.
- `[FIXED]` **Mobile branch existed only on local disk.** `codex/mobile-app` (37 commits)
  was unpushed and its worktree was cross-wired to the abandoned C: drive repo. Pushed to
  origin; rebound the worktree to the D: repo with `git worktree repair`.
- `[FIXED]` **Assistant and mobile reply paths could double-send to customers.**
  `recordOutboundMessage` falls back to a random UUID when no idempotency key is supplied,
  defeating the unique index on `(workspace_id, idempotency_key)`. Added
  `lib/communication/idempotency.ts` (`manualReplyIdempotencyKey`) with 10 tests: an
  explicit submission key is used directly, and clients that send none fall back to a
  content hash bucketed into 60s. Both assistant consoles and the mobile app now hold a
  submission key until the send succeeds. Web commit `f73f683`; mobile commit `caeaa75`
  on `codex/mobile-app`.
  - Residual: the 60s fallback has a bucket-boundary gap and will collapse two
    *intentional* identical messages sent inside one window. Only reachable by app builds
    older than `caeaa75`.
- `[FIXED]` **A lost Stripe response could double-charge a customer's card.**
  `createStripePaymentIntent` posts `confirm + off_session` — a real charge — and
  `stripeApiRequest` had no way to send an `Idempotency-Key`. A charge that succeeded
  with a lost response was indistinguishable from a decline, so the invoice went
  `payment_failed` and was retried, charging the card again. Fixed with two defences:
  an idempotency key (covers the short window — overlapping cron workers) and
  `findSucceededPaymentIntentForInvoice`, which searches Stripe by invoice metadata
  before re-charging any previously-attempted invoice (covers the ≥24h retry path, since
  Stripe expires idempotency keys after 24h). Also adds `StripeRequestError.outcomeKnown`
  so a 4xx is distinguished from a network error or 5xx. 14 tests added to a module that
  had none. Commit `3d2e7e4`.
  - Note: severity was lower than the audit implied. The ≥24h retry backoff plus the
    `payment_intent.succeeded` webhook meant a real double-charge also required the
    webhook to fail for 24h. Latent, not live.

- `[FIXED]` **A `select()` could reference a column that does not exist, and nothing caught
  it.** `lib/ai/triage.ts` selected `channel_type` from `messages` (which has `channel_id`),
  so every owner-assisted inquiry reply failed silently from 2026-07-22 until it was found
  in production three days later. Added `npm run lint:db` to CI: it validates all ~600
  `.from("table").select(...)` calls against a committed schema snapshot
  (`scripts/schema-snapshot.json`, refreshed with `npm run db:snapshot`). 17 tests.
  Commits `dec1357` (the fix) and `752cc8b` (the lint).
  - The lint immediately found a second live instance: `api/mobile/workspace-tools`
    selected `kind` from `files`. That query failed every time and its handler returned
    an empty array, so the mobile recent-files tool had silently returned nothing.
  - **Refresh the snapshot after any migration** (`npm run db:snapshot`), or CI will fail
    on correct code that uses a newly added column.

---

## Decided against: typing the Supabase client `[VERIFIED]`

Investigated 2026-07-25 as a possible systemic fix for the above. **Do not re-open without
new information** — this was measured, not assumed.

Generating `Database` types (`supabase gen types typescript`) and applying them to the two
client factories is cheap and produces only **33 errors across 938 query sites**, which
speaks well of the codebase. But:

1. **It does not catch the bug it was proposed for.** Re-introducing `channel_type`
   produced 33 errors either way. supabase-js turns an unknown column into an error
   *result type*, which only surfaces where a field is read — and in `triage.ts` the rows
   went straight to `JSON.stringify` without any field being touched. The `lint:db` check
   catches it because it inspects the select string directly.
2. **All 33 errors are false positives**, reducing to two causes:
   - **17 numeric-as-string.** `usage_events.cost_snapshot` and friends are unconstrained
     Postgres `numeric`. Writing `String(value)` preserves exact decimal precision;
     passing a JS float64 would introduce rounding artifacts in money. The code is
     right and Supabase's generator (which maps `numeric` → `number`) is the imprecise
     one.
   - **16 jsonb object shapes.** TypeScript cannot prove a concrete object satisfies the
     recursive `Json` union, e.g. `payload: stripeEvent`. Runtime is fine.
3. **Adopting it would cost the codebase its best property.** Silencing 33 false
   positives means ~33 casts or overrides, reintroducing exactly the `any`-style escape
   hatches this codebase currently has *zero* of.

Verdict: the lint delivers the actual protection at a fraction of the cost. Revisit only
if a bug appears that typed clients would genuinely have caught.

---

## Tier 1 — verified, small, do these first

### 1. Vapi tool endpoint takes tenant ID from LLM output `[VERIFIED]`

`lib/voice/calls.ts` — `vapiToolWorkspaceId()` resolves as:

```
metadata.workspaceId  →  payload.workspaceId  →  args.workspaceId
```

`args` are **LLM-generated function-call arguments**, and the caller
(`app/api/integrations/vapi/tool/route.ts:1232`) then builds a service-role client that
bypasses RLS entirely.

**This is NOT currently exploitable.** The route's first statement is
`if (!verifyVapiToolRequest(request))` → 401; it requires `VAPI_TOOL_SECRET`, which no
ordinary user holds. Server-set `metadata.workspaceId` also wins the precedence order.
It is a defence-in-depth gap, not an open door.

Fix: delete the `payload.workspaceId` and `args.workspaceId` fallbacks so tenancy can
only come from server-set call metadata. Confirm first that `metadata.workspaceId` is
reliably populated on every Vapi path (internal voice, inbound, voicemail, outbound) —
removing the fallbacks blindly could break voice tools.

### 2. No timeout on any production provider call `[VERIFIED]`

62 server-side `fetch` calls across `lib` and `app/api`. Only four files in `lib` use
`AbortController`, and three of those are local-Ollama dev paths
(`ai/triage.ts`, `assistant/providers.ts`, `ai/dev-status.ts`). The only production one
is `assistant/pronunciation.ts`.

Node's `fetch` has no default timeout. One hung Gmail or Stripe connection can consume
the entire `/api/background/process` budget (`maxDuration = 300`), starving every other
workspace's email sync, calendar sync, and outbound delivery.

Fix shape: one shared `fetchWithTimeout` helper, applied at the provider wrappers.

### 3. Urgent escalation steps have no lease `[VERIFIED]`

`supabase/migrations/20260715213000_signup_billing_escalation_engines.sql` —
`claim_due_urgent_escalation_steps` sets `status = 'processing'` with **no**
`lease_expires_at`, no expiry, no reclaim path. Compare `claim_background_jobs` in
`20260716222532_durable_background_jobs.sql`, which does all three correctly.

A step abandoned mid-flight (function timeout, crash) is stranded in `processing`
forever with no alert. This is the 2am burst-pipe feature — the one place silent
failure is least acceptable. Production already has rows in
`urgent_escalation_incidents` (3) and `urgent_escalation_steps` (12), so this path is live.

---

## Tier 2 — verified, bigger

### 4. Drizzle migration journal desynced two months ago `[VERIFIED]`

`supabase/migrations/` holds **45** `.sql` files.
`supabase/migrations/meta/_journal.json` lists **15**. Last journal entry is
`20260527024424_structured_addresses`; newest migration is `20260721223000_conversation_mailbox_state`.

`npm run db:migrate` — the procedure in `docs/deployment-checklist.md` — would rebuild
roughly **one third** of the database. The other 30 migrations (Stripe payments, the
billing engine, the background job queue) are invisible to it.

Production works only because someone applied them by hand, recorded nowhere. There is
currently **no working documented path to rebuild the database**, which also means no
reliable staging environment and a bad surprise during any restore.

### 5. `packages/db/src/schema.ts` is missing 18 live tables `[VERIFIED]`

Verified against the **live production database** via the Supabase connection:
67 tables in production, 48 `pgTable(` declarations in the schema file.

Missing: `background_jobs`, `background_job_schedules`, `urgent_escalation_incidents`,
`urgent_escalation_steps`, `workspace_payment_accounts`, `workspace_billing_access`,
`billing_dunning_deliveries`, `payment_requests`, `payment_events`,
`signup_bootstrap_records`, `api_rate_limit_buckets`, `account_deletion_requests`,
`calendar_notification_deliveries`, `workspace_tutorial_state`, `knowledge_sources`,
`knowledge_documents`, `knowledge_chunks`, `knowledge_change_log`.

Both `docs/data-model.md:6` and `docs/current-architecture.md:125` call this file the
"source of truth," and `current-architecture.md:1833` instructs agents to add new tables
there first. **Documented-but-untrue architecture is worse than undocumented** — an agent
following the doc produces a broken change.

Decide: either regenerate/maintain the schema properly, or delete it and update both docs.

### 6. Contacts and Inbox are hard-capped at 100 rows `[VERIFIED]`

`lib/crm/queries.ts:1040` — `getContactList` ends in `.limit(100)` with no offset or
cursor. `app/contacts/page.tsx:73` sets `CRM_PAGE_SIZE = 10` and slices client-side
(`:1304-1307`), and search filters the same truncated array.

Harmless today (production has 25 contacts). At 300 contacts a customer silently loses
two thirds of their CRM, and searching for a missing contact returns nothing. There are
four separate `.limit(100)` sites in that file.

### 7. Zero tests on the highest-consequence code `[VERIFIED]`

Confirmed absent — no test file beside any of these:

| Module | What it does |
| --- | --- |
| `lib/billing/kyro-billing-engine.ts` | Charges customer cards off-session, on a cron |
| `lib/communication/outbound.ts` | Every email and SMS Kyro sends |
| `lib/engine/event-action-audit.ts` | The action/approval safety engine |
| `lib/payments/stripe.ts` | Webhook signature verification |
| `lib/communication/sms-compliance.ts` | STOP/opt-out — a legal obligation |

Several of the riskiest functions here are already pure and could be tested quickly:
`nextOutboundAttemptAtIso` (`outbound.ts:537`), `smsConsentCommand`
(`sms-compliance.ts:58`), `verifyStripeWebhookSignature` (`stripe.ts:229`),
`validateTwilioWebhookSignature` (`twilio.ts:691`).

Now that CI exists, tests added here actually protect every future change.

### 8. `textValue` is defined 135 times with divergent contracts `[VERIFIED]`

135 files define their own `function textValue`. 129 are byte-identical
(`trim() || null`). At least 6 differ — returning `""` instead of `null`:

- `lib/assistant/internal-messaging.ts:38`
- `lib/assistant/vapi-user-context.ts:11`
- `app/api/auth/create-account/route.ts:69`
- `app/api/auth/create-account/complete-card/route.ts:16`
- `app/api/auth/create-account/places/autocomplete/route.ts:10`

**This is the single highest-risk item for an AI-maintained codebase.** Agents work by
copying a nearby pattern. `textValue(x) ?? fallback` is correct in 129 files and
silently wrong in the 6 where it returns `""` — because `"" ?? fallback` is `""`, not
the fallback.

---

## Unverified long tail

**Everything below was reported by an audit agent and never fact-checked. Confirm before acting.**

### Structure and size

- `[UNVERIFIED]` `lib/assistant/commands.ts` (8,778 lines) — the dispatch table itself is
  clean (`:1659-1916` pure switch, `:1918-2179` predicate chain, worth preserving), but
  ~6,000 lines of business logic, SQL, formatting and billing writes sit under it.
  `calendarCommand` alone is 710 lines. Shared internals like `rowLink` are called from
  66 sites spanning lines 986–8739.
- `[UNVERIFIED]` `app/settings/page.tsx` (6,311 lines) — ~20 settings domains, ~90
  components. Correctness reportedly rests on an undocumented "never conditionally
  render, only CSS-hide" invariant, with no comment or guard rail. A routine agent
  instruction ("only render the active panel") could silently break saves.
- `[UNVERIFIED]` `app/assistant/assistant-console.tsx` (4,888 lines) — fuses five
  unrelated subsystems, and `voice-vapi` imports a shared preview pane from line 2735
  inside it, so refactoring assistant state can break a different route.
- `[UNVERIFIED]` `docs/engineering-health-audit-2026-06-30.md` already named these exact
  files, gave a split order, and set the rule "large files should be split before adding
  major new behaviour" — then all five kept growing. Meanwhile
  `docs/current-architecture.md` still tells agents to add new behaviour into
  `commands.ts`. **Governance problem, not a code problem.**
- `[UNVERIFIED]` `lib/crm/queries.ts` (3,831 lines) — **explicitly do not refactor.**
  Every reviewer independently called it cohesive and correctly built; 46 files depend
  on it. Large ≠ bad.

### Duplication

- `[UNVERIFIED]` ~8% of lines sit inside an exactly-duplicated 8-line block
  (healthy is 3-5%). Most is harmless boilerplate; the damage is concentrated in ~6 places.
- `[UNVERIFIED]` **The assistant turn pipeline is written out four times**, each running a
  different subset of steps. Thread compaction runs in only 1 of 4; two fetch context
  snapshots at DB cost then discard them. This is the flagship feature.
- `[UNVERIFIED]` `/api/mobile` is a **7,159-line parallel re-implementation** of the web
  server actions, mentioned nowhere in the 1,938-line architecture doc.
- `[UNVERIFIED]` The contact profile panel exists twice with **bidirectional** drift —
  each copy has something the other lacks.
- `[UNVERIFIED]` The public waitlist endpoint is the un-hardened ancestor of the
  account-deletion endpoint copied from it.
- `[UNVERIFIED]` Signup address-lookup routes are a stripped copy of the authenticated
  ones — lost Google API metering, never gained a rate limit.
- `[UNVERIFIED]` 17 duplicate `formatDate` implementations; 29 files bypass the tested
  timezone-aware helper, most rendering server-side with no workspace timezone.

### Operational visibility

- `[UNVERIFIED]` `lib/developer/system-health.ts:778-831` — worker health lights are
  computed from **environment variables**, not from whether any work actually ran. If
  cron stops firing entirely, the dashboard still shows green. Actively misleading.
- `[UNVERIFIED]` One dead-lettered job makes the queue permanently unhealthy for 90 days,
  with no non-technical way to clear it — which will train the owner to ignore the signal.
- `[UNVERIFIED]` Two of nine job types discard the worker's error list, so a job with 100%
  failures is marked `completed`.
- `[UNVERIFIED]` The entire alerting path is one unretried, untimed `fetch` that silently
  no-ops when unconfigured.
- `[UNVERIFIED]` 58 Supabase writes discard the returned error, including usage metering
  and escalation step state.
- `[UNVERIFIED]` Promoting a filtered-out email succeeds but reports failure, because the
  Next.js redirect throw is caught as an error.

### Tenancy and security

- `[UNVERIFIED]` No global uniqueness constraint on assigned phone numbers, while inbound
  SMS/voice routing does `.limit(1).maybeSingle()` on the destination number. If a number
  were ever assigned twice, Postgres silently picks one.
- `[UNVERIFIED]` `getPrimaryWorkspace` has no application-layer membership filter and
  relies wholly on RLS.
- `[UNVERIFIED]` Nothing mechanically enforces the workspace-filter invariant that the
  service-role files depend on.

### Performance

- `[UNVERIFIED]` `getContactList` (`lib/crm/queries.ts:1051-1056`) fetches **every message
  row** for the listed contacts with no `.limit()`, to compute two integers per contact.
  Latency grows forever with message history.
- `[UNVERIFIED]` Every authenticated page render sequentially pages through raw usage
  events; the purpose-built `usage_rollups` table is never queried.
- `[UNVERIFIED]` No `Suspense` in any page body — every screen waits for its slowest query
  before painting.
- `[UNVERIFIED]` `@vapi-ai/web` (310KB WebRTC SDK) statically imported; no code splitting
  anywhere. `libphonenumber-js` (135KB) pulled into the `/settings` client bundle.
- `[UNVERIFIED]` Hydration mismatch in the floating assistant widget, mounted on every
  authenticated page.
- `[UNVERIFIED]` Composite indexes missing on ordered hot paths for `messages` and
  `conversations`.
- `[UNVERIFIED]` **Counter-finding worth remembering:** the fear that huge client
  components ship excessive JS was measured and found **wrong** — the 4,888-line assistant
  console adds only 151KB, the 1,674-line dashboard console 70KB. Line count was not the
  bundle problem; the `/calendar` import was.

### Abstractions

- `[UNVERIFIED]` The provider abstraction covers **1 of 15** OpenAI call sites.
  `docs/current-architecture.md:1122` claims providers are swappable via
  `providers.ts`; in reality only chat narration goes through it.
- `[UNVERIFIED]` `lib/assistant/tool-registry.ts` is a static documentation array, not a
  registry, and is already 13 tools out of date — while the developer page presents it as
  the source of truth for permission gates.
- `[UNVERIFIED]` No SMS provider seam; Twilio's response shape is persisted directly into
  the outbox ledger. Two SMS paths bypass the outbox entirely, each re-implementing ~75
  lines of post-send bookkeeping.
- `[UNVERIFIED]` The tool-executor switch has a silent `default`, discarding the
  exhaustiveness guarantee its closed type union would otherwise provide.

### Monorepo

- `[UNVERIFIED]` `packages/core` and `packages/jobs` are 100% dead; `packages/api` ~70%
  dead. All six packages total ~2,450 lines against 169,000 in `apps/web`.
- `[UNVERIFIED]` `packages/contracts` (141 lines) is not serving as the web/mobile
  contract — 7,159 lines of mobile API define response shapes inline, which is the direct
  cause of the mobile/web drift.
- `[UNVERIFIED]` The `@/*` path alias is declared and used zero times; 1,105 deep relative
  imports instead.
- Decision needed: fund `packages/contracts` properly (it would prevent mobile drift) or
  delete the dead ones. The scaffolding costs almost nothing to keep, so this is cleanup,
  not an emergency.

---

## Corrections — claims that did NOT survive checking

Recorded so they are not resurrected later.

- **"A signed-in user of workspace A can read workspace B's CRM via the voice endpoint."**
  **FALSE.** The route requires `VAPI_TOOL_SECRET` and returns 401 without it. A signed-in
  user has no way to call it. The underlying fallback issue is real but far narrower — see
  Tier 1 item 2. Two audit runs disagreed on this; the alarming one was wrong.
- **"Only 2 files construct service-role clients."** **FALSE** — this was an error in the
  baseline metrics fed *into* the audit (wrong function name grepped). The real number is
  **53**. RLS is therefore not the backstop for a large share of write paths; app-layer
  `workspace_id` filtering is. That filtering was checked and is consistent, but the
  architecture doc materially understates this.
- **"The manual reply flow exists three times, only one protected."** Partially wrong —
  six call sites, four protected.
- **"packages/db is 13 tables behind."** Understated — it is **18** tables behind,
  verified against the live database.

## What this audit did not cover

- Accessibility, i18n, and mobile-app (Expo) code were out of scope.
- The three adversarial verification passes and the final synthesis never ran — killed by
  a rate limit. This is why most items are `[UNVERIFIED]`.
- No runtime profiling, load testing, or security penetration testing was performed.
- Findings reflect the codebase at commit `4718b2d` (2026-07-25).
