# Desktop Handover - May 24, 2026

This document is the practical handover for moving Kyro work from the MacBook back
to the desktop machine.

It covers the current branch, local setup, required env values, the major product
changes added during this work session, what is currently testable, and what still
needs attention.

## Start Here On The Desktop

Use the feature branch, not `main`.

```bash
cd /path/to/kyro
git fetch origin
git switch codex/assistant-snappiness-pass
git pull --ff-only
npm install
npm run env:check
npm run db:check
npm run db:migrate
npm run dev
```

If the branch does not exist locally yet:

```bash
git fetch origin
git switch -c codex/assistant-snappiness-pass origin/codex/assistant-snappiness-pass
```

The app should run at:

```text
http://localhost:3000
```

Important: `origin/main` is still the early backup line. The current product work is
on `codex/assistant-snappiness-pass`.

## Current Product Shape

Kyro is now a Next.js + Supabase + OpenAI web app for proving the assistant, CRM,
inbox, voice, document, and usage workflows before the iOS-first product becomes
the main customer experience.

Primary screens:

- Assistant: text control surface for Kyro.
- Voice: OpenAI realtime voice assistant.
- Inbox: work queue, skipped-email review, customer replies, promotion into CRM.
- CRM: contacts/leads/customer records.
- Documents: quote templates, quote drafts, customer approval links, PDFs.
- Log: workspace activity timeline.
- Settings: general, outbound, voice, integrations, usage/billing.
- Developer: local test tools only.

Useful docs already in the repo:

- `docs/current-architecture.md`
- `docs/assistant-help-manual.md`
- `docs/deployment-checklist.md`
- `docs/model-routing-and-usage.md`
- `docs/usage-based-billing.md`
- `docs/data-model.md`
- `docs/database.md`

## Environment Values Needed

Do not commit `.env` files or raw secrets.

You will need these values on the desktop:

```text
NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

OPENAI_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
INTEGRATION_TOKEN_ENCRYPTION_KEY=

INBOUND_EMAIL_SYNC_SECRET=
CRON_SECRET=
```

Optional for later:

```text
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_VOICE_NUMBER=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

The current `.env.example` includes the model defaults and local dev defaults.

Production warning: keys were pasted during development. Rotate any provider keys
that were exposed in chat, screenshots, shell history, or logs before public launch.

## Supabase Notes

Current Supabase project reference used during MacBook work:

```text
bsmjcthgodaoadkatfwo
```

Migrations currently present:

- initial core schema,
- tenant RLS,
- contact profile fields,
- quote drafts,
- inquiry facts,
- assistant memory,
- Google integrations,
- security/performance hardening,
- pronunciation vocabulary,
- skipped email indexes,
- quote approval links.

Run before using the desktop DB:

```bash
npm run db:check
npm run db:migrate
```

Optional Supabase MCP setup for Codex on the desktop:

```bash
codex mcp add supabase --url https://mcp.supabase.com/mcp?project_ref=bsmjcthgodaoadkatfwo
```

Then enable remote MCP in `~/.codex/config.toml`:

```toml
[mcp]
remote_mcp_client_enabled = true
```

Then authenticate:

```bash
codex mcp login supabase
```

This is useful for inspecting live schema/data from Codex, but Kyro itself does not
require MCP to run.

## Google OAuth Notes

The local Google OAuth app should include:

- JavaScript origins:
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
- Redirect URIs:
  - `http://localhost:3000/integrations/google/callback`
  - `http://127.0.0.1:3000/integrations/google/callback`

The app currently uses Gmail send/read scopes and Drive file scope placeholders.

OAuth refresh tokens are encrypted with `INTEGRATION_TOKEN_ENCRYPTION_KEY`. If this
key changes between machines or environments, existing provider connections may need
to be disconnected and reconnected.

## Major Features Added During This Session

### 1. Repo Recovery And More Advanced Local State

We cloned Kyro, compared the repo state with the more advanced local project, and
continued from the more advanced version.

The active work line is now the pushed branch:

```text
codex/assistant-snappiness-pass
```

### 2. OpenAI-Based Assistant Runtime

