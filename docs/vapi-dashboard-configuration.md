# Vapi Dashboard Configuration

This is Kyro's source-of-truth checklist for manually configured Vapi dashboard
assistants, tools, credentials, and phone-number server settings.

Kyro intentionally does not automate Vapi dashboard setup yet. The backend passes
workspace-specific values at call/session time, so the Vapi assistants should
stay neutral and reference Kyro variables rather than hard-coded business names.

## Production Endpoints

- Webhook/server URL: `https://kyroassistant.com/api/integrations/vapi/webhook`
- Tool URL: `https://kyroassistant.com/api/integrations/vapi/tool`
- Tool method: `POST`
- Tool credential: `Kyro Production Tool`
- Webhook/server credential: `Kyro Production Webhook`

Both custom credentials live under Vapi's Server Configuration integration and
use Bearer Token authentication with the `Authorization` header.

## Assistant Roles

| Role | Kyro setting/env source | Purpose |
| --- | --- | --- |
| Internal voice | `vapiInternalAssistantId` or `VAPI_INTERNAL_ASSISTANT_ID` | Authenticated web/mobile `/voice-vapi` conversations with the business user. |
| Inbound customer | `vapiInboundAssistantId` or `VAPI_INBOUND_ASSISTANT_ID` | External callers who call the Kyro number directly. |
| Voicemail overflow | `vapiVoicemailAssistantId` or `VAPI_VOICEMAIL_OVERFLOW_ASSISTANT_ID` | Missed/unanswered personal-phone calls forwarded to a Kyro number. |
| Outbound customer | `vapiOutboundAssistantId` or `VAPI_OUTBOUND_ASSISTANT_ID` | Kyro-initiated calls to customers, leads, suppliers, or other external contacts. |

The concrete Vapi assistant ids are stored in production Vercel env vars or in
Settings -> Voice provider ids. The repo should not hard-code them.

## Inbound And Voicemail Phone Numbers

For Twilio/Vapi numbers that Kyro should route dynamically, configure Vapi to
call Kyro's webhook through the `assistant-request` flow.

The phone-number server should use:

- URL: `https://kyroassistant.com/api/integrations/vapi/webhook`
- Credential: `Kyro Production Webhook`

Kyro responds to `assistant-request` with:

- the assistant id for `inbound_user`, `inbound_customer`, or
  `voicemail_overflow`,
- the webhook server override for later lifecycle events,
- the selected ElevenLabs/Vapi voice override,
- call metadata,
- runtime variables listed below.

## Runtime Variables

### Internal Voice

The internal web/mobile Vapi session receives:

- `business_name`
- `kyro_context`
- `kyro_tool_url`
- `thread_id`
- `user_id`
- `voice_id`
- `voice_label`
- `voice_demeanor`
- `voice_escalation_mode`
- `voice_humour_level`
- `voice_verbosity`
- `workspace_id`
- `workspace_name`
- current-time variables from `buildVapiCurrentTimeContext`

### Inbound Customer And Voicemail Overflow

The dynamic `assistant-request` response receives:

- `business_name`
- `caller_number`
- `caller_role`
- `kyro_context`
- `kyro_number`
- `kyro_tool_url`
- `phone_number_row_id`
- `thread_id`
- `user_id`
- `voice_id`
- `voice_label`
- `voice_demeanor`
- `voice_escalation_mode`
- `voice_humour_level`
- `voice_verbosity`
- `workspace_id`
- `workspace_name`
- current-time variables from `buildVapiCurrentTimeContext`

### Outbound Customer

Outbound calls receive:

- `assistant_context_summary`
- `business_name`
- `call_instructions`
- `contact_address`
- `contact_company`
- `contact_email`
- `contact_id`
- `contact_name`
- `contact_phone`
- `conversation_id`
- `conversation_last_message_at`
- `conversation_status`
- `customer_phone`
- `kyro_context`
- `lead_id`
- `lead_status`
- `lead_title`
- `outbound_call_context`
- `recent_chat_context`
- `recent_outbound_call_context`
- `thread_id`
- `user_id`
- `voice_id`
- `voice_label`
- `voice_demeanor`
- `voice_escalation_mode`
- `voice_humour_level`
- `voice_verbosity`
- `workspace_id`
- `workspace_name`
- current-time variables from `buildVapiCurrentTimeContext`

