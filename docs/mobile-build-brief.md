# Kyro Mobile Build Brief

This brief is the handover file for a second Codex chat working on the Kyro iOS/Android app in parallel with the web app. Read this file first, then read:

- `docs/current-architecture.md`
- `docs/assistant-help-manual.md`
- `docs/data-model.md`
- `docs/deployment-checklist.md`
- `docs/product-backlog.md`

## Worktree And Branch Rules

The mobile chat must work in a separate git worktree so it does not collide with the web app chat.

Desktop web worktree:

```text
C:\Users\David\Documents\New project\kyro
```

Mobile worktree:

```text
C:\Users\David\Documents\New project\kyro-mobile
```

Mobile branch:

```text
codex/mobile-app
```

Before changing anything, the mobile chat should run:

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

Expected branch is `codex/mobile-app`. If it is not on that branch, stop and ask before editing.

The mobile chat should keep edits scoped to mobile-specific files, likely under `apps/mobile`, plus any explicitly requested shared packages or docs. It should not edit the web UI under `apps/web` unless the user explicitly asks it to add a backend API route or shared contract needed by mobile.

The current web worktree may contain uncommitted web-app changes. Do not try to merge, reset, stash, or overwrite them from the mobile worktree. Once the web thread commits and pushes its latest work, the mobile branch can merge or rebase from the updated web branch deliberately.

## Product Direction

Kyro is a CRM and operations assistant for trade and service businesses. The web app is proving the product workflow; the mobile app should become the primary daily-driver experience for iOS first, with Android support kept viable from the start.

The mobile app should feel like:

- a fast business command centre,
- a CRM inbox,
- an assistant-first operations app,
- a clean trades/service workflow tool, not a generic chatbot shell.

The web app remains important for settings, billing, deeper administration, and desktop workflows. Mobile should prioritise the everyday field-user flows.

## Recommended Mobile Stack

Use React Native with Expo and TypeScript unless the user explicitly changes direction. This gives one codebase for iOS and Android, fast iteration, camera/file/microphone support, push notifications later, and a practical route to native builds.

Recommended location:

```text
apps/mobile
```

Recommended first dependencies:

- Expo
- React Native
- TypeScript
- Expo Router
- Supabase JS client for auth/session handling
- TanStack Query or a similarly boring cache layer
- SecureStore or equivalent for local tokens/preferences
- a small typed API client for Kyro backend routes

Do not overbuild native modules at the start. Prefer Expo-supported APIs until there is a clear product reason to eject or add custom native code.

## Backend Boundary

Do not put service-role secrets in the mobile app. Mobile should never own privileged database writes.

The likely production boundary is:

- mobile uses Supabase Auth for session identity,
- mobile calls Kyro backend API routes for complex actions,
- backend validates the user, workspace membership, permissions, and policy,
- backend performs privileged CRM/outbox/document/assistant actions,
- mobile can use direct Supabase client reads only where RLS and table access are intentionally designed for it.

For the first mobile scaffold, prefer a typed API-client layer even if some endpoints are not complete yet. Keep mock fallback data clearly isolated so it can be removed.

## Mobile MVP Screens

Build in this order unless the user redirects:

1. Auth
   - Sign in/out with the existing Supabase project.
   - Preserve sessions securely.
   - Show a clear signed-out state.

2. App Shell
   - Assistant-first home screen.
   - Bottom navigation for Assistant, Inbox, CRM, Settings.
   - Keep Documents/Log/Developer out of the first mobile nav unless needed.

3. Assistant
   - Text assistant UI first.
   - Voice controls later, reusing the same assistant/backend architecture.
   - Support UI cards for work queue, contact previews, quote/document cards, approval queues, outbound-call request cards, generated-image cards, and account/status cards.
   - Do not let the model invent arbitrary UI. Use known block types.
   - When Assistant returns an `outbound_call_request` block, render a compact review card with recipient, phone number, call instructions, and a Confirm action that posts the same payload to `POST /api/voice/outbound`. Preserve the optional hidden `contextSummary` field so outbound Vapi calls know the recent Assistant situation and previous-call context.

4. Inbox
   - Work queue list.
   - Conversation detail screen.
   - Manual reply form.
   - Generated reply preview/edit/send path.
   - Internal notes, tasks, resolved state, and follow-up due states when the backend exposes them.

5. CRM
   - Search contacts/leads.
   - Contact profile detail.
   - Basic edit surface.
   - Duplicate/profile-resolution warnings when surfaced by backend data.

6. Settings
   - Account connection status.
   - Voice preference display/edit if endpoint exists.
   - Basic workspace defaults needed by mobile.
   - Leave heavy billing/admin settings to web initially.

## Design Direction

Use the existing Kyro brand language:

- Manrope font where practical.
- Dark-first UI.
- Cyan/purple/pink accent system.
- Assistant gets primary visual emphasis.
- Keep interfaces dense enough for work but calm enough for daily use.

Mobile should not copy desktop split panes. Use native-feeling navigation:

- list screen to detail screen,
- bottom sheets for lightweight actions,
- full-screen flows for composing replies and reviewing quotes,
- clear back navigation,
- sticky composer/action bars where useful.

Avoid huge marketing sections, decorative cards, and anything that feels like a landing page.

## Data And Features Already Proven In Web

The mobile chat should assume these product concepts exist or are being built in web:

- workspaces and workspace members,
- contacts, leads, conversations, and messages,
- normalized email/phone identity,
- duplicate/profile-resolution workflow,
- contact lifecycle lead/client suggestions,
- inbound email sync and skipped-email review,
- durable outbox delivery,
- generated quote/invoice document records,
- Google Drive filing for approved generated documents,
- assistant memory, tool registry, and UI cards,
- Google address autocomplete/structured address storage,
- follow-up reminders and task/appointment objects,
- usage metering and billing calculations, but no live payment integration yet.

If a mobile feature needs a missing API, add a small typed interface and document the backend route needed rather than hacking around the data model.

## First Mobile Build Task

The other Codex chat should start by scaffolding `apps/mobile` and proving:

- the app boots in Expo,
- TypeScript compiles,
- the Kyro brand shell renders,
- auth/session plumbing is structurally ready,
- navigation exists for Assistant, Inbox, CRM, and Settings,
- all mobile-specific instructions are documented in `apps/mobile/README.md`.

Do not attempt to recreate every web feature in the first pass. Build the foundation so later screens can wire into the real backend cleanly.

## Useful Prompt For The Other Chat

Paste this into the new Codex chat:

```text
You are working on Kyro mobile in the separate worktree at:
C:\Users\David\Documents\New project\kyro-mobile

Before editing, read docs/mobile-build-brief.md, docs/current-architecture.md, docs/assistant-help-manual.md, docs/data-model.md, and docs/deployment-checklist.md.

Confirm you are on branch codex/mobile-app. Keep mobile work under apps/mobile unless a small shared contract or backend API route is explicitly needed. Do not edit or reset the desktop web worktree.

First task: scaffold the iOS/Android mobile app using Expo React Native with TypeScript, create the Kyro app shell, bottom navigation for Assistant/Inbox/CRM/Settings, placeholder screens that follow the current design language, auth/session structure ready for Supabase, and an apps/mobile/README.md explaining how to run it.
```
