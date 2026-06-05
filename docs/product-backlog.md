# Product Backlog

This is the parking lot for useful ideas that are still not part of the current Kyro architecture. Items that have now shipped, such as Gmail/Outlook email, the durable outbox, the first Twilio SMS send/receive foundation, the first Vapi/Twilio phone-call ledger foundation, quote draft/send flows, realtime voice, pronunciation settings, inbound sync controls, CRM identity normalization, CRM profile resolution/merge, contact lifecycle review, inbox task/appointment/note workflows, automatic internal follow-up reminders, Assistant memory suggestions, Assistant thread switching/archive, richer Assistant UI blocks, the Assistant tool registry, and outbound reply style prompting have been removed or narrowed here.

## Outbound Delivery Operations

- Expand the Developer outbox operations page into a future admin/operator console with cross-workspace support, assignment, bulk actions, and richer dead-letter review.
- When a scheduled retry succeeds for a previously failed action, decide whether to reopen/update the original `actions` row or keep the outbox as the source of truth for delivery recovery.

## Billing Integration

- Add billing-system integration so workspace usage charges can become real customer invoices or payment-provider charges.
- Decide billing periods, billing contacts, tax/GST/VAT handling, payment-provider customer ids, invoice status mapping, and operator review rules before public billing is enabled.
- Keep the current read-only usage export as the source ledger until a payment provider is selected and tested.
- Add provider-side usage reconciliation jobs before public billing, starting with OpenAI organization usage exports/API totals and later SMS/voice/image providers, so Kyro can compare provider invoices against `usage_events` by period, provider, model, service, and request id where available.

## Voice and Vocabulary

- Keep tuning realtime voice for mobile, especially interruption/barge-in behavior, partial audio UX, and lower-latency model routing.
- Harden Vapi phone assistants after live testing, including final assistant prompts, voicemail overflow transfer rules, outbound-call preflight checks, recording retention policy, and escalation rules for urgent jobs.
- Add richer CRM actions from phone-call transcripts, such as automatically creating inquiry facts, follow-up tasks, and conversation messages after a call summary is accepted.

## Assistant External Tools

- Add approval-gated calendar providers once email/SMS/phone boundaries remain stable in production-like testing.
- Reuse the Assistant tool registry, action engine, outbox/audit trail, and known UI block model for those external tools instead of giving the LLM direct provider access.

## Industry Knowledge And Compliance

- Collect and ingest the Australian legislation, regulator guidance, licensing references, and state-by-state source material listed in `docs/australian-legislation-knowledge-sources.md` so the new knowledge-base foundation has real content to retrieve from.
- Add curated Markdown resources for Australian building-industry rules, regulations, licensing, safety requirements, state-by-state legislation, and practical trade compliance guidance.
- Decide how Kyro should cite, version, and refresh those resources so the assistant can answer building-industry questions without pretending to provide legal advice.
- Add a retrieval layer that can surface the relevant jurisdiction-specific material before Kyro drafts customer replies, quotes, or internal guidance that touches regulated work.

## Twilio Number And SMS Hardening

- Replace the beta pre-purchased number pool with user-facing Twilio number search/selection/purchase once signup volume justifies automatic provisioning.
- Automate the full Twilio purchase -> webhook/messaging-service setup -> Vapi phone-number mapping flow while preserving the current `workspace_phone_numbers` assignment model.
- Meter phone-number rental as its own usage/billing category, separate from SMS segments and Vapi/Twilio voice minutes.
- Add workspace operator/staff number rules so SMS from the business owner, apprentice, family member, or partner can be treated as internal instructions instead of customer inquiries.
- Harden inbound SMS contact matching, opt-out handling, consent/compliance copy, and delivery-error recovery before public launch.

## Image Generation Hardening

- Promote generated images from private file rows into a richer media gallery/history if one-off visuals become common.
- Add multi-turn image revision controls so users can pick a generated image and ask for a follow-up edit without reattaching context.
- Design the mobile camera-first workflow for renovation photos, inspiration references, and customer-ready render previews.

## Future Channels

- Add per-inquiry follow-up delay overrides if the global workspace follow-up delay proves too blunt in real use.
- Upgrade Gmail/Outlook inbound sync from bounded polling to provider push/watch delivery once the polling path is stable in production.
- Promote stored inbound email attachments into richer job-file/document records, including Drive sync and user-facing document organisation.
- Add deeper forwarded-message parsing and provider history cursors for edge-case email chains that do not preserve provider thread ids or RFC references cleanly.
- Add social DMs and web chat after provider selection, permission boundaries, and audit trails feel solid.

## Mobile And Native Shell

- Build the native iOS shell around the web-tested workflows once Assistant, Inbox, CRM, Voice, and Settings have settled enough to avoid rework.
- Add mobile-specific offline/error states for field use, especially around voice, inbox triage, and job-site contact details.
