# Kyro Unified Backlog

This is now the single source of truth for the remaining Kyro work. It absorbs the old home-stretch checklist and the older parking-lot backlog so we can see, in one place, what we have already attacked and what still has barely been touched.

## Status Guide

- `Started`: we have already built meaningful foundation work and now need hardening, refinement, or completion.
- `Not Properly Attacked Yet`: we have agreed it matters, but we have not really built it in a serious way yet.

## Started

### Global Workspace Search

- We have already added the persistent top search bar shell.
- Finish the actual search depth and quality across contacts, leads, inbox messages, files, generated documents, quote drafts, and call records.

### Phone and SMS Completion

- Inbound SMS is now wired into Kyro and the Twilio/Vapi foundation is in place.
- Inbound phone, outbound phone, voicemail overflow, and voice-tab Vapi flows have all been attacked and partially tested.
- Finish live-testing hardening, outbound reliability, assistant routing, activity logging, and operator-facing controls.

### Voice and Vocabulary Hardening

- Realtime voice, Vapi voice, pronunciation handling, and phone-assistant prompts have all been attacked.
- Keep tuning interruption/barge-in behaviour, partial transcript UX, latency, assistant prompt quality, escalation rules, and CRM actions that should flow from accepted call summaries.

### Twilio Number and SMS Hardening

- The beta pre-purchased number pool model exists and is documented in `docs/phone-number-pool.md`.
- Replace the beta pool with user-facing Twilio number search, selection, and purchase once signup volume justifies it.
- Automate the full Twilio purchase -> webhook/messaging-service setup -> Vapi phone-number mapping flow while preserving the current `workspace_phone_numbers` model.
- Meter phone-number rental as its own billing category, separate from SMS segments and voice minutes.
- Add workspace operator/staff number rules so SMS from the owner, apprentice, family member, or partner can be treated as internal instructions instead of customer inquiries.
- Harden inbound SMS contact matching, opt-out handling, consent/compliance copy, and delivery-error recovery before public launch.

### Outbound Delivery Operations

- We already have the Developer outbox operations page and the durable outbox foundation.
- Expand it into a future admin/operator console with cross-workspace support, assignment, bulk actions, and richer dead-letter review.
- Decide whether successful retries should reopen/update the original `actions` row or leave the outbox as the delivery source of truth.

### Billing and Payments

- Usage metering, margin visibility, and ledger-style groundwork already exist.
- Add billing-system integration so workspace usage charges can become real customer invoices or payment-provider charges.
- Decide billing periods, billing contacts, tax/GST/VAT handling, payment-provider customer ids, invoice status mapping, and operator review rules before public billing is enabled.
- Keep the current usage export/read-only ledger until a payment provider is selected and tested.
- Add provider-side usage reconciliation jobs, starting with OpenAI totals and later SMS, voice, and image providers, so Kyro can compare provider invoices against `usage_events`.
- Explore user-to-customer/client billing separately from Kyro's own usage billing.

### Assistant External Tools

- The Assistant tool registry, action engine, outbox, audit trail, and richer UI block model already exist.
- Add approval-gated calendar providers once email, SMS, and phone boundaries remain stable in production-like testing.
- Reuse the current tool registry and action engine patterns instead of giving the LLM direct provider access.

### Industry Knowledge and Compliance

- The legislation knowledge-base foundation has been built, including schema, retrieval hooks, and the source-collection guide in `docs/australian-legislation-knowledge-sources.md`.
- Collect and ingest the actual Australian legislation, regulator guidance, licensing references, and state-by-state source material listed in that source guide.
- Add curated Markdown resources for Australian building-industry rules, regulations, licensing, safety requirements, state-by-state legislation, and practical trade compliance guidance.
- Decide how Kyro should cite, version, and refresh those resources so the assistant can answer building-industry questions without pretending to provide legal advice.
- Keep the structure flexible so licensed/paywalled standards can be layered in later without reworking the knowledge-base model.

### Image Generation Hardening

- Image generation, chat rendering, inline previews, popup preview, edit-with-annotation, and save-to-files workflows have all been attacked.
- Promote generated images from private file rows into a richer media gallery/history if one-off visuals become common.
- Add stronger multi-turn image revision controls so users can continue editing a selected image without reattaching everything manually.
- Design the mobile camera-first workflow for renovation photos, inspiration references, and customer-ready render previews.

### Future Channels

- Follow-up reminders already exist at the workspace-default level, and email sync foundations are already in place.
- Add per-inquiry follow-up delay overrides if the global workspace delay proves too blunt.
- Upgrade Gmail/Outlook inbound sync from bounded polling to provider push/watch delivery once polling is stable in production.
- Promote stored inbound email attachments into richer job-file/document records, including Drive sync and user-facing document organisation.
- Add deeper forwarded-message parsing and provider history cursors for messy email chains that do not preserve thread ids or RFC references cleanly.
- Add social DMs and web chat once provider selection, permissions, and audit trails feel solid.

### Mobile and Native Readiness

- The backend is already being shaped so the mobile app can reuse the same APIs and contracts.
- Keep documenting new routes/contracts the mobile app needs.
- Build the native shell around the now-web-tested workflows once Assistant, Inbox, CRM, Voice, and Settings stop moving so much.
- Add mobile-specific offline/error states for field use, especially around voice, inbox triage, and job-site contact details.

### Product Backlog Clearance

- We have already started clearing, merging, and pruning the old backlog as features ship.
- Keep this file current and remove items once they are genuinely finished or intentionally deferred.

### Full Operations Dashboard

- The command-centre dashboard rebuild is now in progress with configurable KPI cards, swappable middle and bottom widgets, a mini Assistant surface, embedded voice, activity/log surfaces, and sidebar/account chrome improvements.
- Finish the drag-like customisation polish, data density tuning, and any final operator widgets once the first real version is live and tested.

### Reports

- The first Reports tab is now built with a horizontal report builder, timeframe/contact/channel/direction filters, explicit generation, browser PDF preview, print, and server-generated PDF download.
- Report outputs use the dedicated business logo where available, falling back to the business name without Kyro branding. Add a proper business-logo setting before relying on logos in customer-facing reports; do not reuse email signature logos.
- Current report types cover all communications, inbound communications, outbound communications, communications by contact, usage ledger, document activity, work queue summary, and a scaffolded payment-history report.
- Keep expanding reports as new durable data exists, especially real payment records, payment status, calendar/appointment history, job outcomes, supplier activity, and richer quote/invoice reporting.
- Payment reports intentionally stay empty until payment processing and customer-collection records ship.

## Not Properly Attacked Yet

### Sidebar Finalization

- Finalize the real tab list first, then add icons and finish the visual/navigation polish.

### Logo and Branding Lock

- Decide the final logo, favicon, app icon, and overall light/dark presentation.

## Notes

- We have already shipped a lot of the core app architecture, so most remaining work is now hardening, finishing, and making production-safe rather than inventing brand-new systems from scratch.
- The biggest areas that have clearly been attacked already are Assistant, CRM, Inbox, image generation, voice, Twilio/Vapi comms, and the legislation knowledge-base foundation.
- The biggest things still sitting in "we know we need it, but have not really built it" territory are final sidebar polish, brand lock, and the deeper payment/billing layer.
