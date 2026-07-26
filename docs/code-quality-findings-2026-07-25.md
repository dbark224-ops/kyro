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
- `[FIXED]` **Vapi tool tenancy could come from LLM-generated arguments.**
  `vapiToolWorkspaceId` resolved `metadata.workspaceId` → `payload.workspaceId` →
  `args.workspaceId`, and the tool route hands the result to a service-role client that
  bypasses RLS. Never exploitable (the route requires `VAPI_TOOL_SECRET` and server-set
  metadata won the precedence order), but the model's output must never be able to pick a
  tenant. Now resolves from server-set call metadata only. Verified `metadata.workspaceId`
  is set on all four call-creation paths before removing the fallbacks: internal voice,
  inbound/voicemail overflow, outbound, and urgent escalation. 4 tests added.
  Commit `ed13056`.
  - A new Vapi call path must set `metadata.workspaceId` or its tool calls are rejected.
    That is the safe failure direction, but it is a real constraint to remember.
- `[FIXED]` **No production provider call had a timeout.** Node's `fetch` never times out,
  so one hung Gmail/Stripe/Twilio connection could consume the whole
  `/api/background/process` budget (`maxDuration = 300`) and starve every other
  workspace. Added `lib/http/fetch-with-timeout.ts` with two tiers — `fetchWithTimeout`
  (30s) for providers expected to answer quickly, `fetchAiProvider` (120s) for model calls
  that are legitimately slow. **58 calls across 28 files** are now bounded. 8 tests.
  Commit `7638938`.
  - A caller-supplied `signal` still works; only our own deadline raises
    `FetchTimeoutError`, so existing cancellation logic is unchanged.
  - The five calls left alone each already manage their own `AbortController` +
    `setTimeout` (local Ollama dev paths and the pronunciation preview).
  - New provider calls should use these helpers rather than bare `fetch`.
- `[FIXED]` **Urgent escalation steps had no lease.**
  `claim_due_urgent_escalation_steps` set `status = 'processing'` with no expiry and no
  reclaim path, and only selected `status = 'pending'`. The worker's catch handles a
  failed delivery, but if the process died between the claim and that catch the row
  stayed `processing` forever — nothing retried, nothing alerted. On the 2am emergency
  path that means nobody gets called. Migration `20260725213704` adds `lease_expires_at`
  plus a partial index, reclaims expired leases while attempts remain, and fails out
  exhausted ones so the incident can finish. Commit `3834e7e`.
  - **Lease is 300s; the worker is bounded at `maxDuration = 60`.** The lease must
    outlast the longest possible run or a step still being delivered could be reclaimed
    and the contact called twice about the same emergency. **Raising `maxDuration`
    without raising the lease breaks that guarantee.**
  - Migration was applied to production *before* deploying the code, because the code
    writes the new column.

- `[FIXED]` **Migration drift and the dead Drizzle layer** (both Tier 2 items, resolved
  together because they were the same problem). Of 46 SQL files, 15 were tracked only by
  the Drizzle journal, 23 only by Supabase's ledger, and **8 by neither** — including
  `outbound_messages`, `generated_documents` and `vapi_voice_calls`. Zero were tracked by
  both, so `npm run db:migrate` would have rebuilt roughly a third of the database and
  there was no working rebuild path or reliable staging environment.
  `supabase_migrations.schema_migrations` now lists all 46, keyed by filename timestamp.
  Drizzle is removed rather than repaired. Commit `8cfda50`.
  - Verified before recording: every table the 8 untracked migrations create already
    exists in production, and filename order matches the previous ledger order exactly.
  - `packages/db`, `drizzle.config.ts` and `supabase/migrations/meta` are deleted;
    `db:generate`/`db:check`/`db:studio` are gone; `npm run db:migrate` now runs
    `scripts/db-migrate.mjs` (supports `--dry-run`, never prints the connection string).
  - **Keep filenames and ledger versions matching**, or the CLI will try to re-run
    migrations that are already live.
  - Historical planning docs (`first-sprint-checklist`, `v1-foundation`,
    `implementation-plan`, `platform-strategy`) still mention Drizzle. Left as history;
    the active docs are corrected.

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

