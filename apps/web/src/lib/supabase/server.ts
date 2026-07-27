import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { getSupabaseEnv } from "../env";

/**
 * One Supabase client per request, not per caller.
 *
 * A single page render used to build four of these -- the page itself plus
 * three loaders inside AppFrame -- and each one then called `auth.getUser()`,
 * which is a network round trip to the auth server, and queried `workspaces`.
 * That was eight round trips of pure overhead before any screen data was
 * fetched.
 *
 * `cache()` is scoped to one server request and cleared between them, so this
 * shares the client within a render without sharing anything across users.
 * Every caller here is a user-facing route serving exactly one signed-in
 * person; background jobs build their own service-role client and do not go
 * through this path.
 *
 * Sharing one client is also more correct than building several: they all read
 * the same cookie jar, so a session refreshed by one is seen by the rest.
 */
export const createServerSupabaseClient = cache(
  async function createServerSupabaseClient() {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
    const cookieStore = await cookies();

    return createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server components cannot always mutate cookies. Middleware keeps sessions fresh.
          }
        },
      },
    });
  },
);

/**
 * `auth.getUser()` validates the JWT against the auth server, so it is a real
 * network call rather than a cookie read. Memoised for the same reason as the
 * client above.
 */
export const getCurrentUser = cache(async function getCurrentUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    supabase,
    user,
  };
});
