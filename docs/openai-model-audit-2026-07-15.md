# OpenAI Model Audit - 2026-07-15

## Summary

Kyro had several active text workflows still defaulting to `gpt-4.1-mini`. The
OpenAI model catalog now positions the GPT-5.6 family as the current default
choice for text/reasoning work:

- `gpt-5.6-sol` for strongest capability and action planning.
- `gpt-5.6-terra` for the main intelligence/cost balance.
- `gpt-5.6-luna` for high-volume, cost-sensitive background work.

Kyro now uses those tiers through the shared `@kyro/ai` model router and adds
explicit `reasoning.effort` values to live Responses API calls.

## Routing Decisions

| Kyro workload                  | Default model            | Default reasoning         | Notes                                                                                                 |
| ------------------------------ | ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Assistant final answer         | `gpt-5.6-terra`          | `low`                     | User-facing, needs quality but must stay snappy.                                                      |
| Assistant tool planner         | `gpt-5.6-sol`            | `low`                     | The planner decides whether Kyro should use tools or take action.                                     |
| Reply drafting                 | `gpt-5.6-terra`          | `low`                     | Customer-facing writing with missing-info rules.                                                      |
| Reply repair loop              | `gpt-5.6-luna`           | `low`                     | Guardrail pass; still metered as normal LLM usage.                                                    |
| Inbound triage                 | `gpt-5.6-luna`           | `low`                     | Background classification/extraction.                                                                 |
| Inbound email classification   | `gpt-5.6-luna`           | `low`                     | Background classification/extraction.                                                                 |
| Web search synthesis           | `gpt-5.6-terra`          | `low`                     | Needs sourced public answer quality.                                                                  |
| Document/template edits        | `gpt-5.6-terra`          | `medium`                  | Longer structured edits benefit from more reasoning.                                                  |
| Prompt suggestions             | `gpt-5.6-luna`           | `none`                    | Simple, low-value helper generation.                                                                  |
| Pronunciation alias enrichment | `gpt-5.6-luna`           | `none`                    | Conservative helper extraction.                                                                       |
| Web realtime voice             | `gpt-realtime-2.1`       | Provider realtime default | Specialized realtime model family.                                                                    |
| Image generation/editing       | `gpt-image-2`            | N/A                       | Specialized image model family.                                                                       |
| Speech to text                 | `gpt-4o-mini-transcribe` | N/A                       | Specialized transcription model.                                                                      |
| Text to speech fallback        | `gpt-4o-mini-tts`        | N/A                       | Existing fallback TTS path; catalog marks this as deprecated, so revisit before scaling fallback TTS. |

## Production Notes

- Avoid setting global `OPENAI_MODEL` unless intentionally overriding every text
  tier.
- Prefer task-specific overrides such as `OPENAI_REPLY_DRAFT_MODEL` or
  `OPENAI_TRIAGE_MODEL` only when a measured issue appears.
- Reasoning effort can be tuned with `OPENAI_*_REASONING_EFFORT` variables. Use
  `low` for normal latency-sensitive work, `medium` for structured document
  edits, and reserve `high`, `xhigh`, `max`, or `reasoning.mode=pro` for a
  measured quality problem.
- The usage ledger now knows the GPT-5.6 Sol/Terra/Luna price snapshots and will
  price reasoning tokens as output tokens, matching the existing metering model.
- GPT-5.6 cached-input discounts were not included in the model table used for
  this audit, so the built-in GPT-5.6 price snapshots conservatively price
  cached input at normal input cost unless overridden through env vars.

## Follow-Up

- Confirm production Vercel env vars do not still force old GPT-4.1 defaults.
- Run a smoke test for: assistant action planning, inbox reply draft, inbound
  email classification, calendar-event creation, web search, document template
  edit, and web realtime voice.
- Revisit fallback TTS before high-volume voice playback because the model
  catalog now labels `gpt-4o-mini-tts` deprecated.
