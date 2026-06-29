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

Kyro currently records append-only `usage_events` for AI triage, Assistant work,
inbound-email classification, reply drafting, document-template edits, pronunciation
alias enrichment, Assistant public web-search tool calls, speech-to-text,
text-to-speech, real outbound email sends, Twilio SMS send/receive events, and
completed Vapi/Twilio voice calls when duration or provider cost is available.
The Settings usage/billing view is read-only and customer-facing. It shows:

- total usage charge for the selected period,
- ledger event count,
- usage by task as the first breakdown,
- provider/model/service breakdowns with info bubbles that explain what each model/service is used for,
- a detailed ledger modal for billing checks and export/debug review, including a CSV export of the selected ledger range.

Provider cost and gross margin are still stored in the append-only ledger and can be surfaced for
internal/dev visibility, but they are not the primary customer-facing numbers.

Usage ledger values remain stored in their original currency for auditability, currently USD for
OpenAI-backed usage. User-facing money in the web UI is formatted through the workspace display
currency setting in General settings. The first conversion layer uses placeholder static USD-based
rates and records its provider as `placeholder_static`; it is intentionally separated from stored
billing amounts so a later live provider, such as Stripe FX Quotes, can replace the rate source
without changing `usage_events`.

The usage ledger CSV export includes display charge, display currency, stored charge, stored
currency, exchange rate, and display-rate provider columns. This makes the export readable to users
while retaining enough original data for invoice reconciliation.

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
provider_cost_snapshot = provider units * provider unit cost
customer_charge_snapshot = provider_cost_snapshot * (1 + markup_snapshot)
gross_margin = customer_charge_snapshot - provider_cost_snapshot
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
- Image generation: provider image token usage when returned, otherwise a per-render snapshot with margin.
- Document rendering/storage: bundled up to a threshold, then metered.

## Cost Visibility

Users should eventually see:

- Current billing-period usage.
- Usage by task/feature.
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

Current OpenAI metering behaviour:

- `apps/web/src/lib/usage/openai.ts` normalizes OpenAI Responses usage and legacy
  Chat Completions usage into separate rows for uncached input tokens, cached input
  tokens, visible output tokens, and reasoning tokens.
- Cached input tokens use the cached-input rate where the configured model exposes one.
- Reasoning tokens are stored separately but priced as output tokens so output cost is
  not double-counted.
- OpenAI web-search tool calls are recorded as `web_search_calls` in addition to the
  tokens reported by the model response. Current defaults distinguish non-reasoning
  search calls from reasoning search calls, with an environment override available through
  `OPENAI_WEB_SEARCH_COST_PER_1K_CALLS`.
- OpenAI Realtime voice turns read token usage from the `response.done` event and
  split it into text input, audio input, cached input, text output, audio output,
  and reasoning rows. This keeps live voice costing aligned with the actual
  `gpt-realtime-2` usage rather than a local estimate.
- OpenAI text-to-speech uses direct environment pricing when
  `OPENAI_TTS_UNIT_COST_PER_SECOND_USD` is configured. Otherwise the default
  `gpt-4o-mini-tts` path estimates text-input and audio-output cost from the current
  OpenAI rate card and marks the row metadata as price-estimated.
- OpenAI image generation records one `image_generation` usage event per render/edit. When
  the Image API response includes provider usage, Kyro prices the row from text input
  tokens, image input tokens, cached input tokens if supplied, and output image tokens.
  The token split and cost breakdown are stored in row metadata. If provider usage is
  unavailable, Kyro falls back to `OPENAI_IMAGE_COST_PER_IMAGE` or the snapshotted
  image-quality/size catalog and marks the row as estimated.
- Known OpenAI model prices are snapshotted from the in-app catalog, with environment
  overrides available for production updates:
  `OPENAI_<MODEL>_INPUT_COST_PER_1M`, `OPENAI_<MODEL>_CACHED_INPUT_COST_PER_1M`,
  `OPENAI_<MODEL>_OUTPUT_COST_PER_1M`, or the generic `OPENAI_LLM_*_COST_PER_1M`
  fallbacks.
