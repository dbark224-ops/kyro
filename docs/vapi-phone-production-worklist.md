# Vapi Phone Production Worklist

Last updated: 2026-06-25

This is the working checklist for getting Kyro's Vapi/Twilio phone layer from
backend-complete to production-confident. Use it as the running source of truth
while deciding what to build, defer, or keep manual.

Status key:

- `[x]` Built, configured, or intentionally decided.
- `[~]` Partly built or partly proven; still needs live production testing.
- `[ ]` Not done yet.

## Current Consensus

- [x] Vapi dashboard assistant setup stays manual for now.
- [x] Phone-number provisioning stays manual/preloaded until user volume
  justifies automating Twilio purchase and Vapi number mapping.
- [x] Vapi assistant prompts can stay neutral when they use Kyro-provided
  variables such as `business_name`, `workspace_name`, and `kyro_context`.
- [x] Raw call recordings are retained for 30 days, then the scheduled cleanup
  route deletes Vapi call data and clears Kyro's recording URL while keeping the
  call row, transcript, summary, and audit metadata.
- [x] `kyro_record_call_note` writes a normal phone conversation/message
  snapshot, an internal CRM note, unknown-caller contact/lead records when
  needed, optional inferred follow-up task, audit logs, and the raw Vapi event.
- [x] Vapi assistant-request responses stamp assistant-selection proof into call
  metadata, including intended purpose and selected/reported assistant ids.
- [x] Developer accounts have a Settings -> Developer voicemail overflow
  readiness panel for checking the configured forwarding number, linked Vapi
  number, and voicemail assistant id.
- [~] Production confidence still depends on live smoke testing across
  voicemail overflow, inbound customer calls, internal-user calls, outbound
  calls, and every live Vapi tool.

## Overall Status

- [x] Backend routes, assistant selection, recording retention, post-call CRM
  automation, activity labels, and Vapi custom credential readiness are built.
- [x] Your Mint/iPhone voicemail overflow test proved a missed personal call can
  reach Kyro once iPhone Live Voicemail is disabled.
- [~] Voicemail overflow appears wired, but still needs repeated proof that
  every forwarded call uses the dedicated voicemail overflow assistant and
  writes the expected CRM/activity records.
- [~] Inbound, internal, and outbound call paths are built enough to test, but
  not fully production-proven.
- [~] Vapi tool configuration is documented and credentials exist, but each live
  Vapi tool still needs a production call/test transcript proving it works.
- [ ] Urgent escalation rules still need a dedicated production pass: what
  counts as urgent, who gets notified, by which channel, and how failures are
  surfaced.

## Active Work Items

### 1. Manual Phone Number Provisioning

Goal: keep the beta pool model working without prematurely automating Twilio
purchase and Vapi setup.

Status: `[~]` Operational model is built; ongoing manual inventory work remains.

Done:

- [x] `workspace_phone_numbers` supports preloaded Twilio/Vapi numbers.
- [x] Settings can assign an available voice+SMS number from the preloaded pool.
- [x] Automatic Twilio purchase, webhook setup, and Vapi number mapping are
  intentionally deferred.

Still to monitor/do:

- [ ] Keep preloading enough voice+SMS capable Twilio/Vapi numbers before launch
  and during daily operations.
- [ ] Ensure each usable pool row has `provider = 'twilio'`, `status =
  'available'`, `workspace_id = null`, `capabilities.sms = true`,
  `capabilities.voice = true`, a Twilio `provider_phone_number_id`, and
  `metadata.vapiPhoneNumberId`.
- [ ] Periodically verify assigned numbers still match their Vapi phone-number
  mapping.

Done means:

- Workspaces can self-serve from the preloaded pool.
- No automatic purchase flow is required for the current launch stage.

### 2. Voicemail Overflow Smoke Test

Goal: prove missed personal calls route to the dedicated Kyro voicemail overflow
assistant.

Status: `[~]` Built and partly proven; still needs repeated smoke tests.

Done:

- [x] Assistant-selection proof is stored on Vapi call metadata so tests can
  confirm voicemail overflow used the intended assistant.
- [x] Unknown voicemail/inbound callers can become CRM contacts and leads
  through post-call automation.
