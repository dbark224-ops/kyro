# Kyro V1 Data Model

All tenant-owned tables must include `workspace_id`.
All important side effects must create audit logs.

Schema source of truth: `packages/db/src/schema.ts`.

This document separates current implemented tables from planned later tables.
Planned later tables are marked as planned and are not available in the current database yet.
The current implemented schema includes identity/workspace, CRM, files, events/actions,
AI/model routing, Assistant memory, quote drafts, inquiry facts, usage/pricing/budget,
entitlements, and audit logs.

## Identity and Tenant Model

### `users`

- `id`
- `email`
- `name`
- `created_at`

### `workspaces`

- `id`
- `name`
- `slug`
- `owner_user_id`
- `created_at`
- `updated_at`

### `workspace_members`

- `id`
- `workspace_id`
- `user_id`
- `role`
- `created_at`

### `business_profiles`

- `id`
- `workspace_id`
- `business_name`
- `industry`
- `description`
- `service_area`
- `tone_of_voice`
- `default_reply_instructions`
- `created_at`
- `updated_at`

## Integrations and Channels

### `integrations` planned

- `id`
- `workspace_id`
- `provider`
- `status`
- `scopes`
- `external_account_id`
- `access_token_encrypted`
- `refresh_token_encrypted`
- `token_expires_at`
- `sync_cursor`
- `created_at`
- `updated_at`

### `channels`

- `id`
- `workspace_id`
- `integration_id`
- `type`
- `display_name`
- `external_id`
- `status`
- `settings`
- `created_at`
- `updated_at`

## CRM Core

### `contacts`

- `id`
- `workspace_id`
- `name`
- `email`
- `phone`
- `company`
- `contact_type`
- `address`
- `source`
- `notes`
- `tags`
- `created_at`
- `updated_at`

### `leads`

- `id`
- `workspace_id`
- `contact_id`
- `source`
- `title`
- `description`
- `status`
- `priority`
- `estimated_value`
- `service_type`
- `next_step`
- `created_at`
- `updated_at`

### `conversations`

- `id`
- `workspace_id`
- `channel_id`
- `contact_id`
- `lead_id`
- `external_thread_id`
- `status`
- `last_message_at`
- `created_at`
- `updated_at`

### `messages`

- `id`
- `workspace_id`
- `conversation_id`
- `channel_id`
- `contact_id`
- `direction`
- `subject`
- `body_text`
- `body_html`
- `external_message_id`
- `sent_at`
- `received_at`
- `metadata`
- `created_at`

### `message_attachments` planned

- `id`
- `workspace_id`
- `message_id`
- `file_id`
- `external_attachment_id`
- `content_type`
- `created_at`

## Events, Actions, and Workflows

### `events`

- `id`
- `workspace_id`
- `type`
- `source`
- `idempotency_key`
- `payload`
- `status`
- `processed_at`
- `created_at`

### `actions`

- `id`
- `workspace_id`
- `type`
- `status`
- `requested_by`
- `requested_by_ai_run_id`
- `approval_required`
- `approved_by_user_id`
- `approved_at`
- `executed_at`
- `target_type`
- `target_id`
- `input`
- `result`
- `policy_snapshot`
- `error`
- `created_at`
- `updated_at`

### `tasks` planned

- `id`
- `workspace_id`
- `contact_id`
- `lead_id`
- `conversation_id`
- `title`
- `description`
- `status`
- `due_at`
- `created_by_action_id`
- `created_at`
- `updated_at`

### `ai_runs`

- `id`
- `workspace_id`
- `user_id`
- `mode`
- `task_type`
- `risk_level`
- `provider`
- `model`
- `model_route_id`
- `status`
- `input_refs`
- `output`
- `tool_calls`
- `usage`
- `estimated_cost`
- `actual_cost`
- `latency_ms`
- `error`
- `created_at`
- `completed_at`

### `model_routes`

- `id`
- `workspace_id`
- `name`
- `task_type`
- `risk_level`
- `provider`
- `model`
- `fallback_provider`
- `fallback_model`
- `settings`
- `is_active`
- `created_at`
- `updated_at`

