# Kyro Final Home Stretch Checklist

This checklist is the short final-build tracker for the web app before the long testing and refinement phase. The older product backlog still matters, but this file captures the remaining feature areas David wants cleared before mobile/app-store polish.

## Build Targets

- [ ] Full operations dashboard
  - Build a proper dashboard tab for daily business health, urgent work, assistant activity, usage, channel health, and action summaries.
- [ ] Global workspace search
  - Add a persistent app-wide search bar for contacts, leads, inbox messages, files, generated documents, quote drafts, and call records.
- [ ] Phone and SMS completion
  - Finalize inbound SMS, outbound SMS, inbound phone, outbound phone, and voicemail overflow using Twilio plus Vapi where voice interaction is required.
- [ ] Sidebar finalization
  - Add icons after the final tab list settles.
- [ ] Logo and branding lock
  - Decide final logo, favicon, app icon, and light/dark presentation.
- [ ] Payments and billing
  - Integrate Kyro-to-user billing for usage plus margin.
  - Explore user-to-customer/client billing flows separately from Kyro subscription/metering.
- [ ] Reports
  - Add a reports area for operational summaries, leads, customer activity, usage, and exportable business reports.
- [ ] Product backlog clearance
  - Reconcile `docs/product-backlog.md`, remove completed items, and leave only items intentionally deferred.
- [ ] Mobile/native readiness
  - Keep backend APIs reusable by the mobile app and document any new routes or contracts the mobile chat needs.

## Notes

- Keep the web app feature-complete first, then test hard and refine.
- Avoid locking the product into deterministic assistant behavior where an LLM-first tool call can do the job safely.
- Payment processing and app-store readiness should be handled carefully near the end, after the major communication workflows are stable.
