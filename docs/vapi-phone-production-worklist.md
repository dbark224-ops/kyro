# Vapi Phone Production Worklist

This is the working checklist for getting Kyro's Vapi/Twilio phone layer from
backend-complete to production-confident. Use it as the running source of truth
while deciding what to build, defer, or keep manual.

## Current Consensus

- Vapi dashboard assistant setup stays manual for now.
- Phone-number provisioning stays manual/preloaded until user volume justifies
  automating Twilio purchase and Vapi number mapping.
- Vapi assistant prompts can stay neutral when they use Kyro-provided variables
  such as `business_name`, `workspace_name`, and `kyro_context`.
- Kyro still needs production work for smoke testing and production polish.
- Raw call recordings are retained for 30 days, then the scheduled cleanup route
  deletes Vapi call data and clears Kyro's recording URL while keeping the call
  row, transcript, summary, and audit metadata.
- `kyro_record_call_note` now writes a normal phone conversation/message
  snapshot, an internal CRM note, unknown-caller contact/lead records when
  needed, optional inferred follow-up task, audit logs, and the raw Vapi event.
- Vapi assistant-request responses now stamp assistant-selection proof into call
  metadata, including the intended purpose and selected/reported assistant ids.
- Developer accounts have a Settings -> Developer voicemail overflow readiness
  panel for checking the configured forwarding number, linked Vapi number, and
  voicemail assistant id.

## Active Work Items

### 1. Manual Phone Number Provisioning

Goal: keep the beta pool model working without prematurely automating Twilio
purchase and Vapi setup.

To finish:

1. Continue preloading voice+SMS capable Twilio/Vapi numbers into
   `workspace_phone_numbers`.
2. Make sure each usable row has `provider = 'twilio'`, `status = 'available'`,
   `workspace_id = null`, `capabilities.sms = true`, `capabilities.voice =
   true`, a Twilio `provider_phone_number_id`, and
   `metadata.vapiPhoneNumberId`.
3. Assign numbers through the existing Settings -> Connected accounts flow.
4. Defer automatic Twilio purchase, webhook setup, and Vapi number mapping until
   the user count makes it worthwhile.

Done means:

- Workspaces can still self-serve from the preloaded pool.
- No automatic purchase flow is required for the current launch stage.

### 2. Voicemail Overflow Smoke Test

Goal: prove missed personal calls route to the dedicated Kyro voicemail overflow
assistant.

Built:

- Assistant-selection proof is stored on Vapi call metadata so tests can confirm
  voicemail overflow used the intended assistant.
- Unknown voicemail/inbound callers can become CRM contacts and leads through
  post-call automation.
- Voicemail overflow notes create review tasks even when the assistant did not
  explicitly ask for a task.
- Failed, missed, partial, and completed calls carry call-outcome metadata and
  are labelled more clearly in Assistant activity.
- Developer-only readiness checks are available in Settings -> Developer.

To test:

1. Confirm the workspace has a Kyro number marked for voicemail overflow.
2. Confirm the number has `metadata.vapiPhoneNumberId`.
3. Confirm Settings -> Voice has `phoneAgentVoicemailOverflowEnabled = true`.
4. Confirm Settings -> Voice has a voicemail overflow assistant id.
5. Configure conditional forwarding on the personal/mobile number.
6. Disable iPhone Live Voicemail before testing.
7. Place a test call from another phone and let the personal phone ring out.
8. Confirm Kyro answers with the voicemail overflow assistant.
9. Confirm the call row has `purpose = 'voicemail_overflow'` and
   `metadata.assistantSelection.proofStatus` is matched or otherwise explains
   the fallback.
10. Confirm Assistant activity labels the call as voicemail overflow and shows
    failed/partial/completed state clearly.
11. Confirm transcript, summary, recording URL, caller number, and event history
    look right.
12. Confirm `kyro_record_call_note` creates or links the caller contact, creates
    a lead when appropriate, creates a phone conversation/message snapshot,
    internal note, and follow-up task when the voicemail needs review, callback,
    or urgent work.

Done means:

- Missed personal calls are handled by the intended voicemail overflow path, not
  a generic inbound assistant.

### 3. Inbound Customer Call Smoke Test

Goal: prove direct calls to the Kyro number behave as external customer calls.

