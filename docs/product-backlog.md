# Product Backlog

This is the parking lot for useful ideas that are still not part of the current Kyro architecture. Items that have now shipped, such as Gmail/Outlook email, the durable outbox, quote draft/send flows, realtime voice, pronunciation settings, inbound sync controls, CRM identity normalization, CRM profile resolution/merge, contact lifecycle review, inbox task/appointment/note workflows, automatic internal follow-up reminders, Assistant memory suggestions, Assistant thread switching/archive, richer Assistant UI blocks, the Assistant tool registry, and outbound reply style prompting have been removed or narrowed here.

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
- Add customer-facing outbound voice/call preflight rules before phone providers are connected.

## Assistant External Tools

- Add real approval-gated external SMS, phone, and calendar providers once email send/receive boundaries remain stable in production-like testing.
- Reuse the Assistant tool registry, action engine, outbox/audit trail, and known UI block model for those external tools instead of giving the LLM direct provider access.

## Image Generation Hardening

- Promote generated images from private file rows into a richer media gallery/history if one-off visuals become common.
- Add multi-turn image revision controls so users can pick a generated image and ask for a follow-up edit without reattaching context.
- Design the mobile camera-first workflow for renovation photos, inspiration references, and customer-ready render previews.

## Future Channels

- Add per-inquiry follow-up delay overrides if the global workspace follow-up delay proves too blunt in real use.
- Upgrade Gmail/Outlook inbound sync from bounded polling to provider push/watch delivery once the polling path is stable in production.
- Promote stored inbound email attachments into richer job-file/document records, including Drive sync and user-facing document organisation.
- Add deeper forwarded-message parsing and provider history cursors for edge-case email chains that do not preserve provider thread ids or RFC references cleanly.
- Add SMS, social DMs, and web chat now that email send/receive behavior exists, after provider selection, permission boundaries, and audit trails feel solid.

## Mobile And Native Shell

- Build the native iOS shell around the web-tested workflows once Assistant, Inbox, CRM, Voice, and Settings have settled enough to avoid rework.
- Add mobile-specific offline/error states for field use, especially around voice, inbox triage, and job-site contact details.
