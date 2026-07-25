import type { SupabaseClient } from "@supabase/supabase-js";

export type SignupBootstrapStatus =
  | "reserved"
  | "auth_created"
  | "workspace_created"
  | "billing_pending"
  | "complete"
  | "failed";

type SignupReservationRow = {
  conflict: "email" | "phone" | "recoverable" | null;
  existing_auth_user_id: string | null;
  existing_workspace_id: string | null;
  record_id: string | null;
  record_status: SignupBootstrapStatus | null;
};

export async function reserveSignupBootstrap(
  serviceSupabase: SupabaseClient,
  input: {
    email: string;
    payload: Record<string, unknown>;
    phone: string;
  },
) {
  const { data, error } = await serviceSupabase.rpc(
    "reserve_signup_bootstrap",
    {
      p_email: input.email.trim().toLowerCase(),
      p_payload: input.payload,
      p_phone: input.phone.trim(),
    },
  );

  if (error) {
    throw new Error(`Unable to reserve signup: ${error.message}`);
  }

  const row = (
    Array.isArray(data) ? data[0] : data
  ) as SignupReservationRow | null;

  if (!row) {
    throw new Error("Unable to reserve signup: no reservation was returned.");
  }

  return {
    authUserId: row.existing_auth_user_id,
    conflict: row.conflict,
    id: row.record_id,
    status: row.record_status,
    workspaceId: row.existing_workspace_id,
  };
}

export async function updateSignupBootstrap(
  serviceSupabase: SupabaseClient,
  input: {
    authUserId?: string | null;
    error?: string | null;
    recordId: string;
    stage: string;
    status: SignupBootstrapStatus;
    workspaceId?: string | null;
  },
) {
  const completedAt =
    input.status === "complete" ? new Date().toISOString() : null;
  const { error } = await serviceSupabase
    .from("signup_bootstrap_records")
    .update({
      ...(input.authUserId !== undefined
        ? { auth_user_id: input.authUserId }
        : {}),
      completed_at: completedAt,
      last_error: input.error ?? null,
      stage: input.stage,
      status: input.status,
      ...(input.workspaceId !== undefined
        ? { workspace_id: input.workspaceId }
        : {}),
    })
    .eq("id", input.recordId);

  if (error) {
    throw new Error(`Unable to update signup recovery state: ${error.message}`);
  }
}
