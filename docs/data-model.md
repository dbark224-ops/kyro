# Kyro V1 Data Model

All tenant-owned tables must include `workspace_id`.
All important side effects must create audit logs.

Schema source of truth: `packages/db/src/schema.ts`.

This document separates current implemented tables from planned later tables.
Planned later tables are marked as planned and are not available in the current database yet.
The current implemented schema includes identity/workspace, CRM, files, events/actions,
conversation tasks/appointments/notes, AI/model routing, Assistant memory/context and image generation, quote drafts,
generated document records, inquiry facts, usage/pricing/budget, entitlements, and audit logs.

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

### `workspace_phone_numbers`

Provider phone numbers for SMS and Vapi/Twilio voice. Assigned rows have a
`workspace_id`; beta pool rows have `workspace_id = null` and `status =
'available'` until Kyro claims them for a workspace.

- `id`
- `workspace_id`
- `provider`
- `service`
- `phone_number`
- `normalized_phone`
- `friendly_name`
- `provider_phone_number_id`
- `country_code`
- `region`
- `capabilities`
- `status`
- `purchased_at`
- `assigned_at`
- `reserved_at`
- `assignment_source`
- `released_at`
- `monthly_cost_snapshot`
- `currency`
- `metadata`
- `created_at`
- `updated_at`

The current implementation stores Twilio numbers, capability metadata, Twilio
phone-number SIDs, and optional Vapi phone-number ids in `metadata`. During the
beta, Kyro assigns pre-purchased pool rows to workspaces when phone/SMS is
enabled. Later automatic Twilio purchase should create the same row shape with
`assignment_source = 'twilio_auto_purchase'`. Inbound Twilio SMS is matched by
the destination number in this table before Kyro creates a workspace-scoped SMS
channel and CRM conversation.

## CRM Core

### `contacts`

- `id`
- `workspace_id`
- `name`
- `email`
- `phone`
- `company`
- `normalized_email`
- `normalized_phone`
- `normalized_company`
- `contact_type`
- `lifecycle_stage`
- `lifecycle_source`
- `lifecycle_reason`
- `lifecycle_reviewed_at`
- `profile_resolution_status`
- `profile_resolution_reason`
- `profile_conflict_contact_ids`
- `merged_into_contact_id`
- `profile_resolved_at`
- `profile_resolved_by_user_id`
- `address`
- `address_line1`
- `address_line2`
- `address_locality`
- `address_administrative_area`
- `address_postal_code`
- `address_country_code`
- `address_latitude`
- `address_longitude`
- `address_place_id`
- `address_source`
- `address_validation_status`
- `address_validated_at`
- `address_structured`
- `source`
- `notes`
- `tags`
- `created_at`
- `updated_at`

The normalized contact fields are derived identity fields used for matching,
search, duplicate warnings, and company grouping. `normalized_phone` stores a
canonical international-style value where the phone number can be parsed or has
an explicit country prefix. App-side writes use the workspace default phone
region from `workspace_general.defaultPhoneRegion` when a local number has no
country code; the database trigger preserves that app-supplied normalized value.

`address` remains the human-readable display value. The structured address fields
store the Google/manual source, place id, postal components, coordinates, validation
status, and raw structured payload used for future maps, service-area checks,
routing, scheduling, and cleaner quote/job-site output.

Lifecycle fields separate the profile's business stage from its category.
`lifecycle_stage` is currently `lead` or `client`; `contact_type` remains the
operational category such as client, supplier, contractor, builder, property
manager, or other. `lifecycle_source` records whether the stage came from the
system default, a manual user edit, or an applied AI/backend suggestion.
`lifecycle_reason` and `lifecycle_reviewed_at` capture the latest explanation
and review timestamp. Manual overrides can be cleared by the user, which sets
the source back to `system` so future scheduled or manual lifecycle reviews can
suggest changes again.