- Image-generation token prices can be overridden with model-specific keys such as
  `OPENAI_GPT_IMAGE_2_IMAGE_TEXT_INPUT_COST_PER_1M`,
  `OPENAI_GPT_IMAGE_2_IMAGE_INPUT_COST_PER_1M`, and
  `OPENAI_GPT_IMAGE_2_IMAGE_OUTPUT_COST_PER_1M`, or the generic `OPENAI_IMAGE_*`
  fallback keys.
- Realtime voice prices can be overridden independently with
  `OPENAI_<MODEL>_TEXT_INPUT_COST_PER_1M`, `OPENAI_<MODEL>_AUDIO_INPUT_COST_PER_1M`,
  `OPENAI_<MODEL>_TEXT_OUTPUT_COST_PER_1M`, `OPENAI_<MODEL>_AUDIO_OUTPUT_COST_PER_1M`,
  `OPENAI_<MODEL>_CACHED_INPUT_COST_PER_1M`, or the generic
  `OPENAI_REALTIME_*_COST_PER_1M` fallbacks.
- Kyro usage markup is cost-plus. The normal global knob is
  `KYRO_USAGE_MARKUP_RATE`, which defaults to `0.25` (`25%`) when unset.
  `USAGE_MARKUP_RATE` remains supported as a legacy alias. Provider-specific
  markup vars such as `OPENAI_LLM_MARKUP_RATE`, `OPENAI_STT_MARKUP_RATE`,
  `OPENAI_TTS_MARKUP_RATE`, `ELEVENLABS_TTS_MARKUP_RATE`,
  `TWILIO_MARKUP_RATE`, and `GOOGLE_API_MARKUP_RATE` are optional deliberate
  exceptions; leave them blank when the global Kyro margin should apply across
  the board.
- Twilio SMS records `outbound_sms` and `inbound_sms` rows with provider `twilio`
  and service `sms`. Outbound rows use Twilio-returned message price when available,
  otherwise `TWILIO_SMS_OUTBOUND_UNIT_COST_USD`; inbound rows use
  `TWILIO_SMS_INBOUND_UNIT_COST_USD`. `TWILIO_MARKUP_RATE` controls the SMS markup
  snapshot only when set; otherwise the global Kyro usage margin applies.
- Phone-number rental has a pricing seam through `TWILIO_NUMBER_MONTHLY_COST_USD`.
  Vapi/Twilio voice calls record `voice_call` usage rows from completed call
  events, preferring Vapi/Twilio provider cost when supplied and falling back to
  `TWILIO_VOICE_UNIT_COST_USD`-style minute pricing. UI number purchase and final
  voice billing reconciliation remain future hardening.
- Authenticated Google Maps address lookups record `provider_api_calls` rows with
  provider `google` and service `google_maps`. Places autocomplete, place details,
  and Address Validation have separate per-1K-call defaults with optional overrides
  through `GOOGLE_PLACES_AUTOCOMPLETE_COST_PER_1K_CALLS`,
  `GOOGLE_PLACES_DETAILS_COST_PER_1K_CALLS`,
  `GOOGLE_ADDRESS_VALIDATION_COST_PER_1K_CALLS`, or generic
  `GOOGLE_API_COST_PER_1K_CALLS`. `GOOGLE_API_MARKUP_RATE` controls the Google
  markup only when set; otherwise the global Kyro usage margin applies.
  Pre-account signup autocomplete is not recorded in the workspace ledger because
  no workspace exists yet.
- Local Ollama/stub usage is still metered with token counts where available, but
  provider cost and customer charge are `0` because there is no provider invoice.

Before public launch, billing periods should be finalized into immutable invoice/charge
records, the pricing catalog should be reviewed against the live provider pricing page, and
a provider reconciliation job should compare Kyro's `usage_events` with provider-side usage
exports or organization usage APIs for OpenAI and any later SMS/voice/image providers.

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
