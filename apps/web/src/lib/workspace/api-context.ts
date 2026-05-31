import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "../env";
import { createServerSupabaseClient } from "../supabase/server";
import { getPrimaryWorkspace, type WorkspaceSummary } from "./bootstrap";

export type ApiWorkspaceContext = {
  supabase: SupabaseClient;
  user: User;
  workspace: WorkspaceSummary;
};

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice("bearer ".length).trim();

  return token || null;
}

export async function createApiSupabaseClient(request: NextRequest) {
  const token = bearerToken(request);

  if (!token) {
    return createServerSupabaseClient();
  }

  const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();

  return createClient(supabaseUrl, supabaseAnonKey, {
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
}

export async function getApiWorkspaceContext(
  request: NextRequest,
): Promise<ApiWorkspaceContext | NextResponse> {
  const supabase = await createApiSupabaseClient(request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  return {
    supabase,
    user,
    workspace,
  };
}