Profile resolution fields track identity conflicts and merges. `clear` means no
active profile-review work is pending, `needs_review` means the profile was
created or flagged because identity signals conflict, and `merged` means the
profile has been archived into `merged_into_contact_id`. The conflict id array
stores candidate contact ids for the review panel. Merge actions move linked
leads, conversations, messages, inquiry facts, quote drafts, and contact-targeted
actions to the kept profile, while leaving the source contact and audit logs in
place for historical traceability. Normal CRM list/search views filter out
merged source contacts; the kept profile can still show merged source summaries
and audit history.

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

`review_lifecycle_stage` actions target contacts, not conversations. Their
`input` stores the current stage, recommended stage, confidence, evidence, and
reason produced by the lifecycle review pass. Current evidence comes from linked
leads, messages, quote approvals, quote metadata, and contact-targeted business
actions. The evaluator is also shaped to accept future commercial evidence such
as paid invoices, booked jobs, work orders, and billing records once those
records exist. Applying the action updates the contact lifecycle; dismissing it
leaves the contact unchanged while preserving the audit trail. Automated review
is suggestion-only for now, including high-confidence evidence.

`merge_contact_profiles` actions target the kept contact profile. Their `input`
stores the source and target contact ids plus the user reason; their `result`
stores source/target snapshots, the target patch, and counts of moved linked
records.

### `conversation_tasks`

Durable internal work items attached to a conversation. A task can also be linked
to one message, contact, lead, user assignee, and source action. Message-level
`message_resolution` tasks are the audit-friendly marker for "this message was
handled"; normal user-created tasks use `manual_task` or more specific types
such as `site_visit`. Automatic follow-up reminders use
`customer_follow_up`; outbound replies create or reschedule one open reminder
for the conversation, and inbound customer messages complete any open reminder
so stale due states do not remain after the customer has replied.

- `id`
- `workspace_id`
- `conversation_id`
- `message_id`
- `contact_id`
- `lead_id`
- `assigned_to_user_id`
- `created_by_user_id`
- `source_action_id`
- `task_type`
- `title`
- `description`
- `status`
- `priority`
- `due_at`
- `completed_at`
- `metadata`
- `created_at`
- `updated_at`

### `conversation_appointments`

Durable appointment/site-visit records before calendar integration exists. Site
visit action cards now create an appointment plus a linked `conversation_tasks`
row, so proposed scheduling work is not lost inside a transient action result.

- `id`
- `workspace_id`
- `conversation_id`
- `message_id`
- `contact_id`
- `lead_id`
- `task_id`
- `created_by_user_id`
- `source_action_id`
- `appointment_type`
- `title`
- `description`
- `status`
- `starts_at`
- `ends_at`
- `location`
- `metadata`
- `created_at`
- `updated_at`

### `conversation_notes`

Internal-only conversation notes. Notes can be attached to a whole conversation
or to one message. They are not customer-visible and are intended for operator
context, handover, and triage explanations.

- `id`
- `workspace_id`
- `conversation_id`
- `message_id`
- `contact_id`
- `lead_id`
- `author_user_id`
- `body`
- `visibility`
- `metadata`
- `created_at`
- `updated_at`

### `outbound_messages`

Durable delivery queue and ledger for outbound communications. This is separate
from `messages`: an outbox row tracks provider attempts and retry state, while a
`messages` row is the conversation-facing record once delivery/recording succeeds.
Event-only sends, such as replies to filtered-out/skipped email, use the same
outbox row and record an `events` row after delivery instead of creating a
conversation message.

- `id`
- `workspace_id`
- `conversation_id`
- `action_id`
- `event_id`
- `user_id`
- `channel_id`
- `channel_type`
- `provider`
- `service`
- `connection_id`
- `recipient`
- `subject`
- `body_text`
- `body_html`
- `attachments`
- `settings_snapshot`
- `status`
- `idempotency_key`
- `source`
- `attempt_count`
- `max_attempts`
- `next_attempt_at`
- `queued_at`
- `sending_at`
- `sent_at`
- `failed_at`
- `provider_message_id`
- `provider_thread_id`
- `provider_request_id`
- `last_error`
- `metadata`
- `created_at`
- `updated_at`