Kyro was moved away from local-only LLM assumptions for this environment.

Current direction:

- Assistant uses OpenAI by default.
- Local Ollama support still exists as a development fallback.
- Model routing and usage metering are centralized rather than scattered through the UI.
- OpenAI API calls are tracked into `usage_events`.

Important files:

- `apps/web/src/lib/assistant/providers.ts`
- `apps/web/src/lib/ai/triage.ts`
- `apps/web/src/lib/usage/openai.ts`
- `docs/model-routing-and-usage.md`
- `docs/usage-based-billing.md`

### 3. Live Realtime Voice Assistant

The Voice screen was upgraded from a close-enough audio loop into an OpenAI realtime
voice flow using WebRTC.

Current behaviour:

- Voice and text Assistant share the same workspace/thread context.
- The voice assistant can call the same Kyro tools as chat.
- Voice uses OpenAI realtime voice, currently `ballad` by default.
- VAD/silence detection was tuned to be less sensitive to background noise.
- The voice UI keeps controls at the top and fills transcript/messages below.
- Transcript ordering and duplicate assistant-message issues were improved.
- Realtime voice usage is metered.

Important files:

- `apps/web/src/app/voice/page.tsx`
- `apps/web/src/app/voice/realtime-voice-console.tsx`
- `apps/web/src/app/api/assistant/realtime/call/route.ts`
- `apps/web/src/app/api/assistant/realtime/persist/route.ts`
- `apps/web/src/app/api/assistant/realtime/tool/route.ts`
- `apps/web/src/lib/assistant/speech.ts`
- `apps/web/src/lib/assistant/voice-settings.ts`

Useful env defaults:

```text
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=ballad
OPENAI_REALTIME_VAD_THRESHOLD=0.74
OPENAI_REALTIME_VAD_SILENCE_DURATION_MS=1200
OPENAI_REALTIME_VAD_PREFIX_PADDING_MS=300
```

### 4. Voice Settings And Pronunciation Vocabulary

Voice settings were simplified around OpenAI as the product voice provider.

Current behaviour:

- Speech provider choice was removed from user settings.
- User can control useful OpenAI voice settings instead.
- Pronunciation vocabulary supports phrase, phonetic "say it like", category, aliases,
  usage count, last used timestamp, and auto/manual source.
- Suggested vocabulary entries auto-fill a best-effort pronunciation instead of leaving
  blank fields.
- The list is compact, one row per vocabulary item.
- Preview uses the voice-agent pathway more closely than the old basic TTS route.
- Aliases can be enriched by a lightweight LLM pass.
- Assistant can update pronunciation entries by chat/voice.
- The suggestion filter was tightened so common dictionary words such as "Premier",
  "League", and "Arsenal's" are less likely to be added.

Important files:

- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/app/settings/pronunciation-preview-player.tsx`
- `apps/web/src/app/api/assistant/pronunciation/preview/realtime/route.ts`
- `apps/web/src/lib/assistant/pronunciation.ts`
- `apps/web/src/lib/assistant/pronunciation.test.ts`
- `supabase/migrations/20260518175710_pronunciation_vocabulary.sql`

Product rule:

- Kyro can infer/use pronunciations internally.
- For customer-facing outbound voice, pronunciation risk should respect the outbound
  pronunciation policy unless the user relaxes it.

### 5. Assistant Help Manual And Settings Control

We created and wired a user-facing manual/knowledge source so Kyro can answer
"how do I use this?" questions from both text and voice.

Current behaviour:

- Assistant can answer from `docs/assistant-help-manual.md`.
- Voice uses the same help access.
- Architecture docs are available to the assistant for more technical product answers.
- Assistant can safely update a limited set of settings.
- Assistant can update voice vocabulary.
- Assistant can update document-template settings.

Important files:

- `docs/assistant-help-manual.md`
- `apps/web/src/lib/assistant/knowledge-corpus.ts`
- `apps/web/src/lib/assistant/knowledge.ts`
- `apps/web/src/lib/assistant/settings-tools.ts`
- `apps/web/src/lib/assistant/settings-tools.test.ts`
- `apps/web/src/lib/assistant/commands.ts`
- `apps/web/src/lib/assistant/commands.test.ts`

Good test prompts:

- "What does lookback mean in email sync, and should I change it?"
- "Can you explain aliases in the pronunciation list, and do they change what Kyro says out loud?"
- "Change the quote validity to 21 days."
- "Add Coorparoo to pronunciation and say it like Coo-pa-roo."

### 6. Public Web Search Tooling

The Assistant can use a basic web search path for current/public information when
enabled.

Current env:

```text
ASSISTANT_WEB_SEARCH_ENABLED=true
```

Important file:

- `apps/web/src/lib/assistant/web-search.ts`

Usage events for web-search tool calls are tracked.

### 7. Inbound Email Sync Foundations

Inbound email sync was wired around scheduled/manual polling rather than push
notifications for now.

Current behaviour:

- Gmail/Outlook connections are represented in Settings.
- Manual "check inbox now" uses the same path the assistant can call.
- Scheduled sync is intended to run every five minutes.
- Quiet hours can suppress scheduled sync and resume after quiet hours rather than
  checking once during the quiet window.
- The sync UX now shows clearer states for missing scopes, reconnect needed, last sync,
  next sync, sync failed, and manual check running.
- Disconnect/reconnect paths exist.

Important files:

- `apps/web/src/app/api/integrations/email/sync/route.ts`
- `apps/web/src/lib/integrations/inbound-email-sync.ts`
- `apps/web/src/lib/integrations/inbound-email-settings.ts`
- `apps/web/src/lib/integrations/gmail.ts`
- `apps/web/src/lib/integrations/google.ts`
- `apps/web/src/lib/integrations/outlook.ts`
- `apps/web/src/lib/integrations/microsoft.ts`
- `apps/web/src/lib/integrations/token-vault.ts`
- `apps/web/src/app/settings/manual-sync-submit-button.tsx`

Production cron:

```json
{
  "path": "/api/integrations/email/sync",
  "schedule": "*/5 * * * *"
}
```

### 8. Filtered-Out Email Review

Inbox now separates business work from skipped/non-work email while still letting the
user review skipped items.

Current behaviour:

- Compact "filtered-out emails" button near the Inbox count.
- Last-24-hours skipped count on the button.
- Popup/modal list of skipped emails.
- Replied skipped emails collapse to two-line summaries.
- Each skipped email can be expanded.
- Promote button turns a skipped email into CRM work.
- Reply button opens a compact reply UI.
- AI reply generation accepts a short direction prompt and uses the email context.
- Replied state is logged internally and shown with a distinct pill.
- Three-dot menu hides backend classification details and sender rules.
- User can mark a sender as always relevant or always ignored.
- The menu closes when clicking outside it.

Important files:

- `apps/web/src/app/inbox/page.tsx`
- `apps/web/src/app/inbox/skipped-email-more-menu.tsx`
- `apps/web/src/app/inbox/skipped-email-reply-details.tsx`
- `apps/web/src/app/inbox/skipped-email-sender-rule-controls.tsx`
- `apps/web/src/app/inbox/reply-generator.tsx`
- `apps/web/src/app/inbox/actions.ts`
- `apps/web/src/lib/inbound/manual.ts`
- `apps/web/src/lib/inbound/follow-up.ts`
- `supabase/migrations/20260522001249_event_skipped_email_indexes.sql`

### 9. Inbox Action Workflow

Filtered-out email actions were expanded but kept visually minimal.

Current behaviour:

- Primary Promote button.
- Reply button.
- Three-dot menu for sender learning and hidden decision details.
- Skipped email classification details are not cluttering the visible card.
- Confidence is de-emphasized because it was not meaningful enough as primary UI.
- Sender rules update live in the popup.

The structured sender-rule path is intentionally ready for deeper future automation,
but the visible UI stays simple.

### 10. UI Loading And iOS-First Layout Pass

We did a snappiness pass and an iOS-first pass.

Current behaviour:

- Main logged-in routes are idle-prefetched from the app shell.
- Long repeated list rows avoid aggressive prefetching.
- Route loading skeletons exist for the main screens.
- Settings loads only the selected detail panel instead of all panels at once.
- Usage ledger loads only when the usage section/modal needs it.
- Inbox/voice/settings adapt more naturally to narrow mobile screens.
- Desktop split views become mobile-style task panels on small screens.
- Settings info text was moved into hover/click info bubbles to reduce permanent clutter.
- The settings sidebar no longer shows redundant status pills on every section.

Important files:

- `apps/web/src/app/components/app-frame.tsx`
- `apps/web/src/app/components/route-preloader.tsx`
- `apps/web/src/app/components/page-skeleton.tsx`
- `apps/web/src/app/settings/info-bubble.tsx`
- `apps/web/src/app/settings/settings-shell.tsx`
- `apps/web/src/app/globals.css`

### 11. Settings Reorganization

Settings now has a more scalable structure.

Current sections:

- General: timezone and display currency.
- Outbound: communication settings, approvals, channels, signatures.
- Voice: voice assistant, pronunciation, preview.
- Integrations: connected accounts and email sync.
- Usage: usage and billing visibility.

Changes made:

- Timezone moved into General.
- Display currency added.
- Redundant provider choice removed from Voice.
- Large explainers became info bubbles.
- Quiet-hours language clarified around cost-saving and suppression.
- Email sync controls and states were polished.

Important files:

- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/app/settings/actions.ts`
- `apps/web/src/lib/workspace/general-settings.ts`
- `apps/web/src/lib/workspace/general-settings.test.ts`