- [x] Voicemail overflow notes create review tasks even when the assistant did
  not explicitly ask for a task.
- [x] Failed, missed, partial, and completed calls carry call-outcome metadata
  and are labelled more clearly in Assistant activity.
- [x] Developer-only readiness checks are available in Settings -> Developer.
- [x] Mint/iPhone forwarding was proven to reach Kyro after Live Voicemail was
  disabled.

Still to test:

- [ ] Confirm the workspace has a Kyro number marked for voicemail overflow.
- [ ] Confirm the number has `metadata.vapiPhoneNumberId`.
- [ ] Confirm Settings -> Voice has `phoneAgentVoicemailOverflowEnabled = true`.
- [ ] Confirm Settings -> Voice has a voicemail overflow assistant id.
- [ ] Configure conditional forwarding on the personal/mobile number.
- [ ] Disable iPhone Live Voicemail before testing.
- [ ] Place multiple test calls from another phone and let the personal phone
  ring out.
- [ ] Confirm Kyro answers with the voicemail overflow assistant every time.
- [ ] Confirm the call row has `purpose = 'voicemail_overflow'` and
  `metadata.assistantSelection.proofStatus` is matched or clearly explains the
  fallback.
- [ ] Confirm Assistant activity labels the call as voicemail overflow and shows
  failed/partial/completed state clearly.
- [ ] Confirm transcript, summary, recording URL, caller number, and event
  history look right.
- [ ] Confirm `kyro_record_call_note` creates or links the caller contact,
  creates a lead when appropriate, creates a phone conversation/message
  snapshot, internal note, and follow-up task when the voicemail needs review,
  callback, or urgent work.

Done means:

- Missed personal calls are handled by the intended voicemail overflow path, not
  a generic inbound assistant.

### 3. Inbound Customer Call Smoke Test

Goal: prove direct calls to the Kyro number behave as external customer calls.

Status: `[~]` Built enough to test; live proof still needed.

Done:

- [x] Vapi assistant selection can distinguish external customer calls from
  trusted internal-user calls.
- [x] Post-call automation can create the normal phone conversation/message
  snapshot, internal note, contact/lead linkage, and inferred task.
- [x] Assistant activity can show call purpose, status, and outcome metadata.

Still to test:

- [ ] Call the Kyro number from a non-internal phone number.
- [ ] Confirm Kyro selects `inbound_customer`.
- [ ] Confirm the assistant collects caller name, callback number, job details,
  address/suburb, urgency, and preferred timing.
- [ ] Confirm it does not expose private CRM or internal workspace data.
- [ ] Confirm call details appear in Assistant activity.
- [ ] Confirm `kyro_record_call_note` creates a normal Inbox/CRM phone
  conversation, internal note, and inferred task for callbacks, quotes,
  bookings, complaints, or urgent work.

Done means:

- External callers get useful business intake without internal privileges.
- Useful call outcomes leave a visible CRM record and next action.

### 4. Internal User Call Smoke Test

Goal: prove trusted user/team numbers get internal assistant behaviour.

Status: `[~]` Built enough to test; live proof still needed.

Done:

- [x] Settings -> Voice has trusted user/team phone-number configuration.
- [x] Internal assistant routing is separated from external customer routing.
- [x] Internal calls can access the safer internal tool set when the caller is
  trusted.

Still to test:

- [ ] Add the user's personal/team number in Settings -> Voice.
- [ ] Call the Kyro number from that configured number.
- [ ] Confirm Kyro selects `inbound_user`.
- [ ] Confirm internal tools work for CRM lookup, recent messages, SMS,
  outbound call requests, email checks, and context lookup.
- [ ] Confirm internal `kyro_record_call_note` saves notes/tasks without
  exposing internal context to external callers.
- [ ] Confirm an unconfigured number cannot access internal behaviour.

Done means:

- Owner/team calls can control Kyro safely.
- External callers cannot impersonate the owner by saying they are staff.

### 5. Outbound Call Smoke Test

Goal: prove Kyro can start customer-facing outbound calls through the right Vapi
assistant and number.

Status: `[~]` Built enough to test; live proof still needed.

Done:

- [x] Web Assistant can prepare/start outbound customer calls from approval
  paths.