Current statuses are `queued`, `sending`, `sent`, `retry_scheduled`, `failed`,
and `dismissed`. `dismissed` is an operations-only terminal state used to clear
dead or stale test rows from the active outbox view without deleting the record or
its audit trail.
The `(workspace_id, idempotency_key)` unique index prevents double sends from
double-clicks or repeated action execution. Attachment JSON stores metadata and
private file references (`fileId`, `storageBucket`, `storagePath`,
`storageStatus`) only. The binary payload is uploaded to the private Supabase
Storage bucket configured by `KYRO_FILE_STORAGE_BUCKET` before the row is sent,
so scheduled retries can rebuild provider attachments without storing base64
blobs in Postgres. Legacy rows that still contain `contentBase64` are readable
for compatibility but new rows should not be written that way.

### `voice_calls`

Durable phone-call ledger for Vapi-powered voice interactions. This is separate
from `messages` because a call can have a recording, transcript, lifecycle
events, and provider state before it becomes a normal CRM conversation note or
follow-up action.

- `id`
- `workspace_id`
- `conversation_id`
- `contact_id`
- `lead_id`
- `phone_number_id`
- `direction`
- `purpose`
- `provider`
- `carrier_provider`
- `provider_call_id`
- `provider_assistant_id`
- `provider_phone_number_id`
- `from_number`
- `to_number`
- `normalized_from_number`
- `normalized_to_number`
- `customer_number`
- `status`
- `started_at`
- `ended_at`
- `duration_seconds`
- `recording_url`
- `transcript`
- `summary`
- `ended_reason`
- `cost_provider_amount`
- `cost_customer_amount`
- `currency`
- `metadata`
- `created_at`
- `updated_at`

Current `purpose` values are `inbound_customer`, `inbound_user`,
`voicemail_overflow`, `outbound_customer`, and `test`. Current statuses are
`created`, `queued`, `ringing`, `in_progress`, `completed`, `failed`, `missed`,
and `cancelled`. Vapi is the AI-call provider and Twilio is the carrier provider.
The row stores provider ids and the resolved customer number so UI surfaces can
show the call even if no CRM contact has been matched yet. Completed calls can
write `usage_events.usage_type = voice_call` rows from Vapi/Twilio provider cost,
duration, and workspace markup settings.

### `voice_call_events`

Raw event ledger for Vapi webhooks and tool calls.

- `id`
- `workspace_id`
- `voice_call_id`
- `provider`
- `event_type`
- `payload`
- `created_at`

Webhook payloads are stored as JSON so Kyro can inspect provider behaviour during
early integration testing without losing detail. User-facing screens render only
the compact call preview; the raw event history remains available for debugging,
audit, and later workflow automation.

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

Image generation `ai_runs.usage` stores the request-level provider cost/customer
charge snapshot and, when OpenAI returns it, the provider image usage object. The
matching `usage_events.image_generation` row is the append-only billing ledger
source and includes the token split/cost breakdown in metadata.

Assistant public web search creates `ai_runs.task_type = web_search` tool rows
when the Assistant executes an OpenAI web-search request. Token usage is stored as
normal LLM token rows, and the hosted search call itself is also stored in
`usage_events.usage_type = web_search_calls` so source-backed internet lookup
costs remain auditable separately from ordinary chat narration.

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
Current known block types include `link_cards`, `memory_notice`,
`memory_suggestion`, `summary_cards`, `timeline`, `approval_queue`, and
`generated_image`.

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

Current long-term memory capture has two paths. Explicit instructions such as
"remember..." or "for future..." are saved as active memories immediately.
Durable-looking preferences that are not explicit memory instructions are saved
as `pending_approval` suggestions and shown in the Assistant. Only `active`
memories are loaded into future model context; rejected suggestions remain
stored for audit/history but are not used as context.

### `assistant_context_snapshots`

- `id`
- `workspace_id`
- `user_id`
- `thread_id`
- `snapshot_type`
- `period_start`
- `period_end`
- `title`
- `summary`
- `key_points`
- `entities`
- `source_message_ids`
- `message_count`
- `token_estimate`
- `metadata`
- `created_at`
- `updated_at`