### 12. Documents And Quote Templates

Documents became a much richer workflow.

Current behaviour:

- Templates pane starts empty rather than with prebuilt trade templates.
- Create template screen exists.
- Template builder supports:
  - template name,
  - type,
  - description,
  - direction prompt,
  - accent/currency/validity/payment terms/footer,
  - line items,
  - overall notes,
  - reference-file metadata,
  - live preview,
  - Kyro edit prompt,
  - large preview modal.
- Template preview uses the same document renderer as the print/PDF route so preview
  and customer output stay aligned.
- Saved templates can be viewed/edited from the Templates pane.
- Template cards were compacted so many templates can stack.
- Create draft from template opens an unsaved draft editor first.
- If the user backs out without saving, no draft is created.
- Draft title defaults to template name plus timestamp down to HH:MM.
- Quote drafts use structured line item rows rather than one big text box.
- Customer selector is a typeahead search over name, company, email, phone, and address.
- Saved quote drafts can render customer-facing HTML and server-generated PDFs.

Important files:

- `apps/web/src/app/documents/page.tsx`
- `apps/web/src/app/documents/new/page.tsx`
- `apps/web/src/app/documents/templates/new/page.tsx`
- `apps/web/src/app/documents/templates/new/template-builder-form.tsx`
- `apps/web/src/app/documents/templates/[templateKey]/page.tsx`
- `apps/web/src/app/documents/[quoteDraftId]/page.tsx`
- `apps/web/src/app/documents/[quoteDraftId]/quote-draft-editor-form.tsx`
- `apps/web/src/app/documents/[quoteDraftId]/print/route.ts`
- `apps/web/src/app/documents/[quoteDraftId]/pdf/route.ts`
- `apps/web/src/lib/documents/templates.ts`
- `apps/web/src/lib/documents/template-revision.ts`
- `apps/web/src/lib/documents/render.ts`
- `apps/web/src/lib/documents/pdf.ts`

### 13. Assistant Document Control

Assistant can now work with document templates and quote drafts.

Current behaviour:

- Assistant can create a quote draft from an existing reusable template.
- Assistant can link a quote draft to a contact when the user names one.
- Assistant can revise reusable templates.
- Assistant can prepare a quote-send email instead of directly sending.
- Assistant can answer quote status/history questions.
- Sending remains approval-gated.

Important files:

- `apps/web/src/lib/assistant/commands.ts`
- `apps/web/src/lib/documents/history.ts`
- `apps/web/src/lib/documents/revisions.ts`
- `apps/web/src/lib/documents/approval.ts`
- `apps/web/src/lib/documents/settings.ts`

