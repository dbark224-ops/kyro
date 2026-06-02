# Vapi Voice Agent Integration

Kyro's phone-call layer is designed as shared backend infrastructure for the web
app and the mobile app. The UI can change, but both clients should call the same
authenticated routes and render the same preview payloads.

## Provider Roles

- Twilio owns phone numbers, carrier delivery, voicemail forwarding targets, and
  number capability/rental costs.
- Vapi owns the live AI phone runtime for inbound calls, voicemail overflow, and
  outbound customer calls.
- Kyro owns workspace scoping, CRM lookup, audit history, call records,
  transcript/recording display, usage metering, and user permission boundaries.

The intended production shape is: a workspace chooses a voice+SMS-capable Twilio
number, that number is connected to Vapi, and Vapi calls Kyro webhooks/tools with
workspace metadata.

## Environment

Required before real calls:

- `VAPI_API_KEY`
- `VAPI_WEBHOOK_SECRET`
- `VAPI_TOOL_SECRET`

Outbound calls also need at least one Vapi phone-number id. The preferred
production path is to attach a Vapi phone-number id to each active
`workspace_phone_numbers` row in `metadata.vapiPhoneNumberId`. `VAPI_PHONE_NUMBER_ID`
is only a fallback when the workspace has not yet mapped individual AU/US numbers.

Required before the browser/mobile Vapi internal voice tab can start:

- `NEXT_PUBLIC_VAPI_PUBLIC_KEY`
- `VAPI_INTERNAL_ASSISTANT_ID` or the same value saved in Settings -> Voice

Optional env defaults when a workspace has not saved ids in Settings:

- `VAPI_DEFAULT_ASSISTANT_ID`
- `VAPI_INTERNAL_ASSISTANT_ID`
- `VAPI_INBOUND_ASSISTANT_ID`
- `VAPI_VOICEMAIL_OVERFLOW_ASSISTANT_ID`
- `VAPI_OUTBOUND_ASSISTANT_ID`
- `VAPI_ENABLE_TRANSCRIBER_OVERRIDE` defaults to `false`
- `VAPI_INTERNAL_TRANSCRIBER_PROVIDER` is only used when the override is enabled
- `VAPI_INTERNAL_TRANSCRIBER_MODEL` is only used when the override is enabled
- `VAPI_INTERNAL_TRANSCRIBER_LANGUAGE` is only used when the override is enabled

Vapi webhook/tool URLs need `NEXT_PUBLIC_APP_URL` to be a public HTTPS URL in
production. Local browser testing can show the routes, but Vapi needs a reachable
URL such as a deployed preview or tunnel.

The public key is safe to expose to the browser. Private Vapi API keys and Kyro
tool/webhook secrets stay server-side only.

## Settings

Settings -> Voice stores:

- whether phone assistant infrastructure is enabled,
- the internal Vapi assistant id used by the `/voice-vapi` browser/mobile test
  surface,
- which call purposes are enabled: inbound customer, voicemail overflow, outbound,
- fallback Vapi phone-number id for workspaces that have not mapped per-number
  Vapi ids yet,
- Vapi assistant ids for inbound, voicemail overflow, and outbound,
- user/team phone numbers that should be treated as internal callers,
- broad call style settings: call style, detail level, warmth, and escalation
  behaviour.

These settings are saved in the existing `assistant_voice` workspace policy.

## Database Tables

`voice_calls` is the durable call ledger. It stores workspace/contact/conversation
links, Vapi/Twilio ids, direction, purpose, status, numbers, transcript, summary,
recording URL, cost snapshots, and metadata.

`voice_call_events` stores raw Vapi webhook/tool payloads for debugging and audit.
The UI should show compact summaries, not raw provider JSON, unless it is an
internal developer surface.

`workspace_phone_numbers` can hold multiple Twilio numbers for one workspace,
for example one Australian number and one US/North-American number. Twilio ids
remain in `provider_phone_number_id`; the Vapi connected phone-number id belongs
in `metadata.vapiPhoneNumberId` (or `metadata.vapi.phoneNumberId`). Outbound
voice routing chooses the active voice-capable workspace number whose country
matches the customer's E.164 destination number, then falls back to the first
active mapped voice number, then finally to the Settings/env fallback id.

## Backend Routes

`POST /api/integrations/vapi/webhook`

- Called by Vapi lifecycle events.
- Verifies `VAPI_WEBHOOK_SECRET` when configured.
- Resolves `workspaceId` from Vapi metadata or the matched Kyro/Twilio number.
- Upserts `voice_calls`.
- Stores raw `voice_call_events`.
- Records voice-call usage on completed calls when provider cost/duration is
  available.

`POST /api/integrations/vapi/tool`

