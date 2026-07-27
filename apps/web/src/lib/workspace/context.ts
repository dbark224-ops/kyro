import { redirect } from "next/navigation";
import { cache } from "react";
import { getCurrentUser } from "../supabase/server";
import { getPrimaryWorkspace } from "./bootstrap";

/**
 * Who is asking, and which workspace they are in.
 *
 * Called from 129 places, and a single page render reached it several times --
 * once from the page and again from each of the loaders that make up the app
 * chrome. Each pass cost an auth round trip and a `workspaces` query.
 *
 * Memoised per request, so the answer is fetched once no matter how many
 * components ask. The redirects still fire from every caller, because the
 * memoised value is replayed rather than the redirect being swallowed.
 */
export const requireWorkspaceContext = cache(
  async function requireWorkspaceContext() {
    const { supabase, user } = await getCurrentUser();

    if (!user) {
      redirect("/sign-in");
    }

    const workspace = await getPrimaryWorkspace(supabase);

    if (!workspace) {
      redirect("/onboarding");
    }

    return {
      supabase,
      user,
      workspace,
    };
  },
);