Good test prompts:

- "Create a quote draft from my invoice template for Mikel."
- "Make the invoice template more premium and add subtle blue accents."
- "What quotes are ready to send?"
- "Has this quote been sent?"
- "Did the customer approve the quote?"

### 14. Customer Quote Approval Links

Customer approval flow exists.

Current behaviour:

- Quote drafts can generate secure customer approval links.
- Links store hashes, not raw tokens.
- Customer approval page does not require sign-in.
- Customer can approve or request changes.
- Approval/change requests write quote history.
- Change requests can reopen the linked conversation and add a portal-origin inbound message.
- Fresh links revoke older active links for the same quote.

Important files:

- `apps/web/src/app/quote/approve/[token]/page.tsx`
- `apps/web/src/app/quote/approve/actions.ts`
- `apps/web/src/lib/documents/approval.ts`
- `apps/web/src/lib/documents/history.ts`
- `supabase/migrations/20260524194856_quote_approval_links.sql`

### 15. Quote Revision Workflow

Quote revisions are now tracked.

Current behaviour:

- New quote starts as `v1`.
- If a customer requests changes, the quote is flagged as needing revision.
- Editing after a requested change increments the version.
- Revised sends create new approval links.
- Document history records generated/sent/viewed/approved/change-requested events.

Important files:

- `apps/web/src/lib/documents/revisions.ts`
- `apps/web/src/lib/documents/revisions.test.ts`
- `apps/web/src/lib/documents/history.ts`
- `apps/web/src/lib/documents/history.test.ts`

### 16. Usage Metering And Billing Visibility

Usage tracking was upgraded from local-model era estimates into OpenAI-aware metering.

Current behaviour:

- OpenAI Responses usage is normalized into input/output/cached/reasoning rows.
- Realtime voice usage is normalized from `response.done` events.
- STT/TTS usage is tracked.
- Web search tool calls are tracked.
- Inbound email processing, reply drafting, assistant work, pronunciation, template
  edits, quote actions, and outbound email are metered where wired.
- Usage settings screen shows:
  - usage charge,
  - usage by task,
  - provider/model technical breakdown,
  - model/service info bubbles explaining what each is used for,
  - detailed ledger modal,
  - CSV ledger export.
- Provider cost and margin are hidden from the normal customer-facing usage summary,
  but shown globally as dev pills next to the text-size and model pills in development.
- Display currency setting controls user-facing monetary display.
- Stored ledger values remain audit-safe in their original currency.
- Currency conversion currently uses placeholder static rates.

Important files:

- `apps/web/src/lib/usage/openai.ts`
- `apps/web/src/lib/usage/queries.ts`
- `apps/web/src/lib/billing/display-currency.ts`
- `apps/web/src/lib/billing/display-currency.test.ts`
- `apps/web/src/app/api/billing/usage/route.ts`
- `apps/web/src/app/settings/usage-ledger-modal.tsx`
- `apps/web/src/app/components/app-frame.tsx`
- `docs/usage-based-billing.md`

### 17. Display Currency Setting

General settings now include display currency.

Current behaviour:

- Stored usage events remain in original currency, generally USD.
- UI can display user-facing money in workspace-selected currency.
- Static placeholder rates are used for now.
- The CSV export includes display and stored charge columns.
- The conversion layer is deliberately isolated so Stripe or another future provider
  can replace it later.

Important files:

- `apps/web/src/lib/billing/display-currency.ts`
- `apps/web/src/lib/workspace/general-settings.ts`
- `apps/web/src/app/settings/page.tsx`

### 18. Dev Pills And Internal Visibility

Global dev controls now include:

- provider cost,
- gross margin,
- text-size control,
- active LLM/model pill.

Provider/margin pills are dev-only and now persist across screens instead of appearing
only on Usage.

Important file:

- `apps/web/src/app/components/app-frame.tsx`

### 19. Tests Added Or Updated

Coverage was added around the newer logic.

Areas with tests include:

