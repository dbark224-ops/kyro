# Database Setup

Kyro uses Supabase Postgres with Drizzle as the TypeScript schema and migration tool.

## Files

- `packages/db/src/schema.ts`: Drizzle schema.
- `packages/db/src/client.ts`: Postgres client factory.
- `drizzle.config.ts`: Drizzle migration config.
- `supabase/migrations`: generated SQL migrations and Drizzle migration metadata.

## Environment

Set `DATABASE_URL` in `.env` before applying migrations.

For Supabase, use a direct Postgres connection string for migrations. Runtime clients should
use Supabase Auth/session context from the API layer where appropriate.

## Commands

```bash
npm run db:generate -- --name migration_name
npm run db:generate:custom -- --name custom_migration_name
npm run db:check
npm run db:migrate
npm run db:studio
```

## Current Migration Shape

The applied migrations currently create:

- Tenant/auth tables.
- Workspace policies and entitlements.
- Contacts, leads, contact lifecycle fields, channels, workspace phone numbers, conversations, messages, conversation tasks/appointments/notes, outbound delivery rows, Vapi/Twilio voice-call ledgers, quote drafts, generated documents, inquiry facts, Assistant memory tables, and files.
- Events, workflow runs, actions, AI runs, model routes, and audit logs.
- Usage events, usage rollups, pricing rules, and workspace budgets.
- Contact profile fields for contact type and address are added by a follow-up migration.

The RLS migration adds:

- `auth.users` linkage for `public.users`.
- Workspace membership helper functions.
- Updated-at triggers.
- Tenant-scoped RLS policies.
- Append-only policies for `audit_logs` and `usage_events`.

The service role will still be used for trusted backend workflows that need to bypass RLS,
but RLS remains the database-level safety net for user/session-scoped operations.

## Current Migration Notes

- `20260509053308_initial_core.sql`: base schema.
- `20260509053320_tenant_rls.sql`: RLS policies, workspace membership helpers, and updated-at triggers.
- `20260510044752_contact_profile_fields.sql`: adds `contacts.contact_type`, `contacts.address`, and a workspace/type index.
- `20260510061122_quote_drafts.sql`: adds internal saved quote drafts linked to contacts, leads, conversations, and source actions.
- `20260510073116_inquiry_facts.sql`: adds editable extracted inquiry facts with one current row per workspace/conversation.
- `20260512191555_assistant_memory.sql`: adds Assistant threads, messages, explicit memories, RLS policies, and updated-at triggers.
- `20260513200620_google_integrations.sql`: adds Google/Microsoft OAuth connection storage and token-state metadata.
- `20260517163000_security_perf_hardening.sql`: adds performance and security indexes/policies for the current Supabase schema.
- `20260518175710_pronunciation_vocabulary.sql`: adds assistant pronunciation vocabulary records.
- `20260522001249_event_skipped_email_indexes.sql`: adds skipped-email event indexes for filtered-out email review.
- `20260524194856_quote_approval_links.sql`: adds tokenized customer quote approval links with workspace RLS policies.
- `20260525143000_outbound_messages.sql`: adds the durable outbound delivery queue/ledger with workspace RLS, idempotency, retry scheduling, provider ids, and updated-at trigger.
- `20260527005033_generated_documents.sql`: adds first-class generated quote/invoice PDF records linked to private file storage, CRM/conversation/quote context, outbound sent messages, and Google Drive filing metadata.
- `20260526020904_contact_identity_normalization.sql`: adds normalized contact email, phone, and company fields, workspace-scoped indexes, backfill SQL, and the trigger that keeps identity fields in sync on contact edits.
- `20260526022516_international_phone_identity_normalization.sql`: upgrades the database phone normalizer and backfills contact phone identities into canonical international-style values for explicit country-coded numbers and common local formats.
- `20260526044245_contact_lifecycle_fields.sql`: adds contact lifecycle stage/source/reason/review timestamp fields and a workspace lifecycle index. These fields support manual lead/client switching plus scheduled review suggestions without changing `contact_type`.
- `20260526071536_contact_profile_resolution.sql`: adds profile-resolution status/reason/conflict/merge fields to `contacts`, indexes active review and merged-source lookups, and updates the identity trigger so app-side default-phone-region normalization is preserved.
- `20260526155526_fixed_arclight.sql`: adds `conversation_tasks`, `conversation_appointments`, and `conversation_notes` with workspace RLS, updated-at triggers, and indexes for conversation/message/status lookups.
- `20260527024424_structured_addresses.sql`: adds structured Google/manual address fields to `contacts` and `inquiry_facts`, including line/locality/postal/country/coordinate/place-id fields, validation status, raw structured JSON, and workspace indexes for place/postal lookups.
- `20260529021344_twilio_sms_foundation.sql`: adds `workspace_phone_numbers` for Twilio SMS/voice-capable numbers, workspace RLS, indexes, capability metadata, provider ids, and updated-at trigger support.
- `20260529043000_vapi_voice_calls.sql`: adds `voice_calls` and `voice_call_events` for Vapi/Twilio inbound calls, voicemail overflow, user-to-Kyro calls, outbound customer calls, transcripts, recordings, provider status, cost snapshots, raw event audit, and workspace RLS.

