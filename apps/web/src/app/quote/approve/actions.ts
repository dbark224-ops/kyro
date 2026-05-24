"use server";

import { createServiceSupabaseClient } from "../../../lib/supabase/service";
import { submitQuoteApprovalDecision } from "../../../lib/documents/approval";
import { redirect } from "next/navigation";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function approvalPath(token: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();

  return `/quote/approve/${encodeURIComponent(token)}${query ? `?${query}` : ""}`;
}

export async function approveQuoteFromCustomerAction(formData: FormData) {
  const token = formString(formData, "token");

  if (!token) {
    redirect("/quote/approve/missing?status=not_found");
  }

  const supabase = createServiceSupabaseClient();
  const result = await submitQuoteApprovalDecision(supabase, {
    decision: "approve",
    token,
  });

  redirect(
    approvalPath(token, {
      status: result.status,
    }),
  );
}

export async function requestQuoteChangesFromCustomerAction(formData: FormData) {
  const token = formString(formData, "token");
  const message = formString(formData, "message");

  if (!token) {
    redirect("/quote/approve/missing?status=not_found");
  }

  if (!message) {
    redirect(
      approvalPath(token, {
        error: "Please add a short note about what you would like changed.",
      }),
    );
  }

  const supabase = createServiceSupabaseClient();
  const result = await submitQuoteApprovalDecision(supabase, {
    decision: "request_changes",
    message,
    token,
  });

  redirect(
    approvalPath(token, {
      status: result.status,
    }),
  );
}