- [x] Trusted internal Vapi/SMS instructions can request outbound calls.
- [x] Dynamic variables include `business_name`, `workspace_name`,
  `call_instructions`, `outbound_call_context`, and customer/contact context.
- [x] Outbound call outcomes can flow through `kyro_record_call_note` into CRM
  notes/tasks.

Still to test:

- [ ] Start an outbound call from a web Assistant approval card.
- [ ] Start an outbound call from a trusted internal Vapi voice call if desired.
- [ ] Confirm Kyro uses the outbound assistant, not the generic inbound
  assistant.
- [ ] Confirm number selection chooses the right mapped Vapi phone number.
- [ ] Confirm dynamic variables are present in Vapi logs/transcript context.
- [ ] Confirm transcript, summary, recording URL, and usage rows are recorded.
- [ ] Confirm outbound call outcomes saved through `kyro_record_call_note`
  create the expected conversation note and follow-up task.

Done means:

- The user can confidently ask Kyro to place a customer call from an approved
  path.

### 6. Vapi Tool-Call Test Matrix

Goal: verify each live Vapi tool works against Kyro production.

Status: `[~]` Credentials and endpoint are ready; tool-by-tool live testing
still needed.

Shared production setup:

- [x] Server URL: `https://www.kyroassistant.com/api/integrations/vapi/tool`
- [x] Credential: shared `Kyro Production Tool` Custom Credential.
- [x] Method: `POST`.
- [x] Vapi tool secret/credential readiness has been completed and removed as a
  separate work item.

Tools to configure and test:

- [ ] `kyro_lookup_contact`
- [ ] `kyro_update_contact`
- [ ] `kyro_context_lookup`
- [ ] `kyro_web_search`
- [ ] `kyro_check_recent_email`
- [ ] `kyro_send_sms`
- [ ] `kyro_send_drafted_sms`
- [ ] `kyro_record_call_note`
- [ ] `kyro_start_outbound_call`

Done means:

- Each tool returns a useful Vapi-readable response.
- Tool calls write expected audit/event records.
- `kyro_record_call_note` writes a phone message snapshot, internal note,
  inferred task when appropriate, audit logs, and raw `voice_call_events`.
- Dangerous tools are only available in trusted internal contexts.

### 7. Activity and Call Preview Polish

Goal: make phone activity trustworthy and easy to inspect.

Status: `[~]` Core polish is built; visual/live QA still needed.

Done:

- [x] Assistant activity distinguishes voicemail captured, failed/missed,
  partial, and completed voice calls.
- [x] Voice call activity includes assistant-selection proof hints for voicemail
  overflow tests.
- [x] Post-call automation links created contacts/leads to the resulting
  conversation, note, task, and voice call.
- [x] Assistant activity now includes both date and time display.

Still to test:

- [ ] Confirm call purpose, status, direction, contact, transcript, summary, and
  recording display clearly.
- [ ] Confirm post-call notes and inferred tasks are visible in the linked
  Inbox/CRM conversation.
- [ ] Confirm failed, missed, partial, and completed calls look different.
- [ ] Confirm call preview works on desktop and mobile-sized layouts.

Done means:

- A sole trader can understand what happened from the activity pane without
  reading raw provider logs.

### 8. Recording Retention

Goal: keep enough call recording history for complaints while automatically
deleting raw provider recordings to reduce storage/compliance burden.

Status: `[x]` Built; schedule and live verification still need operations
monitoring.

Done:

- [x] Retention policy is set to 30 days.
- [x] Cleanup route deletes Vapi call data/recordings and clears Kyro's
  recording URL.
- [x] Kyro keeps the call row, transcript, summary, and audit metadata.

Still to monitor:

- [ ] Confirm the cleanup route is scheduled in production.
- [ ] Confirm old recordings are actually deleted after the retention window.
- [ ] Confirm complaint review still has enough transcript/summary/audit detail
  after the raw recording is gone.

## Deferred By Choice

These are intentionally not required for the current launch stage:

- [x] Automated Vapi dashboard assistant/prompt/tool sync.
- [x] Automated Twilio number purchase.
- [x] Automated Twilio webhook and Vapi number mapping.
- [x] Rich multi-number admin/operator console.

Revisit these when the number of active businesses makes manual setup too slow
or too error-prone.