Assistant context snapshots are the compaction layer for Kyro's single persistent
assistant chat. They do not replace `assistant_messages`; they summarize older
saved turns into daily snapshots and opportunistic weekly/monthly rollups. The
assistant model receives only a small ranked set of these snapshots before a turn,
and the history-search tool can search snapshots plus raw messages when the user
asks what was discussed earlier. This keeps long-running Assistant use responsive
without losing auditability or the ability to recover older context. Snapshot
lookup and compaction are intentionally fail-soft: missing tables, stale
Supabase schema cache, or compaction errors should degrade to raw message memory,
not block Assistant responses.

### `assistant_prompt_suggestion_sets`

- `id`
- `workspace_id`
- `user_id`
- `status`
- `source`
- `suggestions`
- `period_start`
- `period_end`
- `generated_at`
- `model`
- `metadata`
- `created_at`
- `updated_at`

Prompt suggestion sets store the reusable suggestion pills shown above the
Assistant composer. The active row is per workspace/user. `suggestions` is a JSON
array of customer-agnostic prompts, usually generated weekly from recent initial
Assistant prompts and filtered to avoid customer names, addresses, emails, phone
numbers, and file ids. The UI rotates four visible suggestions from the stored
set and falls back to defaults if no active set exists.

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

Current `source` values include inbound/provider attachments, retryable outbound
attachments, generated document PDFs, assistant uploads, and generated images.
Assistant image generation v1 stores image input references and generated output
images here rather than creating a separate media table. Generated-image UI
blocks are also persisted on `assistant_messages`, allowing later image edit or
recall requests in the same thread to recover the last generated image after
page reloads or server restarts.

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

Generated-document state now has two layers. Quote draft metadata keeps
`metadata.lastGeneratedDocument` with the PDF filename, content type, byte size,
renderer, generation timestamp, generated document id, storage location, and content hash.
`metadata.documentHistory` records lightweight `pdf_generated`, `email_prepared`,
`email_sent`, `customer_viewed`, `customer_approved`, and
`customer_changes_requested` events so the quote page and Assistant can explain what happened.
Each event can carry `quoteVersion`, and generated document metadata also includes
the active version used to render or send that artifact.
The durable PDF record lives in `generated_documents`, linked to the quote draft,
contact, lead, conversation, private `files` row, and optional sent message.
When the email is sent, outbound message metadata records the PDF attachment
summary and the quote draft metadata records sent timestamps, provider/message ids,
the outbound message id, and an `email_sent` history event. The binary PDF is
stored in a private Supabase Storage bucket and can also be filed to Google Drive
when the user presses the Drive filing action.

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
quote print route. The separate `document_templates` and
`document_template_versions` tables below remain planned for richer template
versioning. Generated PDF instances now use the implemented `generated_documents`
table while reusable template definitions still live in the workspace policy.

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

### `generated_documents`

- `id`
- `workspace_id`
- `document_type`
- `title`
- `lifecycle_status`
- `contact_id`
- `lead_id`
- `conversation_id`
- `quote_draft_id`
- `file_id`
- `storage_bucket`
- `storage_path`
- `filename`
- `content_type`
- `size_bytes`
- `content_hash`
- `renderer`
- `document_version`
- `google_drive_file_id`
- `google_drive_web_url`
- `google_drive_synced_at`
- `created_by_user_id`
- `sent_message_id`
- `sent_at`
- `filed_at`
- `metadata`
- `created_at`
- `updated_at`

Generated documents are first-class records for quote and invoice PDFs generated
from structured quote draft data. Current `document_type` values are `quote` and
`invoice`. Current lifecycle values are `generated`, `filed`, `sent`, and
`voided`. The record points at a private storage-backed `files` row and keeps
clear links back to the source contact, lead, conversation, and quote draft.
Google Drive filing updates the Drive file id/link and `filed_at` fields. Invoice
documents are generated from the same saved document-template settings as the
source quote draft; they do not create payment, bookkeeping, or reconciliation
records.

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
- `address_line1`
- `address_line2`
- `address_locality`
- `address_administrative_area`
- `address_postal_code`
- `address_country_code`
- `address_latitude`
- `address_longitude`
- `address_place_id`
- `address_source`
- `address_validation_status`
- `address_validated_at`
- `address_structured`
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

