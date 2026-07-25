import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const workspaceRoleSchema = z.enum([
  "owner",
  "admin",
  "operator",
  "viewer",
]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const outboundApprovalModeSchema = z.enum([
  "require_approval",
  "auto_send_trusted",
  "auto_send_all_eligible",
]);
export type OutboundApprovalMode = z.infer<typeof outboundApprovalModeSchema>;

export const actionStatusSchema = z.enum([
  "requested",
  "pending_approval",
  "approved",
  "executing",
  "completed",
  "failed",
  "cancelled",
]);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const actionTypeSchema = z.enum([
  "send_email",
  "send_sms",
  "draft_reply",
  "ask_missing_info",
  "book_site_visit",
  "create_quote_draft",
  "mark_not_fit",
  "schedule_follow_up",
  "create_task",
  "update_lead",
  "generate_document",
  "attach_file",
  "generate_image",
  "edit_image",
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const modelTaskTypeSchema = z.enum([
  "inbound_triage",
  "lead_extraction",
  "assistant_chat",
  "reply_drafting",
  "action_planning",
  "document_generation",
  "image_generation",
  "embedding",
  "speech_to_text",
  "text_to_speech",
]);
export type ModelTaskType = z.infer<typeof modelTaskTypeSchema>;

export const modelRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type ModelRiskLevel = z.infer<typeof modelRiskLevelSchema>;

export const usageTypeSchema = z.enum([
  "llm_input_tokens",
  "llm_output_tokens",
  "llm_cached_input_tokens",
  "llm_reasoning_tokens",
  "realtime_text_input_tokens",
  "realtime_audio_input_tokens",
  "realtime_cached_input_tokens",
  "realtime_text_output_tokens",
  "realtime_audio_output_tokens",
  "realtime_reasoning_tokens",
  "embedding_tokens",
  "provider_api_calls",
  "web_search_calls",
  "image_generation",
  "speech_to_text_minutes",
  "text_to_speech_characters",
  "text_to_speech_seconds",
  "sms_segments",
  "voice_minutes",
  "document_pages",
  "storage_bytes",
]);
export type UsageType = z.infer<typeof usageTypeSchema>;

export const workspaceSummarySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const modelRouteRequestSchema = z.object({
  workspaceId: uuidSchema,
  userId: uuidSchema.optional(),
  taskType: modelTaskTypeSchema,
  riskLevel: modelRiskLevelSchema,
  requiredCapabilities: z.array(z.string()).default([]),
  latencyTargetMs: z.number().int().positive().optional(),
  estimatedInputTokens: z.number().int().nonnegative().optional(),
});
export type ModelRouteRequest = z.infer<typeof modelRouteRequestSchema>;

export const modelRouteDecisionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reason: z.string().min(1),
  fallbackProvider: z.string().optional(),
  fallbackModel: z.string().optional(),
});
export type ModelRouteDecision = z.infer<typeof modelRouteDecisionSchema>;

export const usageEventCreateSchema = z.object({
  workspaceId: uuidSchema,
  userId: uuidSchema.optional(),
  sourceType: z.string().optional(),
  sourceId: uuidSchema.optional(),
  aiRunId: uuidSchema.optional(),
  workflowRunId: uuidSchema.optional(),
  actionId: uuidSchema.optional(),
  provider: z.string().min(1),
  service: z.string().min(1),
  model: z.string().optional(),
  providerUsageId: z.string().optional(),
  usageType: usageTypeSchema,
  quantity: z.number().nonnegative(),
  unit: z.string().min(1),
  unitPriceSnapshot: z.number().nonnegative().optional(),
  unitCostSnapshot: z.number().nonnegative(),
  markupSnapshot: z.number().nonnegative(),
  costSnapshot: z.number().nonnegative(),
  customerChargeSnapshot: z.number().nonnegative(),
  currency: z.string().length(3),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UsageEventCreate = z.infer<typeof usageEventCreateSchema>;
