# Product Backlog

This is the parking lot for useful ideas that should not pull us away from the current goal: make mock ingested inquiries flow cleanly through profiles, AI triage, actions, and usage metering before we add real channels.

## CRM Identity

- Add normalized identity fields for contacts, such as `normalized_email` and `normalized_phone`, with workspace-scoped indexes.
- Add a profile match review queue for cases where email and phone point at different existing profiles.
- Add a merge flow so the user can attach a new inquiry profile to an existing contact without losing audit history.
- Add duplicate detection beyond exact matches, including likely phone formatting variants and alternate emails.
- Show visual warnings when a phone number appears on multiple profiles.

## CRM Lifecycle

- Define concrete rules for when a profile should move from lead to client once communication and billing flows are more complete.
- Keep a manual lead/client switch in the profile editor so the user can override lifecycle status at any time.
- Let the LLM periodically review workspace records and suggest lifecycle/status cleanup, such as leads that should become clients or stale profiles that need attention, with clear audit history for any automated or user-approved changes.

## Addresses

- Use Google address verification/autocomplete for address inputs before storing contact or job-site addresses.
- Store both the human-readable address and structured address components so future scheduling, maps, routing, and service-area checks are reliable.

## Inbox Actions

- Add per-message actions after the inbox model is stable: draft reply, approve reply, assign task, mark resolved, convert to quote.
- Add richer per-message controls inside the existing conversation review pages.
- Add saved task/appointment objects once the action cards need more durable scheduling state.

## Follow-Up Reminders

- Add a workspace setting for automatic customer follow-up reminders after an outbound reply is recorded, defaulting to two days.
- Surface follow-up due states in lead/inbox lists after the configured delay passes, instead of proposing immediate `schedule_follow_up` approval actions in the reply screen.
- Let users change the default follow-up delay globally and eventually override it per inquiry.
- Keep follow-up reminders as internal CRM reminders first; only add external calendar/task integrations after the internal due-state model is reliable.

## Outbound Communication Style

- Add workspace/user customization for outbound customer prompts, including tone, wording style, message length, sign-off, and trade-specific phrasing.
- Let users store reusable reply instructions that the AI must apply when drafting email/SMS replies.

## Voice and Vocabulary

- Add a workspace vocabulary/pronunciation list for voice transcription and assistant prompts, including the product name, business name, staff names, customer names, supplier names, suburbs, streets, product brands, trade terms, and common acronyms.
- Let users add and edit vocabulary items in Settings, with optional pronunciation hints and notes about whether the term is a person, place, supplier, product, or internal nickname.
- Feed the relevant vocabulary into speech-to-text prompts and assistant turns so voice input handles names and local terminology reliably.

## Assistant Memory and Tools

- Add automatic memory suggestions for user approval after the explicit `remember...` flow proves reliable.
- Add more known UI block types: contact summary, quote table, usage summary, approval queue, and timeline.
- Add approval-gated external tools for email, SMS, phone, and calendar only after the internal tool registry is stable.
- Add thread switching and archived Assistant threads once there is more than one useful working thread.

## Future Channels

- Add Gmail inbound sync after outbound email has been tested against real customer-style conversations.
- Add Outlook inbound sync after outbound email has been tested against real customer-style conversations.
- Add SMS, social DMs, and web chat only after email send/receive behavior and permission boundaries feel solid.
