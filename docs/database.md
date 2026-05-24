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
- Contacts, leads, channels, conversations, messages, quote drafts, inquiry facts, Assistant memory tables, and files.
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

Document template preferences do not currently need a new migration. The web app stores
the first quote-output settings in `workspace_policies` with policy type
`document_templates`; quote output is rendered from existing `quote_drafts` data as
print-ready HTML or an on-demand server-generated PDF. Generated PDF metadata is
stored in existing `quote_drafts.metadata` and outbound `messages.metadata`.
`quote_drafts.metadata.documentHistory` is the current lightweight version trail
for generated/prepared/sent PDFs and customer approval events. Quote revision
state is also metadata-backed in `quote_drafts.metadata.quoteRevision`: the app
tracks the active quote version, pending/resolved customer change requests, and
prepared/sent/approved versions without a new migration. Customer approval links
use `quote_approval_links`: raw tokens stay in customer URLs, while the database
stores only `token_hash`, status, expiry, view/approval timestamps, and
change-request text. Durable binary file storage will need a future migration/storage policy.
