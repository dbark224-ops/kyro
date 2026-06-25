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
- Kyro still needs production work for recording retention, urgent escalation,
  post-call automation, and smoke testing.

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

### 2. Recording Retention

Goal: decide and implement how Kyro stores, displays, expires, and deletes call
recordings.

To finish:

1. Choose the retention period for raw recordings.
2. Decide whether transcript/summary retention differs from audio retention.
3. Decide whether Kyro stores only Vapi recording URLs or copies recordings into
   private Supabase Storage.
4. Add deletion or expiry behaviour for old recordings.
5. Add user-facing policy language in settings, onboarding, terms, or help text.
6. Add an operator/admin path to remove a recording while keeping the call row,
   transcript, or summary when appropriate.

Done means:

- Kyro has a clear recording retention policy.
- The app behaviour matches the policy.
- Users are not surprised that calls are recorded or retained.

### 3. Urgent Escalation

Goal: move urgent-call handling from prompt-only guidance into a reliable Kyro
workflow.

To finish:

1. Define urgent categories: flooding, gas/electrical risk, safety issue,
   after-hours emergency, angry customer, missed appointment, and similar.
2. Decide allowed escalation actions: SMS owner, call owner, create urgent task,
   mark activity urgent, email summary, or a combination.
3. Implement an explicit audited escalation tool/workflow.
4. Protect the workflow so external callers cannot spam or abuse the owner.
5. Show urgent escalations clearly in Assistant activity, CRM, and any task
   surface.

Done means:

- A real Kyro record/action is created when a call is urgent.
- The user can see and act on urgent calls quickly.
- The assistant does not rely only on natural-language prompt instructions.

### 4. Post-Call Automation

Goal: turn useful call outcomes into normal Kyro business records.

To finish:

1. Upgrade `kyro_record_call_note` so it creates a proper CRM/timeline note,
   task, message, or conversation update rather than only a raw voice event.
2. Create callback tasks when the caller needs a return call.
3. Create quote/job/booking follow-up tasks when the call asks for work.
4. Link calls to contacts, conversations, and leads as aggressively as is safe.
5. Surface post-call actions in Assistant activity and CRM.
6. Make failed/partial calls visually distinct from successfully handled calls.

Done means:

- A useful completed call leaves the user with a clear next action.
- Call notes are visible where a small-business user naturally expects them.
- Raw provider events remain available for audit, but they are not the only
  durable call outcome.

### 5. Voicemail Overflow Smoke Test

Goal: prove missed personal calls route to the dedicated Kyro voicemail overflow
assistant.

To test:

1. Confirm the workspace has a Kyro number marked for voicemail overflow.
2. Confirm the number has `metadata.vapiPhoneNumberId`.
3. Confirm Settings -> Voice has `phoneAgentVoicemailOverflowEnabled = true`.
4. Confirm Settings -> Voice has a voicemail overflow assistant id.
5. Configure conditional forwarding on the personal/mobile number.
6. Disable iPhone Live Voicemail before testing.
7. Place a test call from another phone and let the personal phone ring out.
8. Confirm Kyro answers with the voicemail overflow assistant.
9. Confirm Assistant activity shows purpose `voicemail_overflow`.
10. Confirm transcript, summary, recording URL, caller number, and event history
    look right.

Done means:

- Missed personal calls are handled by the intended voicemail overflow path, not
  a generic inbound assistant.

### 6. Inbound Customer Call Smoke Test

Goal: prove direct calls to the Kyro number behave as external customer calls.

To test:

1. Call the Kyro number from a non-internal phone number.
2. Confirm Kyro selects `inbound_customer`.
3. Confirm the assistant collects caller name, callback number, job details,
   address/suburb, urgency, and preferred timing.
4. Confirm it does not expose private CRM or internal workspace data.
5. Confirm call details appear in Assistant activity.

Done means:

- External callers get useful business intake without internal privileges.

### 7. Internal User Call Smoke Test

Goal: prove trusted user/team numbers get internal assistant behaviour.

To test:

1. Add the user's personal/team number in Settings -> Voice.
2. Call the Kyro number from that configured number.
3. Confirm Kyro selects `inbound_user`.
4. Confirm internal tools work for CRM lookup, recent messages, SMS, outbound
   call requests, email checks, and context lookup.
5. Confirm an unconfigured number cannot access internal behaviour.

Done means:

- Owner/team calls can control Kyro safely.
- External callers cannot impersonate the owner by saying they are staff.

### 8. Outbound Call Smoke Test

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

Done means:

- The user can confidently ask Kyro to place a customer call from an approved
  path.

### 9. Vapi Tool-Call Test Matrix

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
- Dangerous tools are only available in trusted internal contexts.

### 10. Activity and Call Preview Polish

Goal: make phone activity trustworthy and easy to inspect.

To finish:

1. Confirm date and time display properly in Assistant activity.
2. Confirm call purpose, status, direction, contact, transcript, summary, and
   recording display clearly.
3. Confirm failed, missed, partial, and completed calls look different.
4. Confirm call preview works on desktop and mobile-sized layouts.

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
