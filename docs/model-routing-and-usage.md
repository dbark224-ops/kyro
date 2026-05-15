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

Current development routing is intentionally simple:

- inquiry triage supports `AI_PROVIDER=stub` and `AI_PROVIDER=ollama`,
- Assistant supports local Ollama through `ASSISTANT_PROVIDER=ollama`,
- both paths record `ai_runs`, `model_route_decisions`, `usage_events`, and `audit_logs`,
- Assistant turns also persist `assistant_threads`, `assistant_messages`, tool-call records, known UI blocks, rolling summaries, and explicit memories,
- the `/usage` page reads the metered ledger for cost and customer-charge visibility,
- cloud model providers are not wired yet.

Provider-specific logic is kept behind `apps/web/src/lib/ai/triage.ts` for inquiry triage
and `apps/web/src/lib/assistant/providers.ts` for Assistant narration so cloud providers
can be added without rewriting the UI.

Local Ollama calls default to `think: false`, bounded `num_predict` values, and a long development timeout. This is
especially important for qwen-style reasoning models, because hidden thinking can be slower than the actual CRM answer
and can trigger timeout fallbacks during development.

Assistant record lookup is deterministic before the model narrates it. For example, "what happened with the Jamie
inquiry?" first resolves exact or partial workspace-scoped inquiry matches, then passes those records to the local model
for a short operator-friendly response. The LLM should not invent search results or render raw links; the frontend renders
known CRM cards from the command result.

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
- Image generation count and size/quality.
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
- Admin dashboards show usage by feature, model, user, and period.
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