To test:

1. Call the Kyro number from a non-internal phone number.
2. Confirm Kyro selects `inbound_customer`.
3. Confirm the assistant collects caller name, callback number, job details,
   address/suburb, urgency, and preferred timing.
4. Confirm it does not expose private CRM or internal workspace data.
5. Confirm call details appear in Assistant activity.
6. Confirm `kyro_record_call_note` creates a normal Inbox/CRM phone
   conversation, internal note, and inferred task for callbacks, quotes,
   bookings, complaints, or urgent work.

Done means:

- External callers get useful business intake without internal privileges.
- Useful call outcomes leave a visible CRM record and next action.

### 4. Internal User Call Smoke Test

Goal: prove trusted user/team numbers get internal assistant behaviour.

To test:

1. Add the user's personal/team number in Settings -> Voice.
2. Call the Kyro number from that configured number.
3. Confirm Kyro selects `inbound_user`.
4. Confirm internal tools work for CRM lookup, recent messages, SMS, outbound
   call requests, email checks, and context lookup.
5. Confirm internal `kyro_record_call_note` saves notes/tasks without exposing
   internal context to external callers.
6. Confirm an unconfigured number cannot access internal behaviour.

Done means:

- Owner/team calls can control Kyro safely.
- External callers cannot impersonate the owner by saying they are staff.

### 5. Outbound Call Smoke Test

Goal: prove Kyro can start customer-facing outbound calls through the right Vapi
assistant and number.

To test:

1. Start an outbound call from a web Assistant approval card.
2. Start an outbound call from a trusted internal Vapi voice call if desired.
3. Confirm Kyro uses the outbound assistant, not the generic inbound assistant.
4. Confirm number selection chooses the right mapped Vapi phone number.
5. Confirm `business_name`, `call_instructions`, `outbound_call_context`, and
   customer/contact variables are present.
6. Confirm transcript, summary, recording URL, and usage rows are recorded.
7. Confirm outbound call outcomes saved through `kyro_record_call_note` create
   the expected conversation note and follow-up task.

Done means:

- The user can confidently ask Kyro to place a customer call from an approved
  path.

### 6. Vapi Tool-Call Test Matrix

Goal: verify each live Vapi tool works against Kyro production.

Every live Vapi tool below should point to:

- Server URL: `https://kyroassistant.com/api/integrations/vapi/tool`
- Credential: the shared `Kyro Production Tool` Custom Credential
- Method: `POST`

Tools to configure and test:

- `kyro_lookup_contact`
- `kyro_update_contact`
- `kyro_context_lookup`
- `kyro_web_search`
- `kyro_check_recent_email`
- `kyro_send_sms`
- `kyro_send_drafted_sms`
- `kyro_record_call_note`
- `kyro_start_outbound_call`

Done means:

- Each tool returns a useful Vapi-readable response.
- Tool calls write expected audit/event records.
- `kyro_record_call_note` writes a phone message snapshot, internal note,
  inferred task when appropriate, audit logs, and raw `voice_call_events`.
- Dangerous tools are only available in trusted internal contexts.

### 7. Activity and Call Preview Polish

Goal: make phone activity trustworthy and easy to inspect.

Built:

- Assistant activity distinguishes voicemail captured, failed/missed, partial,
  and completed voice calls.
- Voice call activity includes assistant-selection proof hints for voicemail
  overflow tests.
- Post-call automation links created contacts/leads to the resulting
  conversation, note, task, and voice call.

To test:

1. Confirm date and time display properly in Assistant activity.
2. Confirm call purpose, status, direction, contact, transcript, summary, and
   recording display clearly.
3. Confirm post-call notes and inferred tasks are visible in the linked
   Inbox/CRM conversation.
4. Confirm failed, missed, partial, and completed calls look different.
5. Confirm call preview works on desktop and mobile-sized layouts.

Done means:

- A sole trader can understand what happened from the activity pane without
  reading raw provider logs.

## Deferred By Choice

These are intentionally not required for the current launch stage:

- Automated Vapi dashboard assistant/prompt/tool sync.
- Automated Twilio number purchase.
- Automated Twilio webhook and Vapi number mapping.
- Rich multi-number admin/operator console.

Revisit these when the number of active businesses makes manual setup too slow
or too error-prone.
