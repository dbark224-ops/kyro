import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";

export async function completeOpenCustomerFollowUpReminders(
  supabase: SupabaseClient,
  input: {
    actorId?: string | null;
    actorType?: "system" | "user";
    conversationId: string;
    messageId: string;
    reason: string;
    workspaceId: string;
  },
) {
  const now = new Date().toISOString();
  const { data: tasks, error: loadError } = await supabase
    .from("conversation_tasks")
    .select("id,status,due_at")
    .eq("workspace_id", input.workspaceId)
    .eq("conversation_id", input.conversationId)
    .eq("task_type", "customer_follow_up")
    .eq("status", "open");

  if (loadError) {
    throw new Error(`Unable to load follow-up reminders: ${loadError.message}`);
  }

  const taskIds = (tasks ?? []).map((task) => String(task.id));

  if (taskIds.length === 0) {
    return 0;
  }

  const { error: updateError } = await supabase
    .from("conversation_tasks")
    .update({
      completed_at: now,
      status: "completed",
    })
    .eq("workspace_id", input.workspaceId)
    .in("id", taskIds);

  if (updateError) {
    throw new Error(
      `Unable to complete follow-up reminders: ${updateError.message}`,
    );
  }

  for (const task of tasks ?? []) {
    await insertAuditLog(supabase, {
      workspaceId: input.workspaceId,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? undefined,
      action: "conversation_follow_up.completed_by_inbound",
      entityType: "conversation_task",
      entityId: String(task.id),
      before: {
        dueAt: task.due_at ? String(task.due_at) : null,
        status: task.status ? String(task.status) : "open",
      },
      after: {
        completedAt: now,
        messageId: input.messageId,
        reason: input.reason,
        status: "completed",
      },
      metadata: {
        conversationId: input.conversationId,
      },
    });
  }

  return taskIds.length;
}