## Media

Image generation v1 uses existing records:

- `assistant_upload` rows in `files` for uploaded references,
- `generated_image` rows in `files` for generated outputs,
- `ai_runs.task_type = image_generation` for the tool execution,
- `usage_events.usage_type = image_generation` for provider and customer-charge snapshots,
- `audit_logs.action = image.generated` for traceability.

A dedicated media gallery/history table can still be added later if generated
visuals become a large first-class product area.

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

- `workspace_general`
- `communication_outbound`
- `outbound_email`
- `outbound_sms`
- `ai_actions`
- `model_routing`
- `document_templates`
- `inbound_email`
- `assistant_voice`
- `usage_budget`

`workspace_general` stores the current editable business profile used by
Settings, reports, assistant context, and future customer-facing documents. The
profile includes business name, industry, public email/phone, business address,
service area, served suburbs/postcodes, travel radius, staff count,
working/contact hours, emergency job availability and notes, logo payload/URL,
brand colours, and brand style notes. The public phone number is only the
displayed business number; operational SMS/voice numbers stay in
`workspace_phone_numbers` and provider-specific voice settings.
- `quiet_hours`
- `blocked_recipients`

`workspace_general` stores workspace-wide defaults that are not tied to one feature, currently `timeZone`, `displayCurrency`, `exchangeRateProvider`, `exchangeRateUpdatedAt`, and `defaultPhoneRegion`. Timezone is still mirrored into `inbound_email` for quiet-hours polling compatibility. `defaultPhoneRegion` is used for bare local phone numbers where the customer did not include an international country code. CRM lifecycle review policy is currently hard-coded to suggestion-only rather than stored as an auto-apply setting. `communication_outbound` is the current web settings policy used for dry-run outbound approval, channel, outbound writing style, follow-up reminders, and email signature settings. Its `replyWriting` object stores tone, wording style, message length, sign-off guidance, trade-specific phrasing, and reusable reply instructions that AI draft generation must apply. It also stores a default signature plus an optional assistant signature for untouched AI-generated sends. `outbound_email` and `outbound_sms` are still seeded by bootstrap as narrower channel policies and may be consolidated later.

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

`currency`, `cost_snapshot`, and `customer_charge_snapshot` are stored in the
original ledger currency and should not be overwritten for display conversion.
The web UI can convert those values for presentation using the workspace display
currency, but billing exports should retain the stored amounts for auditability.

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
- `inbound_sms`
- `outbound_sms`
- `phone_number_rental`
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

### `knowledge_sources`

- `id`
- `workspace_id` nullable for global/public sources
- `title`
- `citation`
- `jurisdiction_country`
- `jurisdiction_region`
- `industry`
- `topic_tags`
- `source_type`
- `licensing_mode`
- `publisher`
- `official_url`
- `purchase_url`
- `reference_code`
- `version_label`
- `effective_from`
- `effective_to`
- `status`
- `notes`
- `created_at`
- `updated_at`

### `knowledge_documents`

- `id`
- `workspace_id` nullable for global/public docs
- `source_id`
- `file_id` nullable for future private uploads/licensed files
- `storage_path`
- `title`
- `version_label`
- `published_at`
- `effective_from`
- `effective_to`
- `checksum`
- `raw_text`
- `summary`
- `ingest_status`
- `is_current`
- `metadata`
- `created_at`
- `updated_at`

### `knowledge_chunks`

- `id`
- `workspace_id` nullable for global/public chunks
- `document_id`
- `chunk_index`
- `heading`
- `section_label`
- `clause_ref`
- `topic_tags`
- `chunk_text`
- `chunk_summary`
- `token_count`
- `embedding_payload`
- `created_at`

### `knowledge_change_log`

- `id`
- `workspace_id` nullable for global/public source history
- `source_id`
- `document_id`
- `change_type`
- `summary`
- `details`
- `detected_at`
- `created_at`
