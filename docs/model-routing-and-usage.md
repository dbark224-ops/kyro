# Model Routing and Usage Metering

## Product Goal

Kyro should feel like one always-available AI assistant, but the backend should use the
right model and provider for each task.

Some tasks need strong reasoning and careful judgment. Other tasks need cheap, fast,
repeatable processing. The user should not see this machinery. They should experience
one assistant with consistent memory, tone, and permissions.

## Core Rule

Do not hard-code model names throughout the app.

Every AI call should go through a model router that receives:

- Workspace.
- User.
- Task type.
- Risk level.
- Required capabilities.
- Latency target.
- Expected context size.
- Budget policy.
- Input references.

The router returns a provider/model/config choice and records why it was chosen.

## Current Implementation

Current routing is intentionally simple but production-shaped:

- inquiry triage supports `AI_PROVIDER=stub`, `AI_PROVIDER=ollama`, and OpenAI,
- Assistant supports OpenAI by default and local Ollama through `ASSISTANT_PROVIDER=ollama` for development,
- both paths record `ai_runs`, `model_route_decisions`, `usage_events`, and `audit_logs`,
- Assistant turns also persist `assistant_threads`, `assistant_messages`, tool-call records, known UI blocks, rolling summaries, and explicit memories,
- on OpenAI Assistant routes, a lightweight LLM tool planner decides whether the turn needs a Kyro tool before any deterministic keyword router runs,
- the Usage settings section reads the metered ledger for customer-facing usage charge, task breakdowns, provider/model explanations, and detailed ledger review,
- OpenAI Responses usage is normalized through `apps/web/src/lib/usage/openai.ts` so uncached input tokens,
  cached input tokens, visible output tokens, reasoning tokens, and web-search tool calls are tracked separately.
- OpenAI Realtime voice usage is also normalized through the same helper so text, audio,
  cached, and reasoning token rows are priced with the realtime rate card instead of
  the general text-model estimate.
- OpenAI text-to-speech usage is recorded as usage rows too. When direct audio-token
  usage is not returned, Kyro uses a pricing-derived estimate and marks that row as
  estimated in metadata.
- OpenAI image generation is metered as a single image usage row, but the row prefers
  provider-returned image token usage for pricing when OpenAI supplies it. The metadata
  stores text input tokens, image input tokens, output image tokens, cost method, pricing
  source, and token cost breakdown.

Provider-specific logic is kept behind `apps/web/src/lib/ai/triage.ts` for inquiry triage,
`apps/web/src/lib/assistant/providers.ts` for Assistant narration, and shared usage helpers
under `apps/web/src/lib/usage/openai.ts` so provider pricing/accounting can evolve without
rewriting the UI.

Local Ollama calls default to `think: false`, bounded `num_predict` values, and a long development timeout. This is
especially important for qwen-style reasoning models, because hidden thinking can be slower than the actual CRM answer
and can trigger timeout fallbacks during development.

Assistant tool use is LLM-first but code-executed. For example, "what happened with the Jamie inquiry?" is first sent to
the OpenAI planner with compact recent context. The planner can choose the inquiry lookup tool, no tool for normal chat,
or an image-generation edit when the user says "make it nighttime" after a generated image. Kyro's deterministic code then
validates and executes the chosen tool against workspace-scoped data, records the decision and usage, and gives the
result back to the narration model. The older keyword router remains as a degraded-mode fallback when the planner is
unavailable or the Assistant is running against local Ollama. The LLM should not invent search results or render raw
links; the frontend renders known CRM cards from the executed tool result.

## Task Classes

### Low-Cost Processing

Use cheaper/faster models for:

- Email classification.
- Lead field extraction.
- Message sentiment and urgency scoring.
- Duplicate detection assistance.
- Knowledge chunk labeling.
- Short summaries.
- Template field prefill.

### Mid-Tier Assistant Work

Use balanced models for:

- Normal assistant chat.
- Drafting replies.
- Summarizing longer conversation history.
- Preparing action proposals.
- Generating document field values.

### High-Capability Reasoning

Use stronger models for:

- Complex multi-step user requests.
- High-value outbound communications.
- Ambiguous lead triage.
- Policy-sensitive actions.
- Tool/action planning.
- Recovery from failed workflows.
- Important document generation.

### Specialized Models

Use specialized providers or endpoints for:

- Embeddings.
- Speech-to-text.
- Text-to-speech.
- Image generation/editing.
- OCR/document parsing.

## Model Router Responsibilities

- Select model/provider per task.
- Enforce workspace budget settings.
- Enforce model allowlists and denylists.
- Apply fallback rules when a provider fails.
- Apply escalation rules when confidence is low.
- Attach model choice to `ai_runs`.
- Create metered usage events for every provider call.
- Preserve a cost/pricing snapshot for billing history.

## Agent Feel Without Agent Fragility

Kyro can feel like an always-on agent by presenting a single assistant identity and a live
activity feed. Internally, the system remains event-driven:

- Inbound events trigger workflows.
- Workflows call the model router.
- Model outputs create proposed or executable actions.
- Actions pass policy checks.
- Audit logs and usage events are recorded.

The assistant experience is continuous. The backend remains inspectable.

## Usage Metering Principles

Usage tracking must be append-only and traceable.

Every billable provider call should produce a usage event tied to:

- Workspace.
- User when applicable.
- Integration/provider.
- Model or service.
- AI run.
- Workflow run.
- Action.
- Source feature.

The system should store raw usage units and calculated cost snapshots. Do not rely on
current provider pricing to recalculate historical bills.

## Metered Usage Types

Track at minimum:

- LLM input tokens.
- LLM output tokens.
- Cached input tokens if available.
- Reasoning tokens if available.
- Embedding tokens.
- Image generation count, size/quality, and provider-returned text/image token usage where available.
- Speech-to-text minutes.
- Text-to-speech characters or seconds.
- SMS segments.
- Voice call minutes.
- Document render count/pages.
- Storage bytes.

## Billing Direction

V1 should not require a complete billing engine, but the data model should support one.

Recommended first billing posture:

- Usage is metered per workspace and user.
- Costs are calculated using stored price snapshots.
- Customer charges are calculated using stored markup/price snapshots.
- Admin/customer dashboards show usage by task/feature, model, user, and period.
- Stripe billing can be added later using the metered usage ledger.

## Budget and Safety Controls

Each workspace should eventually support:

- Monthly budget cap.
- Alert threshold.
- Hard stop threshold.
- Per-user usage limits.
- Per-feature usage limits.
- Allowed model tiers.
- Require approval above estimated action cost.
- Auto-switch to cheaper models after defined usage thresholds.

V1 only needs the data shape and basic enforcement hooks.
