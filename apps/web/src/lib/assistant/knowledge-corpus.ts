export const ASSISTANT_HELP_MANUAL = `
# Kyro Assistant Help Manual

## What Kyro Is

Kyro is a trades-focused CRM and operations assistant. It helps a business capture inbound enquiries, track customers and leads, draft replies, prepare quote drafts, manage documents, and understand what needs attention.

The web app is the current build surface. The product direction is iOS-first, so web screens prove behaviour before it becomes native mobile functionality.

## Assistant Basics

The assistant can answer workspace questions, summarise customers and quote drafts, check connected Gmail or Outlook inboxes, use web search for public/current information when enabled, remember explicit user instructions, answer help questions, and edit a limited set of low-risk workspace settings.

The assistant should not invent CRM records, prices, customer facts, messages, or completed business actions. When it changes a setting, it should say exactly what changed.

## Settings The Assistant Can Edit

The assistant can directly edit safe operational settings: workspace timezone, inbound email sync mode, inbound email daytime poll frequency, quiet-hours enabled state, quiet-hours start/end times, quiet-hours behaviour, missed-mail lookback, fetch cap per sync, and skipped-mail summaries.

The assistant should not directly edit high-risk settings such as outbound sending approvals, email signatures, OAuth connections, billing/metering, provider secrets, or destructive data changes. For those, guide the user to Settings.

## General Settings

General settings hold workspace-wide defaults. Timezone currently lives here because it affects more than one feature. Timezone is used wherever Kyro needs local time, including quiet-hours email polling. Users should enter an IANA timezone such as Australia/Brisbane, America/Denver, or UTC.

## Inbound Email Sync

Inbound email sync lets Kyro read connected Gmail or Outlook mailboxes, classify new inbox messages, and promote business-actionable emails into CRM conversations.

Sync modes: Automatic polling runs scheduled checks according to policy. Manual only stops scheduled checks but still allows user or assistant checks. Paused turns inbound email sync off.

Daytime poll frequency controls how often scheduled polling can run during active hours. Five minutes feels near-live without provider push/webhook infrastructure.

Manual checks and assistant-triggered checks bypass the schedule gate. If the assistant needs fresh email context during a conversation, it can trigger a check even outside the ordinary polling schedule.

## Quiet Hours

Quiet hours reduce provider/API/classifier cost and background activity when the business is usually asleep.

The default behaviour pauses scheduled polling during quiet hours, then resumes on the first scheduled poll after quiet hours end. Manual checks and assistant-triggered checks still work.

Emergency or after-hours businesses can keep the same polling interval overnight by changing quiet-hours behaviour to same as daytime.

## Filtering And Sync Limits

Action rules for CRM promotion tell Kyro which emails should become CRM work. Business-actionable messages are promoted into contacts, leads, conversations, messages, and AI triage. Personal messages, newsletters, spam, low-value FYI messages, and automated noise should stay out unless they clearly affect the business.

Missed-mail lookback is how many days back Kyro asks Gmail or Outlook to search each time it syncs. It catches messages after downtime or reconnecting an account. Duplicate provider messages are skipped.

Fetch cap per sync is the maximum number of inbox messages Kyro asks each connected provider for in one sync run. It limits provider/API work and AI classifier cost.

Skipped-mail summaries are optional human-readable summaries for emails Kyro decides not to action. Kyro always records a minimal provider event so it will not reprocess duplicates; the summary helps the assistant understand that something arrived without creating a CRM conversation.

Inbox has a separate filtered-out email pop-up for skipped mail. It is not one of the normal work-queue filters because skipped mail has not become CRM work. The trigger shows how many filtered-out emails were observed in the last 24 hours, and the heavier recent-email list only loads when the pop-up opens. Users can skim recent emails Kyro noticed but did not promote. Each skipped email can be replied to manually, or the user can open Reply, use Generate with AI, add a quick instruction, and review the generated draft before sending. Replies sent from this panel show a Kyro Replied indicator later, based only on Kyro's internal reply log.

## Voice And Pronunciation

Voice mode is intended to feel like the same assistant as the chat window. The assistant should preserve context across text and voice as much as possible.

OpenAI powers Kyro voice. Users can choose the assistant's OpenAI voice in Voice settings, but they do not choose the underlying speech provider.

Pronunciation vocabulary lets users teach Kyro names, suburbs, business terms, acronyms, and other words that should be spoken carefully. Kyro can also auto-add likely difficult terms in the background with a best-effort "say it like" hint. New auto-added entries can run a quick LLM pass to suggest aliases such as related spellings, nicknames, abbreviations, or speech-to-text mishearings. Aliases help Kyro match and understand related terms; they do not replace the words Kyro says aloud. These entries do not need user approval before Kyro can use them; users can edit, remove, or correct the hint/aliases if Kyro gets something wrong. Users can also ask the assistant in chat or voice, for example: "pronounce Woolloongabba as wuh-lun-gabba."

Background pronunciation learning uses a lightweight heuristic to decide which new terms deserve entries, then an optional bounded LLM step to enrich aliases. It is intentionally conservative: ordinary capitalized words from normal sentences should not become entries just because they were capitalized in a transcript.

Pronunciation previews use Kyro's saved live OpenAI voice where possible. The preview speaks only the target word or phrase. The phonetic "say it like" hint is sent as private guidance; separators such as hyphens are treated as syllable cues, not text to read aloud.

## Connected Accounts

Google Workspace and Microsoft Outlook can be connected for email sending and inbound email reading. Accounts may need to reconnect if they were connected before read scopes were added.

Users can disconnect an account in Settings. Disconnecting removes Kyro's stored usable token, marks the connection disconnected, and stops Kyro using that mailbox. To switch accounts or refresh permissions, disconnect if needed and then use the Connect button again.

The assistant can check recent email after accounts are connected, but OAuth connection setup remains a Settings flow.

## Usage And Cost

Usage settings show provider/API cost and metering. Quiet hours, fetch caps, and skipped-mail summary settings help control unnecessary background work.
`;

