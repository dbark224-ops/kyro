import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  getAssistantPromptSuggestionState,
  refreshAssistantPromptSuggestionsForUser,
} from "../../../../lib/assistant/prompt-suggestions";
import { getSupabaseEnv } from "../../../../lib/env";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import {
  getPrimaryWorkspace,
  type WorkspaceSummary,
} from "../../../../lib/workspace/bootstrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AuthenticatedSuggestionContext = {
  supabase: SupabaseClient;
  user: {
    id: string;
  };
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

async function createRouteSupabaseClient(request: NextRequest) {
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

async function getSuggestionContext(
  request: NextRequest,
): Promise<AuthenticatedSuggestionContext | NextResponse> {
  const supabase = await createRouteSupabaseClient(request);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  return {
    supabase,
    user: {
      id: user.id,
    },
    workspace,
  };
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  const context = await getSuggestionContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const state = await getAssistantPromptSuggestionState({
    supabase: context.supabase,
    userId: context.user.id,
    workspaceId: context.workspace.id,
  });

  return NextResponse.json({ data: state });
}

export async function POST(request: NextRequest) {
  const context = await getSuggestionContext(request);

  if (context instanceof NextResponse) {
    return context;
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const payload =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  try {
    const state = await refreshAssistantPromptSuggestionsForUser({
      periodEnd: textValue(payload.periodEnd),
      periodStart: textValue(payload.periodStart),
      supabase: context.supabase,
      trigger: "manual",
      userId: context.user.id,
      workspace: context.workspace,
    });

    return NextResponse.json({ data: state });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to refresh assistant prompt suggestions.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
