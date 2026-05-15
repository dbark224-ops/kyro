import {
  GOOGLE_PROVIDER,
  GOOGLE_WORKSPACE_SCOPES,
  getGoogleOAuthConfig,
  hashOAuthState
} from "../../../../lib/integrations/google";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { getPrimaryWorkspace } from "../../../../lib/workspace/bootstrap";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function base64Url(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function settingsRedirect(request: Request, key: "engine_error" | "engine_message", message: string) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("section", "google");
  url.searchParams.set(key, message);

  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (!workspace) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  const config = getGoogleOAuthConfig();

  if (!config) {
    return settingsRedirect(
      request,
      "engine_error",
      "Google OAuth is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and NEXT_PUBLIC_APP_URL."
    );
  }

  const state = base64Url();
  const verifier = base64Url(48);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabase.from("integration_oauth_states").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    provider: GOOGLE_PROVIDER,
    state_hash: hashOAuthState(state),
    scopes: [...GOOGLE_WORKSPACE_SCOPES],
    redirect_path: "/settings?section=google",
    code_verifier: verifier,
    expires_at: expiresAt,
    metadata: {
      source: "settings.google_connect"
    }
  });

  if (error) {
    return settingsRedirect(
      request,
      "engine_error",
      `Unable to start Google OAuth. Apply the latest migration first. ${error.message}`
    );
  }

  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GOOGLE_WORKSPACE_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("code_challenge", codeChallenge(verifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  if (user.email) {
    authorizationUrl.searchParams.set("login_hint", user.email);
  }

  return NextResponse.redirect(authorizationUrl);
}
