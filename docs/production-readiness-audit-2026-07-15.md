# Kyro production-readiness audit - 2026-07-15

## Verdict

Kyro is structurally sound and feature-rich enough for a controlled production
beta with a small number of closely monitored customers. The application is not
generally spaghetti code: its core domains, persistence, integrations, and
server-side boundaries are recognizable and mostly consistent.

Kyro is not yet ready for an unattended public self-serve launch. The remaining
blockers are not ordinary UI polish or smoke-test findings. They are missing
operational behaviours that protect customers, Kyro, or both when automation
fails or payment state changes.

## Launch blockers

### 1. Urgent escalation has no runtime executor

The settings UI persists triggers, active hours, contacts, channels, delays,
and acknowledgement behaviour. No production worker currently evaluates an
urgent event against that policy and executes its ordered SMS, notification,
email, and phone-call steps.

Required before public launch:

- create a durable escalation incident when a configured trigger fires;
- evaluate workspace-local hours and contact routing;
- execute ordered steps at their configured offsets;
- stop later steps when acknowledgement is required and received;
- retry transient delivery failures without duplicating successful steps;
- expose incident state and delivery history to the user and operator;
- alert Kyro when an escalation exhausts its policy without delivery.

The current configuration surface lives in
`apps/web/src/app/settings/escalation-settings-editor.tsx`, but it is not backed
by an incident/step execution engine.

### 2. Billing records charges but does not enforce account state

Kyro owns billing periods, invoices, line items, Stripe off-session charges,
failed-payment retries, and webhook reconciliation. That is a real billing
engine, not merely a usage display.

What is missing is an entitlement/dunning layer. Trial expiry and exhausted
payment retries do not currently put an account into a restricted state, so an
unpaid account can continue incurring OpenAI, Vapi, Twilio, Google, and email
provider costs. Customers also do not receive a complete failed-payment and
invoice-notification flow.

Required before unattended self-serve launch:

- define active, trial, grace-period, payment-failed, restricted, and cancelled
  account states;
- enforce those states at expensive server-side action boundaries;
- retain read-only access while blocking new paid provider work where suitable;
- send invoice, failed-payment, retry, and restriction notifications;
- provide a clear payment-recovery path and automatic restoration after payment;
- reconcile Kyro invoice totals against Stripe and provider invoices.

The existing engine is in
`apps/web/src/lib/billing/kyro-billing-engine.ts`. The existing
`workspace_entitlements` model is not yet used as the runtime billing gate.

### 3. Scheduled work is capped and non-durable

The email sync, calendar sync, CRM lifecycle review, billing, calendar
notifications, and assistant-suggestion jobs are Vercel cron routes that scan a
fixed number of rows sequentially. Examples include first-200 workspace scans
in the email, calendar, and lifecycle workers and fixed 500/100 limits in the
billing runner.

At small beta scale this is workable. At public-launch scale, workspaces beyond
the cap can be starved, one slow invocation can overrun the function window,
and per-workspace exceptions can be returned inside an HTTP 200 response without
creating a central incident.

Required before the customer count approaches those caps:

- paginate with a durable cursor instead of repeatedly selecting the first rows;
- claim jobs atomically so concurrent cron invocations cannot duplicate work;
- use a durable queue or job table with retries and dead-letter state;
- record worker heartbeats, last success, lag, attempted count, and failure count;
- notify Kyro when a worker is late, repeatedly failing, or accumulating backlog.

Relevant routes include
`apps/web/src/app/api/integrations/email/sync/route.ts`,
`apps/web/src/app/api/integrations/calendar/sync/route.ts`, and
`apps/web/src/app/api/crm/lifecycle/review/route.ts`.

### 4. Signup is not recoverable as one operation

Account creation currently checks for duplicates by scanning up to 50,000
Supabase Auth users, then creates the auth user, workspace, and billing setup in
separate operations. If a later step fails, the user can be left with a partial
account and a retry can be rejected as a duplicate.

Required before broad self-serve acquisition:

- replace full Auth user scans with an indexed identity lookup;
- make workspace/bootstrap operations idempotent;
- record onboarding/bootstrap state explicitly;
- resume or compensate partial signup rather than leaving an unusable account;
- add operator visibility and a repair action for incomplete accounts.