### `model_route_decisions`

- `id`
- `workspace_id`
- `user_id`
- `ai_run_id`
- `task_type`
- `risk_level`
- `selected_provider`
- `selected_model`
- `fallback_used`
- `decision_reason`
- `budget_snapshot`
- `created_at`

### `workflow_runs`

- `id`
- `workspace_id`
- `event_id`
- `workflow_name`
- `status`
- `attempt_count`
- `started_at`
- `completed_at`
- `error`

## Assistant Memory

### `assistant_threads`

- `id`
- `workspace_id`
- `user_id`
- `title`
- `status`
- `summary`
- `summary_updated_at`
- `metadata`
- `created_at`
- `updated_at`

### `assistant_messages`

- `id`
- `workspace_id`
- `thread_id`
- `user_id`
- `ai_run_id`
- `role`
- `content`
- `intent`
- `provider`
- `model`
- `tool_calls`
- `ui_blocks`
- `metadata`
- `created_at`

`ui_blocks` stores known renderable blocks such as link cards and memory notices. The LLM does not store arbitrary HTML.

### `assistant_memories`

- `id`
- `workspace_id`
- `user_id`
- `source_thread_id`
- `source_message_id`
- `memory_type`
- `content`
- `status`
- `confidence`
- `tags`
- `metadata`
- `last_used_at`
- `created_at`
- `updated_at`

Current long-term memory capture is explicit only. A memory is saved when the user uses instructions such as "remember..." or "for future...".

## Knowledge and Files

### `files`

- `id`
- `workspace_id`
- `storage_bucket`
- `storage_path`
- `filename`
- `content_type`
- `size_bytes`
- `source`
- `created_at`

### `knowledge_documents` planned

- `id`
- `workspace_id`
- `file_id`
- `title`
- `type`
- `status`
- `metadata`
- `created_at`
- `updated_at`

### `knowledge_chunks` planned

- `id`
- `workspace_id`
- `knowledge_document_id`
- `chunk_index`
- `text`
- `embedding`
- `metadata`
- `created_at`

## Calls planned

### `call_records` planned

- `id`
- `workspace_id`
- `channel_id`
- `contact_id`
- `lead_id`
- `provider`
- `external_call_id`
- `from_number`
- `to_number`
- `started_at`
- `ended_at`
- `duration_seconds`
- `recording_file_id`
- `status`
- `created_at`

### `call_transcripts` planned

- `id`
- `workspace_id`
- `call_record_id`
- `transcript_text`
- `summary`
- `extracted_fields`
- `created_by_ai_run_id`
- `created_at`

## Documents

### `quote_drafts`

- `id`
- `workspace_id`
- `contact_id`
- `lead_id`
- `conversation_id`
- `source_action_id`
- `title`
- `status`
- `line_items`
- `notes`
- `metadata`
- `created_at`
- `updated_at`

Current quote draft statuses used by the app:

- `approved`
- `changes_requested`
- `draft`
- `ready`
- `sent`
- `archived`

Quote drafts are the structured source of truth for quote-style documents. The
current customer output can be rendered from `quote_drafts` as print-ready HTML
or as a server-generated PDF at request/send time. Browser save-to-PDF remains
available from the print view, and `/documents/[quoteDraftId]/pdf` streams a PDF
generated from the same structured quote data.

Generated-document state is metadata-first for now. When the user prepares a
quote send, Kyro stores `metadata.lastGeneratedDocument` with the PDF filename,
content type, byte size, renderer, generation timestamp, and content hash.
`metadata.documentHistory` records lightweight `pdf_generated`, `email_prepared`,
`email_sent`, `customer_viewed`, `customer_approved`, and
`customer_changes_requested` events so the quote page and Assistant can explain what happened.
Each event can carry `quoteVersion`, and generated document metadata also includes
the active version used to render or send that artifact.
When the email is sent, outbound message metadata records the PDF attachment
summary and the quote draft metadata records sent timestamps, provider/message ids,
the outbound message id, and an `email_sent` history event. The binary PDF is
generated on demand for download and send rather than being stored in Supabase
Storage or Drive yet. Durable generated file rows, Drive storage, invoice exports,
and accounting/payment records remain planned
later work.