export const CURRENT_ARCHITECTURE_ASSISTANT_SUMMARY = `
# Current Architecture Summary

## Project Shape

Kyro is a TypeScript monorepo. apps/web is the Next.js App Router web app. Supabase Auth handles sessions and Supabase Postgres is the source of truth. Drizzle owns schema and migration generation. Server Components read workspace data. Server Actions mutate data and revalidate/redirect.

## Assistant Architecture

The Assistant page and realtime voice use the same assistant command router where possible. Text assistant turns run through apps/web/src/lib/assistant/engine.ts, commands.ts, and providers.ts. Realtime voice exposes kyro_context_lookup through apps/web/src/app/api/assistant/realtime/tool/route.ts, so voice can use the same CRM, help, email sync, and safe settings command paths.

Assistant-facing help uses a user-facing manual plus architecture snippets. The command router selects relevant snippets for app-help questions instead of stuffing every document into every prompt.

Assistant settings edits go through apps/web/src/lib/assistant/settings-tools.ts. The allowlist intentionally starts with low-risk operational settings only. Outbound approval policy, signatures, OAuth connections, billing/metering, provider secrets, and destructive data changes remain Settings UI flows.

Settings can disconnect Google Workspace or Microsoft Outlook accounts without deleting provider history. Disconnect clears Kyro's stored token payload, marks the connection disconnected, deactivates the tied email channel, and leaves reconnection to the normal OAuth flow.

## Settings Architecture

Workspace settings are stored in workspace_policies. Communication settings use policy type communication_outbound. Inbound email and general workspace timezone currently use policy type inbound_email. Voice settings use policy type assistant_voice.

Settings sections are URL-addressable and fetch data on demand for the selected section so Settings remains a clean future API/native-screen boundary.

## Inbound Email Architecture

Inbound email sync reads connected Gmail or Outlook mailboxes, writes idempotent events before processing, classifies new messages, promotes actionable business mail into CRM conversations, and records skipped mail as processed events with optional summaries.

Scheduled polling can call POST /api/integrations/email/sync frequently, such as every five minutes. The worker still respects each workspace policy, including quiet-hours rules. Manual Settings checks and assistant-triggered checks bypass the schedule gate.
`;