- assistant commands and settings tools,
- pronunciation filtering,
- speech helpers,
- inbound email settings and sync,
- reply draft generation,
- document template rendering/revision/settings,
- document PDF rendering,
- document approvals/revisions/history,
- CRM queries,
- OpenAI usage normalization,
- display currency,
- workspace general settings.

Run:

```bash
npm run test
npm run lint
npm run typecheck
```

## What To Test First On The Desktop

Use this order to catch environment issues quickly.

1. Sign in and open Settings.
2. Confirm General shows timezone and display currency.
3. Confirm the global dev pills appear across multiple screens in development.
4. Confirm Voice loads and can start a realtime session.
5. Ask Assistant: "What does lookback mean in email sync?"
6. Ask Assistant: "Can you explain aliases in the pronunciation list?"
7. Connect or reconnect Gmail.
8. Run "Check inbox now" in Settings.
9. Open Inbox and check filtered-out emails.
10. Reply to a skipped email and confirm the Replied pill appears.
11. Promote a skipped email and confirm it becomes CRM work.
12. Open Documents, create a new reusable template, preview it, save it.
13. Create a quote draft from that template.
14. Select a customer with typeahead search.
15. Save the draft and open Print / PDF.
16. Generate a customer approval link.
17. Ask Assistant to summarize quote/document status.
18. Open Settings > Usage and confirm task/model breakdowns and ledger CSV export.

## Known Gaps And Next Logical Builds

These are deliberate gaps, not necessarily bugs.

- Native iOS app is not built yet.
- Email sync is polling, not provider push/watch.
- SMS and real outbound phone calls are not wired.
- Durable generated-PDF storage is not wired; PDFs are generated on demand.
- Drive sync/accounting export/payment collection are not wired.
- Display currency uses placeholder static rates.
- Billing is visibility/export-ready, not Stripe invoice collection yet.
- Document example-file upload is currently reference metadata, not full parsing.
- Template design is still structured HTML/CSS, not a drag-and-drop builder.
- Marketing creative/image generation should be a separate path from transactional quotes.
- Google app verification will be needed before broad customer use.

## Recommended Next Work

Highest leverage next items:

1. Finish production env setup on the desktop and run the full smoke test list above.
2. Apply/verify Supabase migrations against the intended working database.
3. Reconnect Gmail using the stable desktop `INTEGRATION_TOKEN_ENCRYPTION_KEY`.
4. Test inbound email sync with a real inbox and tune classification rules.
5. Add Settings UI for sender rules so "always relevant" and "always ignore" can be reviewed.
6. Add durable generated-document storage in Supabase Storage or Drive.
7. Wire Stripe later for customer billing, but keep payment collection for end-user clients separate until the core workflow is more mature.
8. Start planning the iOS shell around the existing Assistant, Voice, Inbox, CRM, Documents, and Settings boundaries.

## Safety Notes For Future Codex Sessions

- Do not work from `main` unless the feature branch has been merged intentionally.
- Do not commit `.env` files or provider keys.
- Do not paste real secrets into docs.
- Treat `INTEGRATION_TOKEN_ENCRYPTION_KEY` as stable per environment.
- Keep document quote/invoice output deterministic and structured.
- Keep AI-created marketing/visual assets on a separate creative path.
- Keep Assistant actions approval-gated when they send customer-facing communication.
- Update `docs/current-architecture.md` and `docs/assistant-help-manual.md` whenever user-facing behaviour changes.

## Recent Commit Trail

Recent work on the active branch includes:

```text
c8770ae Show internal usage cost pills globally
c6446bc Remove redundant settings section status pills
4bd7be8 Add workspace display currency settings
a94ab3b Add usage ledger CSV export
3bf0eea Tighten usage summary layout
743f79c Polish usage billing and OpenAI metering
34c4602 Track OpenAI usage across assistant workflows
36c0f58 Add quote revision workflow
2f3e24c Add customer quote approval links
f366eff Build assistant document and email workflows
81c9931 Polish assistant help, email sync UX, and tests
f174d5c Add voice, inbox, and email sync foundations
feaa5da Add realtime voice and streamline app loading
```

This file itself should be the newest commit after handover is complete.