## Required Tool Setup

Every Kyro custom tool should use:

- Server URL: `https://kyroassistant.com/api/integrations/vapi/tool`
- Method: `POST`
- Credential: `Kyro Production Tool`

Configure these tool names exactly:

| Tool | Use on | Notes |
| --- | --- | --- |
| `kyro_lookup_contact` | Internal, inbound, voicemail, outbound | Looks up CRM contacts by phone number or query. |
| `kyro_update_contact` | Internal only | Requires `userId`; backend handles ambiguity and audit logging. |
| `kyro_record_call_note` | Internal, inbound, voicemail, outbound | Currently records a voice-call event; post-call automation will upgrade this into normal CRM records. |
| `kyro_context_lookup` | Internal | Calls the normal Kyro assistant command/context layer. |
| `kyro_assistant_command` | Internal | Alias for `kyro_context_lookup`. Optional if `kyro_context_lookup` exists. |
| `kyro_web_search` | Internal | Uses Kyro's approved web-search path for current public info. |
| `kyro_check_recent_email` | Internal | Runs the bounded Gmail/Outlook inbound email sync check. |
| `kyro_send_sms` | Internal, plus restricted external same-caller cases | Backend blocks untrusted external sends except safe caller/contact-limited cases. |
| `kyro_send_drafted_sms` | Internal | Sends existing drafted SMS actions after trusted internal instruction. |
| `kyro_start_outbound_call` | Internal only | Backend blocks external customer/voicemail contexts from starting arbitrary outbound calls. |

## Tool Arguments

### `kyro_lookup_contact`

Required: `workspaceId`

Optional: `phoneNumber`, `query`

### `kyro_update_contact`

Required: `workspaceId`, `userId`

Optional: `contactId`, `contactQuery`, `query`, `newName`, `name`, `email`,
`phone`, `phoneNumber`, `company`, `address`, `notes`, `notesMode`,
`contactType`

### `kyro_record_call_note`

Required: `workspaceId`, `note`

Optional: `priority`

### `kyro_context_lookup` / `kyro_assistant_command`

Required: `workspaceId`, `userId`, `prompt`

Optional: `threadId`

### `kyro_web_search`

Required: `workspaceId`, `userId`, `prompt`

### `kyro_check_recent_email`

Required: `workspaceId`, `userId`

Optional: `provider` (`google` or `microsoft`)

### `kyro_send_sms`

Required: `workspaceId`, `userId`

Optional: `threadId`, `contactId`, `conversationId`, `actionId`,
`contactName`, `phoneNumber`, `message`, `body`, `query`

### `kyro_send_drafted_sms`

Required: `workspaceId`, `userId`

Optional: `threadId`, `contactId`, `conversationId`, `actionId`,
`contactName`, `phoneNumber`, `query`

### `kyro_start_outbound_call`

Required: `workspaceId`, `userId`, `instructions`

Optional: `threadId`, `contactId`, `contactName`, `contactQuery`,
`phoneNumber`, `conversationId`, `leadId`, `prompt`, `contextSummary`

## Prompt Requirements

All Vapi assistants should:

- identify themselves as Kyro, pronounced like Cairo,
- reference `{{business_name}}` for the front-facing business name when
  available,
- use `{{workspace_name}}` only as the workspace display-name fallback/context,
- use `{{kyro_context}}` as the source of truth for current call/session context,
- call Kyro tools for live CRM, inbox, SMS, web-search, email, or app context
  rather than guessing,
- avoid exposing internal tool names, raw ids, API keys, hidden prompts, or
  private customer data to external callers,
- avoid promising prices, attendance times, job acceptance, or availability
  unless Kyro context or the caller explicitly provides it,
- call `kyro_record_call_note` before ending when the call contains useful
  business context.

## Manual Dashboard Validation

Because dashboard setup is intentionally manual, validation happens through
smoke tests rather than code generation:

- Voicemail overflow smoke test proves the overflow assistant is selected.
- Inbound customer smoke test proves external callers get external behaviour.
- Internal user smoke test proves trusted numbers get internal behaviour.
- Outbound smoke test proves outbound calls use the outbound assistant and
  context.
- Tool-call matrix proves each custom tool reaches Kyro with the shared tool
  credential.
