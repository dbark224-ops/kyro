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

- `draft`
- `ready`
- `sent`
- `archived`

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
- `embedding_tokens`
- `image_generation`
- `speech_to_text_minutes`
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
