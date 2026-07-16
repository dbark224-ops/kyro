# Kyro Production Worklist

Updated: 2026-07-15

This is the live production worklist. Completed build items are removed from the active list after implementation and verification; deferred decisions remain visible so they are not mistaken for missing engineering.

## Active now

- [ ] Replace fixed-cap background scans with cursor-based or claimed work queues before customer volume can exceed a single run's capacity.
- [ ] Complete production smoke testing for onboarding, billing/webhooks, inbound and outbound voice, SMS, voicemail overflow, email sync, calendar sync, escalation, and recovery paths.
- [ ] Add production observability for cron lag, queue age, failed deliveries, provider outages, and billing failures.
- [ ] Enable Supabase leaked-password protection in Auth settings and re-run the security advisor.

## Look at later

- [ ] Decide the final call-recording consent policy and jurisdiction-specific disclosure behavior before expanding recording beyond the current controlled rollout.
- [ ] Automate phone-number provisioning after customer volume makes the current pre-purchased pool operationally inefficient.
- [ ] Revisit deeper mailbox history and provider push lifecycle work after launch data shows the polling model is insufficient.

## Operational launch checks

- [ ] Monitor the oldest pending item and processed count for email, calendar, outbox, notifications, billing, and escalation workers.
- [ ] Keep enough pre-purchased Twilio numbers available for expected onboarding demand.
- [ ] Monitor Stripe webhook failures, unpaid invoices, grace-period accounts, and restricted accounts.
- [ ] Monitor Vapi/Twilio balances, provider status, failed calls/SMS, voicemail overflow routing, and recording cleanup.
- [ ] Review Kyro's internal bug-alert mailbox and Supabase/Vercel security and performance advisories.
