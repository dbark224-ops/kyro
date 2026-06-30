import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "../env";
import { requestBearerToken } from "../http/request-secret";
import { getPrimaryWorkspace } from "../workspace/bootstrap";

export class MobileApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MobileApiError";
    this.status = status;
  }
}

export function mobileErrorResponse(error: unknown) {
  const status = error instanceof MobileApiError ? error.status : 500;
  const message =
    error instanceof Error ? error.message : "Unable to complete mobile request.";

  return Response.json({ error: message }, { status });
}

export async function requireMobileWorkspaceContext(request: Request) {
  const token = requestBearerToken(request);

  if (!token) {
    throw new MobileApiError("Missing mobile authorization bearer token.", 401);
  }

  const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    throw new MobileApiError("Mobile session is not valid. Sign in again.", 401);
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (!workspace) {
    throw new MobileApiError(
      "No Kyro workspace was found for this account. Complete onboarding in the web app first.",
      428,
    );
  }

  return {
    supabase,
    user,
    workspace,
  };
}
