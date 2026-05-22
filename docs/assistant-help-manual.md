# Kyro Assistant Help Manual

This manual is the user-facing help source for Kyro. The assistant can use it to answer questions about what the app does, how settings work, and which actions it can safely perform.

## What Kyro Is

Kyro is a trades-focused CRM and operations assistant. It helps a business capture inbound enquiries, keep track of customers and leads, draft replies, prepare quote drafts, manage documents, and understand what needs attention.

The web app is the current build surface. The product direction is iOS-first, so web screens should be treated as the place where behaviour is proven before it becomes native mobile functionality.

## Assistant Basics

The assistant can:

- answer questions about the workspace,
- summarise customers, contacts, quote drafts, and active conversations,
- check connected Gmail or Outlook inboxes on request,
- use web search for public/current information when enabled,
- remember explicit user instructions when the user says to remember or note something,
- answer help questions using this manual and the architecture notes,
- edit a limited set of low-risk workspace settings when the user asks clearly.

The assistant should not invent CRM records, prices, customer facts, messages, or completed business actions. When it changes a setting, it should say exactly what changed.

## Help And Documentation

When users ask how Kyro works, what a screen means, or why a setting exists, answer from the manual first. The architecture document can support deeper product/technical answers, but the assistant should translate internal details into plain user-facing language.

If the user asks a build/product question, it is okay to explain the current architecture. If the user asks as an ordinary end user, avoid unnecessary implementation detail.

## Settings The Assistant Can Edit

The assistant can directly edit safe operational settings:

- workspace timezone,
- inbound email sync mode,
- inbound email daytime poll frequency,
- quiet-hours enabled/disabled state,
- quiet-hours start and end times,
- quiet-hours behaviour,
- missed-mail lookback,
- fetch cap per sync,
- skipped-mail summaries.

The assistant should not directly edit high-risk settings such as outbound sending approvals, email signatures, OAuth connections, billing/metering, provider secrets, or destructive data changes. For those, guide the user to Settings.

## General Settings

General settings hold workspace-wide defaults. Timezone currently lives here because it affects more than one feature.

Timezone is used wherever Kyro needs local time, including quiet-hours email polling. Users should enter an IANA timezone such as `Australia/Brisbane`, `America/Denver`, or `UTC`.

## Inbound Email Sync

Inbound email sync lets Kyro read connected Gmail or Outlook mailboxes, classify new inbox messages, and promote business-actionable emails into CRM conversations.

Sync modes:

- Automatic polling: scheduled checks run according to the workspace policy.
- Manual only: scheduled checks stop, but the user or assistant can still manually check inboxes.
- Paused: inbound email sync is off.

Daytime poll frequency controls how often scheduled polling can run during active hours. Five minutes feels near-live without the extra complexity of provider push/webhook infrastructure.

Manual checks and assistant-triggered checks bypass the schedule gate. That means if the assistant needs fresh email context during a conversation, it can trigger a check even outside the ordinary polling schedule.

## Quiet Hours

Quiet hours reduce provider/API/classifier cost and background activity during times when the business is usually asleep.

The default behaviour is to pause scheduled polling during quiet hours, then resume on the first scheduled poll after quiet hours end. Manual checks and assistant-triggered checks still work.

Emergency or after-hours businesses can keep the same polling interval overnight by changing quiet-hours behaviour to same as daytime.

## Filtering And Sync Limits

Action rules for CRM promotion tell Kyro which emails should become CRM work. Business-actionable messages are promoted into contacts, leads, conversations, messages, and AI triage. Personal messages, newsletters, spam, low-value FYI messages, and automated noise should stay out unless they clearly affect the business.

Missed-mail lookback is how many days back Kyro asks Gmail or Outlook to search each time it syncs. It helps catch messages after downtime or reconnecting an account. Duplicate provider messages are skipped.

Fetch cap per sync is the maximum number of inbox messages Kyro asks each connected provider for in one sync run. It limits provider/API work and AI classifier cost.

Skipped-mail summaries are optional human-readable summaries for emails Kyro decides not to action. Kyro always records a minimal provider event so it will not reprocess duplicates; the summary just helps the assistant understand that something arrived without creating a CRM conversation.

Inbox has a separate filtered-out email pop-up for skipped mail. It is not one of the normal work-queue filters because skipped mail has not become CRM work. The trigger shows how many filtered-out emails were observed in the last 24 hours, and the heavier recent-email list only loads when the pop-up opens. Users can skim recent emails Kyro noticed but did not promote. Each skipped email can be replied to manually, or the user can open Reply, use Generate with AI, add a quick instruction, and review the generated draft before sending. Replies sent from this panel show a Kyro `Replied` indicator later, based only on Kyro's internal reply log.

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

The assistant can explain usage concepts, but billing/payment settings should remain user-controlled in the Settings UI.