- `[FIXED]` **The mobile API fork.** `codex/mobile-app` was 480 commits behind main while
  both branches evolved `apps/web/src/app/api/mobile` independently — the iOS client
  called endpoints that 404'd in production (`usage-ledger`, `addresses/*`) and shapes
  that had drifted (`settings`, `workspace-tools`). Reconciled per-file into main
  (commit `a7fd86b`): ported the branch-only routes rebuilt over main's metered/timed
  Google helpers, merged settings (main's notifications + branch's account/email
  verification/phoneSms) and workspace-tools (branch's shared-reports refactor), took
  the branch's newer import-contacts, kept main's calendar/payments/inbox/reply-draft
  after verifying client-contract compatibility field by field. Then merged main back
  into `codex/mobile-app` (merge `b8beed3`, main-wins for all of `apps/web`) so mobile
  development continues against current code. Branch now 0 behind / 39 ahead (all
  `apps/mobile`).
  - **David chose to keep the Expo app on its branch** rather than fold it into main
    (keeps CI/Vercel installs lean). The standing risk: this fork re-opens unless
    `origin/main` is merged into `codex/mobile-app` regularly. Any session doing mobile
    work should start with that merge; `apps/web` conflicts resolve as main-wins.

- `[FIXED]` **Only 1 of 4 assistant turn paths compacted its thread.** Verified before
  changing anything — the claim held. The core engine (`runAssistantTurn`) was already
  shared; the *tail* was duplicated at four call sites and only the web one called
  `maybeCompactAssistantThreadContext`. Mobile text, mobile voice-turn, and internal
  SMS/WhatsApp threads never compacted, so raw history grew unbounded: rising cost per
  turn and eventually old context crowding out new. Commit `3253bc6`.
  - Extracted `finalizeAssistantTurn` (persist → summary → compact) and called it from
    all four sites. **Only the tail is shared on purpose** — actor identity, memory
    capture and the web fallback bail-out legitimately vary, so a single wrapper with
    six optional behaviours would have been worse than the duplication.
  - Second defect found while fixing: mobile text and voice-turn called
    `getAssistantTurnContext` (which always queries `assistant_context_snapshots`) then
    **omitted the result** when calling the engine — paying for the query and discarding
    it. The engine accepted this silently via `contextSnapshots = []`. That field is now
    **required**, so the type system rejects the omission.
  - Guarded by `assistant-turn-pipeline.test.ts`, which scans source for
    `runAssistantTurn` call sites rather than unit-testing behaviour — a unit test cannot
    catch a *new* path that forgets to compact, because the omission is the absence of a
    call. Proven by reintroducing the original bug (3 of 4 assertions failed).
  - **Deliberately unchanged:** `realtime/persist` and mobile `vapi-turn` write via
    `appendRealtimeAssistantMessage` and never load turn context. They are voice
    transcript recorders, not full turns. Whether they should compact is a separate
    product question, not a bug.

- `[FIXED]` **The operator health dashboard reported worker status from env vars.** Verified
  before changing anything, and it was actively wrong in production at the time. The
  "Cron and processor readiness" section computed `isConfigured(SECRET) ? "ok" : "error"`
  for three hand-named workers — the summary text literally said *"can be called by
  cron"*, asserting a capability rather than an outcome — and `system-health.ts` never
  queried `background_jobs` at all. Commit `609d9e5`.
  - **It was lying at the moment of inspection:** `outbound_delivery` had a dead-lettered
    job sitting for two days while this screen showed "ok" and `/api/background/health`
    was returning **503** about the same queue. Two screens in one app disagreeing, and
    the misleading one is the one an operator opens.
  - Coverage was worse than three fake checks: the queue runs **nine** job types and only
    three were named, so `calendar_sync`, `calendar_notifications`,
    `crm_lifecycle_review`, `recording_cleanup`, `assistant_suggestions`,
    `billing_access` and `billing_cycle` had no representation at all.
  - Now renders one check per real job type from `getBackgroundQueueMetrics`, using the
    same per-type thresholds (`BACKGROUND_JOB_MAX_READY_AGE_SECONDS`) as
    `unhealthyBackgroundQueueMetrics`, so the dashboard and the health endpoint cannot
    disagree. 11 tests on the pure status function.
  - The env-var checks it duplicated already existed in the Environment section, so
    nothing was lost.
  - **Resolved the stuck dead letter** it had been hiding: outbound SMS to `+1575855239`,
    a number with only 9 digits after `+1`, so Twilio rejected every attempt. Retry could
    never succeed, so the outbox row is `dismissed` and the job `cancelled`, both with
    reasons recorded. Queue verified clean afterwards: 0 dead letters, 0 expired leases,
    9 job types reporting.
  - **Could not verify whether the alert fired.** `sendInternalBugNotification` emails via
    Resend and writes nothing to the database, so absence of a record proves nothing.
    Worth checking the internal bug mailbox around 2026-07-23.

## New finding from that investigation

### Undialable recipient numbers burn retries and dead-letter `[FIXED]`

An inbound SMS from `+1575855239` (not a valid E.164 number) caused Kyro to auto-create a
contact, run triage, generate a reply, queue an outbound SMS, and consume three Twilio
attempts before dead-lettering. **Nothing validated that a recipient was dialable before
queuing.** `lib/crm/identity.ts` already imported `parsePhoneNumberFromString`, so the
capability existed but was not applied to the outbound path; `assertSmsSendAllowed` covers
consent/opt-out, not validity.

Fixed 2026-07-25 by validating at **both** ends, plus fixing the hardcoded country that
would have made the validation wrong outside Australia.

- **New `isDialablePhoneNumber(value, region)`** in `lib/crm/identity.ts`. A separate
  function was needed, not a reused signal: `normalizeContactPhoneForRegion` is
  deliberately lenient and *never* rejects a value containing digits — it ends
  `return countryCodeCandidate ?? digits`. Probed and confirmed:
  `normalizeContactPhoneForRegion("+1575855239")` returns `"+1575855239"`, not `null`.
  That leniency is correct for CRM identity matching and wrong for sending.
- **Send time** (`lib/communication/outbound.ts`): the SMS branch rejects an undialable
  recipient with a new `PermanentOutboundError`, and `markOutboundFailed` sends permanent
  errors straight to `failed` instead of scheduling retries that get the identical
  rejection. The decision is extracted as pure `outboundRetryDecision` so it is testable.
- **Call time** (`lib/voice/calls.ts`): `createOutboundVoiceCall` applies the same guard.
- **Intake** (`lib/inbound/manual.ts`): a contact created with a phone number that is not
  dialable is written `profile_resolution_status = 'needs_review'` with a reason, and
  tagged `undialable_phone`. This is the shared ingest path, so inbound SMS gets it too.
  Only fires when a phone is present — an email-only contact is untouched.

### The hardcoded country underneath it `[FIXED]`

Found while fixing the above and worth stating separately, because it was the larger bug.
Onboarding and settings already collect an operating country and store it as
`defaultPhoneRegion` (`lib/workspace/operating-countries.ts` maps AU/NZ/GB/US/CA). **Nine
call sites across six files ignored it and hardcoded `"AU"`** — so every send, contact
match and consent lookup interpreted bare local numbers as Australian regardless of what
the workspace had configured.

The damage is not theoretical: `contacts.normalized_phone` and
`sms_recipient_preferences.normalized_phone` are *written* using the workspace region and
were being *read* using `"AU"`. A mismatch means a duplicate contact on every inbound
message, and — worse — a recipient who texts STOP recorded under one key and checked under
another, so Kyro keeps texting them.

Fixed by adding `getWorkspacePhoneRegion(supabase, workspaceId)` to
`lib/workspace/general-settings.ts` (one indexed query, rather than the three that
`getWorkspaceGeneralSettings` costs, because these paths run per message) and threading it
through every site. `grep` for a hardcoded region literal now returns nothing.

Two sites deliberately keep no region, both documented in code: matching a dialled number
to the workspace that owns it (no workspace known yet) and stamping a call record's own
from/to columns (provider-supplied E.164, which ignores the region anyway).

### The cross-country search, removed `[FIXED]`

Recorded above as a known limit and then fixed the same day on the owner's call, which was
the right one: `normalizeContactPhoneForRegion` treated the workspace region as a hint and,
when a number failed there, searched every other country until something validated. So
`07700900123` for a GB workspace became `+917700900123` — a real, dialable Indian number —
and was reported as fine.

The business argument against that fallback is decisive. Kyro's users are local service
businesses; someone inquiring about a plumber, accountant or photographer is in that
country. A bare local number that does not parse there is a mistake, not a foreign
customer. Searching 200 other countries almost never finds the truth and, when it
"succeeds", manufactures a confident wrong answer that hides the error.

A number is now read exactly two ways and no other:

1. **With an explicit country code** (`+61…`, `0011 1 415…`) — honoured as written, so
   genuine overseas contacts still work. This is the escape hatch.
2. **The local way** (`0412 345 678`, `412 345 678`, `61412345678`) — read as a number in
   the workspace's own country.

Anything else is stored **as the user typed it**, kept as a stable digits-only key so the
contact still groups, and fails `isDialablePhoneNumber` so it surfaces as `needs_review`
for a human. No country is ever invented.

Every spelling of one number collapses to one key — with or without the country code, with
or without the leading zero, with or without the plus. `+61412345678`, `61412345678`,
`0412345678`, `0412 345 678`, `412345678` and `0061412345678` are one contact, not six.
Asserted for AU mobile, AU landline, US, GB, NZ and CA.

Dropping the plus is restricted to the workspace's **own** calling code. Accepting a bare
foreign code would read `4155550123` in an AU workspace as `+41…` and quietly make it
Swiss — the same manufactured-answer failure in a new coat.

- `normalizeContactPhone` (the region-less variant) is **deleted**. It had no production
  callers left and silently meant "AU"; removing it makes omitting the region impossible.
- The dead search machinery (`prioritizedCountryOrder`, `fallbackInternationalDigits`, the
  `allowPossible` pass) is gone with it — roughly 60 lines.
- `crm/queries.ts` had three region-blind sites. `contactSearchFilter` was the dangerous
  one: without the region, searching `0412 345 678` would have stopped matching the contact
  stored as `+61412345678`. All three now take the workspace region.

**Measured against live data before shipping.** Of 20 contacts with phone numbers across
both workspaces, **16 normalize byte-identically** and 4 change — and those 4 are exactly
the 4 that were already undialable (`+1575578888`, `+1575855239`, `+61471782952`,
`+15788522585`, all the owner's own mock inquiries). No legitimate number moved.

**Correction to an earlier claim in this document's investigation:** a query against
`policy_type = 'general'` returned no region and prompted the conclusion that signup never
persists the operating country. That was a bad query — the real value is
`workspace_general`. `packages/api/src/services/bootstrap.service.ts` has always mapped
country → phone region → currency at bootstrap, and production confirms it: WFA Plumbing is
`AU`, WFA Contractors is `US`. There is no gap.

## Tier 1 — all clear

All Tier 1 items are fixed. Start at Tier 2.

### 1. Contacts and Inbox are hard-capped at 100 rows `[FIXED]`

`lib/crm/queries.ts:1040` — `getContactList` ends in `.limit(100)` with no offset or
cursor. `app/contacts/page.tsx:73` sets `CRM_PAGE_SIZE = 10` and slices client-side
(`:1304-1307`), and search filters the same truncated array.

Harmless today (production has 25 contacts). At 300 contacts a customer silently loses
two thirds of their CRM, and searching for a missing contact returns nothing. There are
four separate `.limit(100)` sites in that file.

### 2. Zero tests on the highest-consequence code `[FIXED]`

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

### 3. `textValue` is defined 135 times with divergent contracts `[FIXED]`

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

### Triage pass, 2026-07-26

The list below was written before a day of fixes and was never revisited, so it had
drifted badly out of date. A pass over it found three groups.

**Already resolved by later work — ignore these entries below:**

- `commands.ts` at 8,778 lines → split, now 6,606 across seven modules.
- `settings/page.tsx` at 6,311 lines → split, now **337** across fourteen sections.
- The assistant turn pipeline written four times → unified.
- `/api/mobile` as a parallel re-implementation → reconciled into main.
- Worker health computed from environment variables → now derived from real queue metrics.
- `textValue` duplication → one definition. `objectRecord` (73 copies) went with it.
- `packages/core` "100% dead" → **no longer true**: 144 files import it, because the
  shared value helpers now live there.

**Checked and found FALSE — do not resurrect:**

- `settings/page.tsx` "correctness rests on an undocumented never-conditionally-render,
  only-CSS-hide invariant". The opposite is true: the page renders exactly one section
  through a chain of `selectedSection === …` ternaries and CSS-hides nothing. There was no
  invariant to break, which is also why the split was safe on that axis.

**Confirmed real and still open — these are the ones worth acting on:**

- `[VERIFIED]` **12 of the 19 `formatDate` implementations ignore the workspace timezone.**
  Not the mechanical duplication the entry below implies: there are 12 genuinely distinct
  implementations, differing in format, empty label and timezone handling, so merging them
  would change what users see and needs a product decision. The real defect is narrower and
  worse: pages including contacts, the contact profile panel and documents render dates in
  the *server's* timezone. On Vercel that is UTC, so for an AU workspace a 9am Melbourne
  message displays as the previous day. `lib/timezone.ts` already has a tested
  `formatWorkspaceDateTime`; those call sites bypass it.
- `[VERIFIED]` The `@/*` path alias is declared and used **zero** times. Harmless, but it
  means every import is a deep relative path.
- `[VERIFIED]` `getContactList` fetched every message row to compute two integers — see
  Fixed above. Confirmed real, and closed on 2026-07-26.

Everything else below remains genuinely unchecked.

### Second triage pass, 2026-07-26 (the long tail, verified against code and the live DB)

The `formatDate`/timezone item above was closed by commit `f023437`. The scan written for it
found **eleven more** formatters a name-based search could never have found, so the real
count was never 12 of 19.

The rest of the long tail was then checked one by one. Results below; every entry was
confirmed by reading the code or querying production, not by re-reading the audit.

**Confirmed real, now tracked as work items:**

- `[VERIFIED]` **Usage metering errors are discarded.** Three sites insert into
  `usage_events`. `lib/ai/triage.ts:2655` checks the error and throws;
  `lib/ai/customer-message-generation.ts:352` and `lib/ai/reply-draft-generation.ts:614`
  ignore it. Billable work can vanish from the ledger customers are charged from.
  (Broader pattern: 81 write statements repo-wide bind no error — the audit said 58.)
- `[VERIFIED]` **No global uniqueness on assigned phone numbers.** The unique index is
  `(workspace_id, normalized_phone)`; the global one applies only `WHERE workspace_id IS
  NULL` (the unassigned pool). Inbound routing does `.limit(1).maybeSingle()`, so a number
  assigned twice would silently route a customer's reply to the wrong workspace.
- `[VERIFIED]` **`try`/`catch` swallows Next.js redirects at three sites** —
  `inbox/actions.ts:1589`, `contacts/actions.ts:535`, `engine/actions.ts:136`. `redirect()`
  signals by throwing; these catch it on the success path and report failure *after the
  work has committed*. No `isRedirectError` guard exists anywhere in the repo.
- `[VERIFIED]` **The public signup address routes are unmetered and unthrottled.**
  `api/auth/create-account/places/{autocomplete,place}` call the paid Google Places API
  with no auth (correct, they are pre-signup), no rate limit, and none of the
  `recordGoogleApiUsage` metering their authenticated twins have. Anyone can run up the
  Google bill, and it would not show in the usage dashboard.
- `[VERIFIED]` **Two of nine job types mark failed syncs as completed.**
  `inbound_email_sync` ignores `result.errors[]`; `calendar_sync` ignores
  `providers[].error`. `calendar_notifications` gets this right and is the model to copy.
  An expired Gmail token stops inbound mail while the queue reports green.
- `[VERIFIED]` **`usage_rollups` is dead and the raw sweep runs on every page.**
  Live DB: `usage_rollups` = **0 rows**, zero reads in the codebase; `usage_events` = 1,159
  rows and growing per AI call. `usage-summary.ts:201` pages through the raw events, and
  `app-frame` calls it 2–3× per authenticated render, to draw the usage pills.
- `[VERIFIED]` **Hydration mismatch in the floating assistant widget** —
  `floating-assistant-widget.tsx:51` seeds `useState` from `localStorage`, which throws on
  the server and returns the real value on the client. Mounted on every authenticated page.
- `[VERIFIED]` **`libphonenumber-js` does reach the `/settings` client bundle**, via
  `workplace-contacts-editor.tsx` → `lib/crm/identity`.
- `[VERIFIED]` **`tool-registry.ts` is hand-maintained documentation**, 16 entries in its
  own taxonomy against 17 real `kyro_*` tools, with nothing connecting the two — yet
  `developer/assistant-tools` renders it as the authority on permissions and approval gates.
- `[VERIFIED]` **No `Suspense` in any page body.** Exactly one file in the app uses it
  (`app-frame.tsx`). Every screen waits for its slowest query before painting. Real, but a
  broad refactor rather than a defect.
- `[VERIFIED]` **`messages` has no composite index for the ordered thread read.** Live DB
  shows only `messages_pkey` and the `(workspace_id, contact_id)` partial index added for
  the contact-activity RPC. `conversations` *is* correctly indexed on
  `(workspace_id, last_message_at DESC) WHERE deleted_at IS NULL`. Harmless at 69 rows;
  worth doing before real volume.
- `[VERIFIED]` **The provider abstraction is nominal** — 36 files touch OpenAI, 2 import
  `providers`. `current-architecture.md:1122` claiming providers are swappable is wrong.

**Checked and found FALSE or already resolved — do not resurrect:**

- "The contact profile panel exists twice with bidirectional drift." **Resolved.** There is
  now one `app/components/contact-profile-panel.tsx`; the mobile reconciliation closed it.
- "The public waitlist endpoint is un-hardened." **FALSE.** `api/waitlist/route.ts:191`
  rate-limits at 10 requests/hour via the shared `consumeApiRateLimit`.
- "`@vapi-ai/web` (310KB) is statically imported with no code splitting." **Misleading.**
  It is imported only by `vapi-voice-console.tsx`, so it is already scoped to
  `/voice-vapi` and does not load elsewhere.
- "`packages/core` is 100% dead." **FALSE** since the shared value helpers moved there —
  144 files import it.

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
