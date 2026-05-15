# Usage-Based Billing

## Product Goal

Kyro should support usage-based account billing because heavy daily-driver users may create
material AI, SMS, voice, image, storage, and document-rendering costs.

A single flat App Store subscription is a poor fit for this business if one customer uses
five dollars of infrastructure and another uses one hundred dollars.

## Recommended Pricing Shape

Use web-based billing with:

- A base subscription or platform fee.
- Metered usage charges.
- Markup/margin rules by service category.
- Budget controls and usage visibility.
- Workspace-level invoices.

The exact pricing can change later, but the backend should assume usage has to be tracked,
priced, limited, and explained.

## Current Implementation

Kyro currently records append-only `usage_events` for AI triage and Assistant work.
The Settings billing view is read-only and shows:

- provider cost,
- customer charge,
- gross margin,
- provider/model/service breakdowns,
- per-user usage,
- source links back into the CRM where possible.

No payment provider, invoice collection, tax handling, bookkeeping, or reconciliation is wired yet.

The first backend billing read endpoint is:

```text
GET /api/billing/usage
```

Supported query parameters:

- `period=monthly` for the UTC calendar month containing `anchor` or today.
- `period=weekly` for the UTC Monday-Sunday week containing `anchor` or today.
- `period=custom&start=<iso>&end=<iso>` for an explicit billing range.
- `anchor=<iso>` to calculate a weekly/monthly period around a specific date.
- `userId=<uuid>` to return the period total for one user only.

The response is read-only and returns workspace totals plus per-user totals. A future
payment integration should consume the returned `customerChargeMinorUnits` values,
or the decimal `customerCharge` values if the provider expects decimal amounts.

## Billing Formula

For each usage event:

```text
customer_charge = provider_cost_snapshot + kyro_markup
```

Markup can be configured by:

- Service category.
- Provider.
- Model tier.
- Workspace plan.
- Promotional/manual override.

Examples:

- LLM usage: provider cost plus percentage margin.
- SMS: provider segment cost plus percentage or fixed markup.
- Voice: provider minute cost plus margin.
- Image generation: per-render charge with margin.
- Document rendering/storage: bundled up to a threshold, then metered.

## Cost Visibility

Users should eventually see:

- Current billing-period usage.
- Usage by feature.
- Usage by user.
- AI/model usage.
- SMS/voice usage.
- Estimated current invoice.
- Budget warnings.

This reduces surprise bills and builds trust.

## Margin Controls

Kyro should support:

- Default markup rules.
- Plan-specific markup rules.
- Service-specific minimum charges.
- Internal cost snapshots.
- Customer-facing charge snapshots.
- Manual credits/adjustments later.

Do not calculate customer charges from live provider pricing at invoice time. Store the
pricing snapshot when the usage event is created.

Current development values:

- AI triage cloud-model placeholders use `$0.00000015` per input token.
- AI triage cloud-model placeholders use `$0.0000006` per output token.
- Kyro markup is currently `25%`.
- Local Ollama usage is metered with estimated tokens but provider cost and customer
  charge are `0` while testing.

Those values are intentionally simple placeholders. Before public launch, pricing should
move behind configurable pricing rules per provider/model/service, and billing periods
should be finalized into immutable invoice/charge records.

## Budget Controls

Each workspace should support:

- Soft monthly budget.
- Hard monthly cap.
- Alert thresholds.
- Per-user caps.
- Per-service caps.
- Auto-downgrade model tier after threshold.
- Require approval above estimated action cost.

V1 can start with data support and admin-visible totals. Enforcement can become stricter
as billing goes live.

## App Store Implication

Usage-based billing strengthens the case for web-first billing.

The iOS app should be a free client for existing accounts and should read entitlement and
budget state from the backend. It should not try to mirror complex metered billing through
one-size-fits-all App Store subscriptions.
