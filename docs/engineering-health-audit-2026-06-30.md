# Engineering Health Audit - 2026-06-30

## Verdict

Kyro is not fundamentally spaghetti code. The system has a sensible product
architecture for where it is headed:

- Next.js App Router owns the web/product surfaces.
- Supabase Auth/Postgres remains the source of truth.
- Workspace-scoped access is consistently treated as the core tenant boundary.
- Integration-heavy behaviour is mostly isolated under `apps/web/src/lib`.
- Shared packages hold schema, contracts, and early backend service seams.

The codebase is, however, carrying late-build complexity in a few large files.
That is the main risk now: not that the app is incorrectly structured, but that
some mature product surfaces grew faster than their module boundaries.

## What Was Tightened In This Pass

- Added a shared HTTP request-secret helper for cron, push, billing, lifecycle,
  outbox, and recording-retention endpoints.
- Moved those protected routes to the same secret extraction and constant-time
  comparison behaviour.
- Moved the Assistant prompt-suggestions API onto the existing shared API
  workspace context instead of keeping a second bearer-or-cookie Supabase path.
- Reused the shared bearer-token parser for web API and mobile API contexts.
- Removed literal public placeholder copy from the About page.
- Removed customer-visible placeholder wording from Dashboard calendar/payment
  widget labels.

## Current Hotspots

These files are the places most likely to slow future work or hide regressions:

- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/app/settings/actions.ts`
- `apps/web/src/lib/assistant/commands.ts`
- `apps/web/src/app/assistant/assistant-console.tsx`
- `apps/web/src/lib/crm/queries.ts`
- `apps/web/src/lib/integrations/inbound-email-sync.ts`
- `apps/web/src/lib/voice/calls.ts`
- `apps/web/src/app/inbox/actions.ts`
- `apps/web/src/app/voice-vapi/vapi-voice-console.tsx`
- `apps/web/src/lib/communication/outbound.ts`

They are not all bad files. They are simply too important and too large to keep
expanding indefinitely.

## Recommended Refactor Order

1. Split `settings/page.tsx` by section into server section components and keep
   `settings/page.tsx` as orchestration only.
2. Split `assistant/commands.ts` into command families: CRM, files/documents,
   communications, settings, media, and diagnostics.
3. Split `assistant-console.tsx` into chat shell, composer, activity panel,
   attachment/media modal, message rendering, and suggestion controls.
4. Split `crm/queries.ts` into list queries, profile queries, document/payment
   joins, and shared row mappers.
5. Split `inbound-email-sync.ts` into provider fetchers, classification,
   thread/contact matching, attachment persistence, and sync orchestration.
6. Split `voice/calls.ts` into provider event parsing, call lifecycle,
   voicemail overflow, recordings retention, and activity mapping.

## Efficiency Notes

- The app already avoids the worst performance trap: it does not preload every
  heavy route or every old thread/file/ledger row.
- Settings now mostly loads selected sections rather than every panel.
- Route preloading and intent-prefetching are appropriate for the current app.
- The biggest efficiency gains left are module-level and query-level, not a
  framework rewrite.

## Production Risks To Keep Watching

- Public UI must not expose provider/internal names unless it is in developer
  mode.
- Protected worker/webhook endpoints should continue using shared secret helpers.
- Any new Supabase table or storage path needs RLS/storage policy review.
- Any new side effect should run through outbox/action/audit patterns where
  possible.
- Placeholder copy should not ship on public or normal-user surfaces.
- Large files should be split before adding major new behaviour to them.