CRM profile identity now uses normalized email, normalized phone, and normalized company values. App code normalizes bare local phone numbers with the workspace default phone region before falling back through broader international parsing. Explicit country-coded numbers remain country-safe.

Address identity now keeps the typed/display address in `address` while storing
structured components beside it. Google Places selections can populate a place id,
postal components, coordinates, validation status, and structured JSON; manually
typed addresses remain accepted and are marked as manual/unverified rather than
blocking the workflow.

CRM lifecycle and profile resolution are contact-level concepts:

- lifecycle fields track whether the relationship is currently a lead or client, separately from contact category,
- lifecycle review creates `review_lifecycle_stage` actions rather than silently changing profiles, and users can clear manual lifecycle overrides when they want automated suggestions again,
- profile conflicts and duplicate identity signals can create review work in CRM,
- merging profiles moves linked conversations, messages, leads, inquiry facts, quote drafts, and contact-targeted actions to the kept profile,
- merged source profiles stay in `contacts` with `merged_into_contact_id` so audit history remains traceable while the normal CRM list hides archived merged sources.

Inbox workflow state now has durable rows:

- `conversation_tasks` stores user-created tasks, automatic `customer_follow_up` reminders, site-visit tasks, and message-resolution markers linked to conversations/messages/actions,
- `conversation_appointments` stores site-visit/appointment records before any external calendar provider is connected,
- `conversation_notes` stores internal-only operator notes linked to conversations or individual messages.

Twilio SMS now has a first database foundation:

- `workspace_phone_numbers` stores active/pending/released Twilio numbers per workspace,
- inbound SMS webhooks match the Twilio destination number against this table,
- inbound and outbound SMS usage is recorded in `usage_events`,
- outbound SMS delivery still uses the existing `outbound_messages` queue/ledger.

Vapi/Twilio voice now has a first database foundation:

- `voice_calls` stores call direction, purpose, provider ids, Twilio/Vapi numbers,
  matched contact/conversation/lead ids, transcript, summary, recording URL,
  status, duration, provider cost, customer charge, and metadata,
- `voice_call_events` stores raw Vapi webhook and tool payloads for audit and
  debugging,
- completed calls can write `usage_events` rows with `usage_type = voice_call`,
- Assistant Kyro activity and the mobile app both load call details through
  `/api/voice/calls/[callId]` rather than querying these tables directly.

Assistant memory/thread behavior does not currently need a new migration.
`assistant_threads.status` is used for active versus archived threads, and
`assistant_memories.status` is used for active, pending-approval, and rejected
memories. Suggested memories are stored as pending rows and only become active
context after the user approves them.

Document template preferences do not currently need a new migration. The web app stores
the first quote-output settings in `workspace_policies` with policy type
`document_templates`; quote output is rendered from existing `quote_drafts` data as
print-ready HTML or an on-demand server-generated PDF. Generated quote and invoice
PDFs are now promoted into `generated_documents` rows backed by private
Supabase Storage/files rows, while lightweight timeline metadata remains in
`quote_drafts.metadata` and outbound `messages.metadata`. Outbound sends are also
tracked in `outbound_messages`: the outbox row is created before provider
delivery, stores retryable attachment references to private Supabase Storage/files
rows, and links back to either the final conversation `messages` row or
event-only delivery record through metadata once recording succeeds.
`quote_drafts.metadata.documentHistory` is the current lightweight version trail
for generated/prepared/sent PDFs and customer approval events. Quote revision
state is also metadata-backed in `quote_drafts.metadata.quoteRevision`: the app
tracks the active quote version, pending/resolved customer change requests, and
prepared/sent/approved versions without a new migration. Customer approval links
use `quote_approval_links`: raw tokens stay in customer URLs, while the database
stores only `token_hash`, status, expiry, view/approval timestamps, and
change-request text.

Assistant image generation does not currently need a new migration. Uploaded
assistant reference files and generated image outputs both use the existing
`files` table plus private Supabase Storage, with `source` values such as
`assistant_upload` and `generated_image`. The tool execution is recorded in
`ai_runs`, image spend is recorded in `usage_events` with `usage_type =
image_generation`, and the generated file is linked through audit logs.