- Called by Vapi tool calls.
- Verifies `VAPI_TOOL_SECRET` or `VAPI_WEBHOOK_SECRET`.
- Current tools:
  - `kyro_lookup_contact`
  - `kyro_update_contact`
  - `kyro_record_call_note`
  - `kyro_context_lookup` / `kyro_assistant_command`
  - `kyro_web_search`
  - `kyro_check_recent_email`
- Returns JSON tool results suitable for Vapi to read back into the call.

`GET /api/assistant/vapi/internal/session`

- Authenticated route used by the web `/voice-vapi` tab and the mobile app.
- Accepts normal web cookies or a mobile Supabase bearer token.
- Returns a Vapi-safe session payload with the public key, internal assistant id,
  assistant overrides, workspace/user/thread metadata, the current Kyro context
  packet, and the latest bounded Assistant thread state.
- Does not return private Vapi API keys, Kyro webhook secrets, or Supabase service
  credentials.

`POST /api/assistant/realtime/persist`

- Shared persistence route for browser realtime voice and Vapi internal voice.
- Vapi internal voice clients send `inputSource: "vapi_internal_voice"` so Kyro
  stores the turn in the main Assistant thread while keeping source metadata clear.

`GET /api/voice/calls/[callId]`

- Authenticated workspace-scoped call preview.
- Used by the web Assistant activity pane.
- The mobile app should use this same route for call detail screens.

`GET /api/assistant/activity?limit=12`

- Authenticated workspace-scoped activity feed for communication outside the
  main Assistant chat.
- Returns the same compact rows the web Assistant Kyro activity pane renders:
  inbound/outbound email/SMS activity, outbox failures, and voice-call rows.
- Accepts either normal web cookies or a mobile Supabase bearer token.

`POST /api/voice/outbound`

- Authenticated route to start a Vapi outbound call.
- Body:

```json
{
  "phoneNumber": "+61400000000",
  "contactId": "optional-contact-id",
  "conversationId": "optional-conversation-id",
  "leadId": "optional-lead-id",
  "instructions": "optional call goal"
}
```

- Creates a queued `voice_calls` row before calling Vapi.
- Selects the outbound Vapi phone number by destination country when workspace
  phone-number metadata contains per-number Vapi ids.
- Updates the row with the Vapi provider call id or marks it failed.

## Vapi Metadata Contract

Pass these metadata fields from Vapi assistants/calls whenever possible:

```json
{
  "workspaceId": "workspace uuid",
  "purpose": "inbound_customer | voicemail_overflow | inbound_user | outbound_customer | test",
  "contactId": "optional contact uuid",
  "conversationId": "optional conversation uuid",
  "leadId": "optional lead uuid"
}
```

For outbound calls, Kyro sets this metadata when it creates the Vapi call. For
inbound/voicemail calls, configure the Vapi assistant/phone number so the
workspace id and purpose are included.

Outbound calls also include a `phoneNumberSelection` metadata object explaining
which workspace number or fallback id was used. This keeps later audit/billing
clear when a workspace has both AU and US numbers.

## UI Behaviour

The Assistant page shows non-chat communication in the Kyro activity pane. Phone
rows open an in-page preview with:

- status, purpose, and duration,
- direction/from/to/customer number,
- linked contact, lead, and conversation ids when available,
- transcript and summary,
- recording audio when Vapi returns a recording URL,
- recent raw event names.

The mobile app should mirror this as a normal detail screen rather than a desktop
split pane. It should not implement separate phone logic; it should call
`GET /api/assistant/activity` for the list, `GET /api/voice/calls/[callId]` for
details, and `POST /api/voice/outbound` to start an approved outbound call.

The web app now also has a separate developer-facing Vapi internal voice tab at
`/voice-vapi`. It intentionally leaves `/voice` intact as the OpenAI Realtime
testbed. `/voice-vapi` uses the Vapi browser runtime for audio transport, injects
the same Kyro Assistant context into the Vapi call, and persists completed user
and assistant turns back to the main Assistant thread. The mobile app should use
`GET /api/assistant/vapi/internal/session` and the same persist route if it builds
a native Vapi voice screen.

By default, the internal Vapi session does not send a transcriber override. The
Vapi dashboard setting should win, which keeps testing simple when the assistant
is configured with ElevenLabs Scribe v2 Realtime or another provider directly in
Vapi. If the team needs to force a Kyro-side transcription experiment, set
`VAPI_ENABLE_TRANSCRIBER_OVERRIDE=true`. The current override path supports
Deepgram, OpenAI, ElevenLabs, and Gladia provider payloads, keeps a Deepgram
`nova-3` fallback, and sends conservative single-word keyword boosts for names
like Kyro where supported.

The internal Vapi session can still pass the workspace's selected ElevenLabs
voice id so web, mobile, and phone paths use the same voice. It does not send a
voice model by default, so the Vapi dashboard text-to-speech model setting wins;
this is the intended path for ElevenLabs `eleven_v3` testing. If the team needs
to force the voice model from Kyro for a controlled experiment, set
`VAPI_ENABLE_VOICE_MODEL_OVERRIDE=true`.

