# Launch Daily Monitoring Checklist

Use this checklist once Kyro is live with real businesses. It is operational
monitoring, not a build backlog. Clear or escalate issues daily so customer
trust problems do not quietly pile up.

## Phone And SMS Supply

1. Check the pre-purchased Twilio/Vapi number pool.
2. Confirm each launch region has enough available voice+SMS-capable numbers in
   `workspace_phone_numbers`.
3. Confirm available rows have `workspace_id = null`, `status = 'available'`,
   `provider = 'twilio'`, `capabilities.sms = true`, `capabilities.voice =
   true`, a Twilio `provider_phone_number_id`, and `metadata.vapiPhoneNumberId`.
4. Refill the pool before a region gets low enough to block onboarding.
5. Check for assigned numbers missing SMS channels or Vapi phone-number mapping.

## Vapi Phone Health

1. Check `https://kyroassistant.com/api/integrations/vapi/webhook`.
2. Check `https://kyroassistant.com/api/integrations/vapi/tool`.
3. Confirm Vercel logs show no recurring Vapi `401`, `400`, timeout, or tool
   errors.
4. Spot-check recent `voice_calls` rows for expected status, purpose,
   transcript, summary, recording URL, and linked events.
5. Review failed, missed, or partial calls and decide whether they need manual
   follow-up.

## Twilio SMS Health

1. Check `https://kyroassistant.com/api/integrations/twilio/sms`.
2. Check `https://kyroassistant.com/api/integrations/twilio/status`.
3. Review failed/undelivered SMS activity, especially Twilio error codes.
4. Confirm inbound SMS is still creating Inbox/Activity rows.
5. Confirm outbound SMS failures are visible and not stuck silently.

## Assistant And AI Health

1. Review Assistant fallback/error activity.
2. Check for OpenAI, image generation, web-search, or tool-call failures.
3. Review usage spikes or unusual cost changes.
4. Confirm the main Assistant can still reach OpenAI and does not fall back for
   normal user messages.
5. Spot-check that generated summaries, call notes, and customer replies are
   sensible.

## Inbox And Email Sync

1. Check scheduled/manual inbound email sync results.
2. Review reconnect-required warnings for Google or Microsoft accounts.
3. Check promoted vs observed email counts for obvious stalls.
4. Confirm user-visible Inbox rows are updating.
5. Review outbox retry failures for email and SMS.

## Payments And Billing

1. Check Stripe webhook health.
2. Review failed payment-link creation or checkout events.
3. Check usage ledger anomalies, especially phone activation, voice calls, SMS,
   OpenAI, images, and web search.
4. Confirm billing/usage UI loads for real workspaces.

## Infrastructure

1. Check latest Vercel deployment status and runtime errors.
2. Review Supabase health, database errors, auth issues, and storage failures.
3. Check scheduled/cron-like endpoints that should be called externally.
4. Confirm no critical environment readiness endpoint has gone red.
5. Watch for repeated rate limits, provider quota errors, or auth failures.

## Customer-Support Sweep

1. Review new signup/onboarding failures.
2. Review stuck setup states: no phone number, no email connection, no Vapi
   assistant, no Stripe setup, or missing business profile.
3. Review high-priority customer messages or unresolved failed automations.
4. Manually follow up on anything that could make a sole trader miss a customer.

## Daily Closeout

1. Record any incident, customer-impacting failure, or manual correction.
2. Add recurring problems to the product backlog or current worklist.
3. Confirm there are no unresolved production incidents before ending the day.
