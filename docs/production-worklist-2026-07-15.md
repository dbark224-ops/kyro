# Kyro Production Worklist

Updated: 2026-07-16

This is the live production worklist. Completed build items are removed from the active list after implementation and verification; deferred decisions remain visible so they are not mistaken for missing engineering.

## Active now

- [ ] Complete production smoke testing for onboarding, billing/webhooks, inbound and outbound voice, SMS, voicemail overflow, email sync, calendar sync, escalation, and recovery paths.
- [ ] Enable Supabase leaked-password protection in Auth settings and re-run the security advisor.

## Look at later

- [ ] Decide the final call-recording consent policy and jurisdiction-specific disclosure behavior before expanding recording beyond the current controlled rollout.
- [ ] Automate phone-number provisioning after customer volume makes the current pre-purchased pool operationally inefficient.
- [ ] Revisit deeper mailbox history and provider push lifecycle work after launch data shows the polling model is insufficient.

## Operational launch checks

- [ ] Review the Better Stack `Kyro website` and `Kyro background processing` monitors alongside queue age, recurring schedule lag, expired leases, and dead letters; replay resolved dead letters through `/api/background/retry`.
- [ ] Keep enough pre-purchased Twilio numbers available for expected onboarding demand.
- [ ] Monitor Stripe webhook failures, unpaid invoices, grace-period accounts, and restricted accounts.
- [ ] Monitor Vapi/Twilio balances, provider status, failed calls/SMS, voicemail overflow routing, and recording cleanup.
- [ ] Review Kyro's internal bug-alert mailbox and Supabase/Vercel security and performance advisories.
