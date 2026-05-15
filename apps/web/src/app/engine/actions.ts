"use server";

import {
  approveAction,
  executeAction,
  processNextEvent,
  requestStubAction,
} from "../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function redirectWithEngineStatus(
  redirectTo: string,
  key: "engine_error" | "engine_message",
  message: string,
): never {
  const separator = redirectTo.includes("?") ? "&" : "?";

  redirect(`${redirectTo}${separator}${key}=${encodeURIComponent(message)}`);
}

function redirectWithEngineError(message: string, redirectTo = "/"): never {
  redirectWithEngineStatus(redirectTo, "engine_error", message);
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formRedirectPath(formData: FormData) {
  const value = formString(formData, "redirectTo");

  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function revalidateRedirectPath(redirectTo: string) {
  revalidatePath(redirectTo.split("?")[0] || "/");
}

export async function requestStubActionAction() {
  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    await requestStubAction(supabase, user, workspace.id);
  } catch (error) {
    redirectWithEngineError(
      error instanceof Error ? error.message : "Unable to request action.",
    );
  }

  revalidatePath("/");
  redirect("/?engine_message=Action requested and audit logged.");
}

export async function approveDashboardAction(formData: FormData) {
  const actionId = formString(formData, "actionId");
  const redirectTo = formRedirectPath(formData);

  if (!actionId) {
    redirectWithEngineError("Action id is required.");
  }

  const { supabase, user } = await requireWorkspaceContext();

  try {
    await approveAction(supabase, user, actionId);
  } catch (error) {
    redirectWithEngineError(
      error instanceof Error ? error.message : "Unable to approve action.",
      redirectTo,
    );
  }

  revalidatePath("/");
  revalidatePath("/inbox");
  revalidateRedirectPath(redirectTo);
  redirectWithEngineStatus(redirectTo, "engine_message", "Action approved.");
}

export async function executeDashboardAction(formData: FormData) {
  const actionId = formString(formData, "actionId");
  const redirectTo = formRedirectPath(formData);

  if (!actionId) {
    redirectWithEngineError("Action id is required.");
  }

  const { supabase, user } = await requireWorkspaceContext();

  try {
    await executeAction(supabase, user, actionId);
  } catch (error) {
    redirectWithEngineError(
      error instanceof Error ? error.message : "Unable to execute action.",
      redirectTo,
    );
  }

  revalidatePath("/");
  revalidatePath("/inbox");
  revalidateRedirectPath(redirectTo);
  redirectWithEngineStatus(redirectTo, "engine_message", "Action executed.");
}

export async function approveAndExecuteDashboardAction(formData: FormData) {
  const actionId = formString(formData, "actionId");
  const redirectTo = formRedirectPath(formData);

  if (!actionId) {
    redirectWithEngineError("Action id is required.");
  }

  const { supabase, user } = await requireWorkspaceContext();

  try {
    await approveAction(supabase, user, actionId);
    await executeAction(supabase, user, actionId);
  } catch (error) {
    redirectWithEngineError(
      error instanceof Error ? error.message : "Unable to send generated reply.",
      redirectTo,
    );
  }

  revalidatePath("/");
  revalidatePath("/inbox");
  revalidateRedirectPath(redirectTo);
  redirectWithEngineStatus(redirectTo, "engine_message", "Generated reply sent.");
}

export async function processNextEventAction() {
  const { supabase, user, workspace } = await requireWorkspaceContext();

  try {
    const eventId = await processNextEvent(supabase, user, workspace.id);
    revalidatePath("/");
    redirect(
      eventId
        ? "/?engine_message=Pending event processed."
        : "/?engine_message=No pending events to process.",
    );
  } catch (error) {
    redirectWithEngineError(
      error instanceof Error ? error.message : "Unable to process event.",
    );
  }
}