The Vapi context mirrors the OpenAI Realtime voice tab's Kyro-name guidance:
Kyro is pronounced like Cairo, and common speech-to-text variants such as Cairo,
Kairo, Kiro, Kyra, Cara, Kara, Clare, or Claire near the start of a request are
treated as Kyro unless the user clearly means a real person or place. The web
client also applies that same narrow correction to final user transcripts before
rendering and persisting them into the main Assistant thread.

## Vapi Tools

Recommended Vapi tool definitions:

`kyro_lookup_contact`

- Purpose: identify whether the caller matches an existing CRM contact.
- Arguments:
  - `workspaceId` string
  - `phoneNumber` string, optional
  - `query` string, optional

`kyro_record_call_note`

- Purpose: persist useful structured notes during or after the call.
- Arguments:
  - `workspaceId` string
  - `note` string
  - `priority` string, optional

`kyro_update_contact`

- Purpose: update an existing CRM contact profile after the user gives a clear
  instruction.
- Arguments:
  - `workspaceId` string
  - `userId` string
  - `contactId` string, optional
  - `query` / `contactQuery` string, optional when no contact id is known
  - `name` / `newName` string, optional
  - `email` string, optional
  - `phone` / `phoneNumber` string, optional
  - `company` string, optional
  - `address` string, optional. Include suburb/city, state, and country when
    available; if the user only gives a bare street address, ask for suburb/city
    before calling the tool.
  - `notes` string, optional
  - `notesMode` string, optional: `append` or `replace`
  - `contactType` string, optional: `client`, `supplier`, `contractor`,
    `builder`, `property_manager`, or `other`
- Behaviour: Kyro normalizes email/phone/company fields, resolves address updates
  through Google Places/Address Validation when configured, refuses bare
  street-only address updates until the assistant gets locality detail, appends
  notes by default, and writes an audit log. If more than one contact matches,
  the tool returns cards and asks the user to choose before changing anything.

`kyro_context_lookup` or `kyro_assistant_command`

- Purpose: ask Kyro's normal assistant command layer to inspect CRM, Files, Inbox,
  email sync state, usage, settings, generated-image context, or app help.
- Arguments:
  - `workspaceId` string
  - `userId` string
  - `threadId` string, optional
  - `prompt` string

`kyro_web_search`

- Purpose: run Kyro's approved web-search tool when the user asks for public or
  current internet information.
- Arguments:
  - `workspaceId` string
  - `userId` string
  - `prompt` string

`kyro_check_recent_email`

- Purpose: trigger the same bounded Gmail/Outlook inbox check available to the
  text Assistant.
- Arguments:
  - `workspaceId` string
  - `userId` string
  - `provider` string, optional: `google` or `microsoft`

For the internal Vapi voice assistant, configure its system prompt to include
`{{kyro_context}}` and instruct it to use the Kyro tool endpoint for work-related
requests instead of answering from memory. Kyro passes `workspace_id`, `user_id`,
`thread_id`, `kyro_context`, and `kyro_tool_url` as Vapi variable values.

More tools can be added later for creating tasks, booking appointments, sending
SMS/email follow-ups, or escalating urgent work. Those should remain explicit,
audited tools rather than free-form provider access.

## Live Setup Checklist

1. Create or select a Twilio number with voice and SMS capabilities.
2. Connect the number to Vapi.
3. Create Vapi assistants for:
   - internal Kyro voice testing, if using `/voice-vapi`,
   - inbound customer calls,
   - voicemail overflow,
   - outbound customer calls.
4. Set Vapi server/webhook URL to:
   - `https://YOUR_APP_URL/api/integrations/vapi/webhook`
5. Add Vapi tools pointing at:
   - `https://YOUR_APP_URL/api/integrations/vapi/tool`
6. Save assistant ids in Settings -> Voice, and save a fallback phone-number id
   only while per-number mappings are not available.
7. For each Twilio number connected to Vapi, add/update the matching
   `workspace_phone_numbers` row with `country_code`, `region`, voice/SMS
   capabilities, Twilio `provider_phone_number_id`, and
   `metadata.vapiPhoneNumberId`.
8. Add user/team numbers in Settings -> Voice so Kyro can treat those callers as
   internal instructions.
9. For `/voice-vapi`, add `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and save the internal
   assistant id, then confirm turns persist into the main Assistant thread.
10. Place a controlled test call, confirm it appears in Kyro activity, then inspect
   transcript, recording, and events.

## Known Hardening

- Tune exact Vapi payload parsing against live webhooks.
- Decide recording retention, download, and privacy policy before production.
- Convert accepted call summaries into normal CRM messages/tasks when useful.
- Add number search/purchase UI and pass-through rental usage billing.
- Add richer Vapi tools for task creation, appointment suggestions, and urgent
  escalation once call safety boundaries are tested.
