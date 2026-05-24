# Kyro V1 Implementation Plan

## Phase 0: Foundation Decisions

Goal: define the product rails before app code grows around bad assumptions.

- Lock stack: Next.js, TypeScript, Supabase, Drizzle, Trigger.dev, OpenAI.
- Create tenant model.
- Define web/iOS API-first client strategy.
- Define workspace policies.
- Define event and action lifecycle.
- Define audit logging rules.
- Define model routing and usage metering rules.
- Define usage-based pricing, markup, and budget rules.

## Phase 1: App and Backend Skeleton

Goal: create the running app shell and backend service boundaries.

- Scaffold Next.js app.
- Create shared API contract package.
- Add auth.
- Add workspace creation and switching.
- Add database migrations.
- Add shared validation schemas.
- Add backend service modules:
  - `workspace`
  - `entitlements`
  - `model-router`
  - `usage`
  - `billing`
  - `pricing`
  - `contacts`
  - `leads`
  - `conversations`
  - `events`
  - `actions`
  - `ai`
  - `files`
  - `documents`

## Phase 2: Core Business Memory

Goal: make Kyro remember the business properly.

- Business profile.
- Contacts.
- Leads.
- Conversations.
- Messages.
- Tasks.
- Files.
- Audit logs.

## Phase 3: Event and Action Engine

Goal: every side effect flows through one controlled system.

- Event ingestion table.
- Workflow runner setup.
- Action table.
- Action executor registry.
- Approval queue.
- Outbound policy checks.
- Audit logs for all action transitions.

Action statuses:

- `requested`
- `pending_approval`
- `approved`
- `executing`
- `completed`
- `failed`
- `cancelled`

## Phase 4: AI Orchestration

Goal: add useful AI without giving it unbounded authority.

- AI run records.
- Model router and route decision records.
- Usage event records for every AI/provider call.
- Pricing snapshots and customer charge snapshots on usage events.
- Structured extraction for inbound messages.
- Lead triage prompt and schema.
- Retrieval over business profile and knowledge chunks.
- Chat assistant endpoint.
- Tool-call adapter that creates actions instead of directly causing side effects.

## Phase 5: Gmail Ingestion

Goal: prove the main product loop.

- Google OAuth.
- Gmail integration setup.
- Push notification endpoint.
- Message fetch and normalization.
- Contact matching.
- Conversation threading.
- AI triage.
- Draft/send reply actions.

## Phase 6: Web Lead Ingestion

Goal: support website enquiries without depending on email.

- Workspace webhook endpoint.
- Form payload validation.
- Spam/source metadata.
- Contact and lead creation.
- Shared AI triage workflow.

## Phase 7: Documents

Goal: generate and save user-instructed documents from templates.

- Template upload/creation.
- Template versioning.
- Field schema per template.
- Generate document action.
- Render to PDF.
- Save generated file.
- Attach generated file to outbound communication through action system.
- Let Assistant/Voice prepare reviewable quote-send emails with generated PDFs attached, while keeping final sending approval-gated.
- Issue secure customer approval links for quote drafts.
- Let customers approve or request changes from a no-login tokenized page.
- Record customer view/approval/change-request events in quote history and reopen the linked inquiry when changes are requested.

V1 document generation is not accounting. No payments, ledgers, reconciliation, or tax engine.

## Phase 8: SMS and Overflow Calls

Goal: add high-value communication channels without building a call center.

- SMS provider setup.
- Consent/compliance state.
- Send SMS action.
- Twilio Voice webhook.
- Overflow answer rules.
- Transcript capture.
- Summary and lead/task creation.

## Phase 9: Images

Goal: add image generation/editing as an attached AI artifact capability.

- Upload image.
- Generate/edit image action.
- Store output file.
- Attach to outbound communication through action system.

## Phase 10: Native iOS App

Goal: provide native mobile access to the same Kyro workspace data and actions.

- Consume shared API contracts.
- Sign in to existing workspaces.
- Inbox, leads, contacts, assistant chat, and approvals.
- Push notifications.
- Camera/photo upload.
- Native review/send flows.
- Entitlement-aware UI without mobile checkout by default.

## First Sprint

The first sprint should produce:

- Running Next.js app.
- Shared API contract package.
- Supabase project configured locally.
- Initial schema migrations.
- Workspace onboarding.
- Basic dashboard shell.
- Contacts/leads/conversations/messages tables.
- Events/actions/audit tables.
- Model route and usage event tables.
- Pricing and budget tables.
- Entitlement tables.
- A stub action executor.
- A stub AI run recorder.
- A stub model router.
- A stub usage recorder.

Do not start with Gmail OAuth. Start with the internal data and action shape, then integrate Gmail into it.

## Current Working Sprint

The app has moved beyond the first mock-inquiry loop. Current implemented workflow:

- Manually ingest a mock inquiry.
- Match or create a workspace-scoped contact profile.
- Create a lead, conversation, and inbound message.
- Run AI triage through deterministic stub or local Ollama.
- Save editable inquiry facts.
- Record AI runs, model routing decisions, usage events, and audit logs.
- Propose action cards for replies, missing info, site visits, quote drafts, follow-ups, and not-fit decisions.
- Review and edit the inquiry from `/inbox/[conversationId]`.
- Edit draft replies before approval.
- Approve/execute dry-run outbound messages.
- Record mock follow-up inbound messages.
- Create and edit internal quote drafts from user-created reusable templates.
- Prepare reviewable quote emails with server-generated PDF attachments from Documents, Assistant, or Voice.
- Review and edit contact profiles from `/contacts/[contactId]`.
- Use the Assistant page as a safe command layer over CRM data.
- Persist Assistant threads, messages, known UI blocks, deterministic tool-call records, rolling summaries, and explicit long-term memories.
- Review usage and pricing posture from `/usage`.

Next recommended build area:

- Deepen the mock workflow around documents and outbound attachments.
- Expand the Assistant tool registry only through known backend tools and known frontend block types.
- Keep real Gmail/Outlook/SMS OAuth out until the internal message/action/document loop feels right.
- Add richer operator controls where the app already records clean state, rather than widening external integrations too early.