The current path is `apps/web/src/app/api/auth/create-account/route.ts`.

### 5. Recording disclosure needs a launch policy

Provider-side call recording and 30-day physical deletion are implemented. Kyro
can therefore retain recordings for complaint and AI-behaviour review without
indefinite storage.

The unresolved item is legal/product policy: calls are recorded without a Kyro
disclosure prompt. Recording and consent rules vary by jurisdiction. Broad
launch requires approved rules for where Kyro operates, plus either disclosure
language, jurisdiction gating, or another legally reviewed mechanism. This is a
legal launch gate rather than a missing storage feature.

## Important production gaps

### Complete commercial usage metering

OpenAI, Vapi/Twilio, and Google Places/Address usage have metering paths. Gmail,
Google Drive, Google Calendar, and other Google API calls are not consistently
represented as non-zero provider-cost events. This conflicts with the intended
rule that all billable provider work is visible in the usage ledger.

Add one shared metered-provider wrapper for every Google call and store provider
cost and customer charge separately so the workspace margin override remains
safe to change.

### Central observability and deployment gates

Kyro has internal bug emails, audit records, Vercel logs, and developer health
views, but no central exception tracker, external uptime check, cron-lag alert,
or repository CI workflow. Several workers deliberately catch individual errors,
which means an empty Vercel error-log scan is not proof that all scheduled work
completed.

Before public launch, add:

- CI for lint, typecheck, tests, migration validation, and production build;
- an external uptime check for the web app and critical webhook/worker health;
- centralized exception reporting with release/deployment identifiers;
- alerts for Stripe webhook failures and all overdue scheduled workers.

### Password breach protection

Supabase Auth leaked-password protection is disabled. Enable it in the Supabase
dashboard before public launch. The database advisor otherwise has no remaining
actionable security-definer or mutable-search-path warnings after the hardening
migration in this audit.

### Specialist regulatory knowledge

Kyro can use current web search for regulation and licensing questions, but it
does not contain the planned Australian legislation corpus. This is not a blocker
if Kyro clearly treats those answers as researched assistance rather than
authoritative compliance advice. It becomes a blocker if specialist compliance
answers are marketed as a core guaranteed feature.

## Deliberate non-blockers at current scale

- Phone-number provisioning can remain manual while onboarding is controlled.
- Polling-first Gmail/Outlook sync is acceptable; push watch/subscription
  lifecycle can remain deferred if the product describes the expected delay.
- The current 30-day call-recording deletion worker is suitable once the legal
  disclosure policy is settled.
- Large settings and assistant modules are maintainability hotspots, but their
  size alone does not prevent launch.

## Hardening completed in this audit

- Added idempotent Stripe webhook handling and changed processing failures to
  return HTTP 500 so Stripe retries instead of silently losing reconciliation.
- Prevented duplicate failed-payment webhooks from inflating retry counts.
- Added database-error checks to critical billing state transitions.
- Added database-backed rate limiting to account creation, verification resend,
  and waitlist submission.
- Added a complete password-recovery flow.
- Added baseline browser security headers and production HSTS.
- Replaced exposed `SECURITY DEFINER` membership helpers with private helpers and
  invoker wrappers, hardened function search paths, and revoked client grants
  from service-only tables.
- Corrected production environment parsing and pinned the Next.js toolchain.
- Removed avoidable calendar state-sync effects found by lint.

## Dependency position

The production dependency audit has no high or critical findings. It currently
reports two moderate findings inherited through Next.js's pinned PostCSS
dependency. Next.js 16.2.10 still declares that exact nested version and npm's
suggested remediation is an invalid major downgrade. Kyro does not stringify
untrusted CSS, so this is an accepted short-term exposure to revisit when Next.js
ships the patched transitive dependency.

## Recommended release sequence

1. Keep onboarding controlled and launch as a closely monitored beta.
2. Build urgent-escalation execution before promising emergency handling.
3. Add billing entitlement enforcement and customer dunning before charging
   unattended self-serve customers.
4. Replace fixed-cap cron scans with durable queued work before approaching 100
   active workspaces.
5. Make signup bootstrap resumable before enabling open signup traffic.
6. Approve the recording-consent policy for every supported launch jurisdiction.
7. Finish provider metering, central monitoring, CI, and the Supabase password
   protection toggle.