Current revision state is stored inside `quote_drafts.metadata.quoteRevision`
rather than in a separate table. The object tracks `currentVersion`, the latest
pending or resolved customer change request, prepared/sent/approved versions, and
timestamps. New quote drafts start at version 1. Customer change requests mark the
quote `changes_requested` and record the request against the active version. The
next material edit after that request increments the draft to the next version and
resolves the request. Preparing or sending the revised quote records the active
version on document history and uses a fresh approval link.

### `quote_approval_links`

- `id`
- `workspace_id`
- `quote_draft_id`
- `token_hash`
- `status`
- `customer_email`
- `expires_at`
- `viewed_at`
- `approved_at`
- `changes_requested_at`
- `last_change_request`
- `metadata`
- `created_at`
- `updated_at`

Quote approval links are tokenized customer-review links for quote drafts.
The raw token is only used in the customer URL; the database stores a SHA-256
hash so a copied database row is not itself a usable approval link. The web app
uses the service-role server client to load a link by token hash on
`/quote/approve/[token]`; the table is not granted to `anon`. Authenticated
workspace members can create/update links through the normal RLS policies.

Current quote approval link statuses:

- `active`
- `approved`
- `changes_requested`
- `revoked`

Creating a fresh approval link revokes older active links for the same quote
draft. Customer approval marks the linked quote draft `approved`. Customer
change requests mark the quote draft `changes_requested`, store the latest
request text on the link, and create a portal-origin inbound message on the
linked conversation when one exists. Those events also update
`quote_drafts.metadata.quoteRevision`, so the inbox and Assistant can show that a
revision is required before the next customer send.

Opening a draft from a reusable document template does not immediately create a
`quote_drafts` row. The `/documents/new?templateKey=...` editor is temporary;
the row is only inserted when the user presses Save quote draft. This prevents
empty or accidentally opened drafts from polluting the Documents list.

Assistant-created document drafts do insert a `quote_drafts` row immediately,
because the user has explicitly asked Kyro to create the draft. Those rows use
the same saved reusable template data as the Documents screen and store the
template key, design settings snapshot, reference-file metadata, optional linked
contact id, and editable customer/job fields in `metadata`.

Current document presentation settings are stored in `workspace_policies` with
`policy_type = document_templates`. That policy stores the workspace's quote
style direction, accent theme, currency, validity period, payment terms, footer
text, prepared-by footer preference, and current custom reusable quote templates.
Those custom templates currently include a stable key, label, description, line
item structure, notes, reference-file metadata, latest revision request, and a
design settings snapshot. The template review/edit UI updates that policy array
directly for now and renders previews through the same HTML renderer used by the
quote print route. The separate `document_templates`, `document_template_versions`,
and `generated_documents` tables below remain planned for richer template
versioning, file storage, and generated-document workflows.

Assistant-created or assistant-revised reusable templates update this same
`document_templates` workspace policy. Creation adds a new `customTemplates[]`
entry with a stable key, line items, notes, settings snapshot, and revision
request. Revisions preserve the existing key and reference-file metadata so
draft links and template identity remain stable.

### `document_templates` planned

- `id`
- `workspace_id`
- `name`
- `document_type`
- `status`
- `created_at`
- `updated_at`

### `document_template_versions` planned

- `id`
- `workspace_id`
- `document_template_id`
- `version`
- `schema`
- `template_file_id`
- `render_settings`
- `created_at`

### `generated_documents` planned

- `id`
- `workspace_id`
- `document_template_id`
- `document_template_version_id`
- `document_type`
- `title`
- `status`
- `source_context`
- `field_values`
- `output_file_id`
- `created_by_action_id`
- `created_by_ai_run_id`
- `created_at`
- `updated_at`

## Inquiry Facts

### `inquiry_facts`

- `id`
- `workspace_id`
- `conversation_id`
- `contact_id`
- `lead_id`
- `source_ai_run_id`
- `job_type`
- `address`
- `preferred_time`
- `urgency`
- `budget`
- `fit`
- `missing_info`
- `source`
- `edited_by_user_id`
- `metadata`
- `created_at`
- `updated_at`

There is one current fact row per workspace/conversation. Users can edit it, and AI replanning should treat the saved row as the authoritative corrected state.

## Media planned

### `media_generations` planned

- `id`
- `workspace_id`
- `prompt`
- `mode`
- `input_file_id`
- `output_file_id`
- `created_by_action_id`
- `created_by_ai_run_id`
- `status`
- `created_at`

## Policies and Audit

### `workspace_policies`

- `id`
- `workspace_id`
- `policy_type`
- `settings`
- `created_at`
- `updated_at`

Recommended `policy_type` values:

- `communication_outbound`
- `outbound_email`
- `outbound_sms`
- `ai_actions`
- `model_routing`
- `document_templates`
- `inbound_email`
- `assistant_voice`
- `usage_budget`
- `quiet_hours`
- `blocked_recipients`

`communication_outbound` is the current web settings policy used for dry-run outbound approval, channel, style, and email signature settings. It stores a default signature plus an optional assistant signature for untouched AI-generated sends. `outbound_email` and `outbound_sms` are still seeded by bootstrap as narrower channel policies and may be consolidated later.

## Usage and Billing Readiness

### `usage_events`

- `id`
- `workspace_id`
- `user_id`
- `source_type`
- `source_id`
- `ai_run_id`
- `workflow_run_id`
- `action_id`
- `provider`
- `service`
- `model`
- `usage_type`
- `quantity`
- `unit`
- `unit_price_snapshot`
- `unit_cost_snapshot`
- `markup_snapshot`
- `currency`
- `cost_snapshot`
- `customer_charge_snapshot`
- `provider_usage_id`
- `metadata`
- `created_at`

Recommended `usage_type` values:

- `llm_input_tokens`
- `llm_output_tokens`
- `llm_cached_input_tokens`
- `llm_reasoning_tokens`
- `realtime_text_input_tokens`
- `realtime_audio_input_tokens`
- `realtime_cached_input_tokens`
- `realtime_text_output_tokens`
- `realtime_audio_output_tokens`
- `realtime_reasoning_tokens`
- `embedding_tokens`
- `web_search_calls`
- `image_generation`
- `speech_to_text_minutes`
- `text_to_speech_characters`
- `text_to_speech_seconds`
- `sms_segments`
- `voice_minutes`
- `document_pages`
- `storage_bytes`

### `usage_rollups`

- `id`
- `workspace_id`
- `user_id`
- `period_start`
- `period_end`
- `provider`
- `service`
- `model`
- `usage_type`
- `quantity`
- `cost`
- `customer_charge`
- `currency`
- `created_at`
- `updated_at`

### `billing_accounts` planned

- `id`
- `workspace_id`
- `billing_email`
- `status`
- `currency`
- `external_customer_id`
- `created_at`
- `updated_at`

### `pricing_rules`

- `id`
- `workspace_id`
- `plan_key`
- `service`
- `provider`
- `model`
- `usage_type`
- `unit`
- `unit_cost_snapshot`
- `markup_type`
- `markup_value`
- `customer_unit_price`
- `currency`
- `is_active`
- `created_at`
- `updated_at`

### `workspace_budgets`

- `id`
- `workspace_id`
- `period`
- `soft_limit`
- `hard_limit`
- `currency`
- `settings`
- `created_at`
- `updated_at`

### `workspace_entitlements`

- `id`
- `workspace_id`
- `entitlement_key`
- `value`
- `source`
- `starts_at`
- `ends_at`
- `created_at`
- `updated_at`

### `billing_periods` planned

- `id`
- `workspace_id`
- `period_start`
- `period_end`
- `status`
- `usage_total`
- `currency`
- `external_invoice_id`
- `created_at`
- `updated_at`

### `audit_logs`

- `id`
- `workspace_id`
- `actor_type`
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `before`
- `after`
- `metadata`
- `created_at`
