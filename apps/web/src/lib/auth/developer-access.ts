import type { User } from "@supabase/supabase-js";

export function developerAccessEnabled(user: Pick<User, "app_metadata">) {
  const metadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? (user.app_metadata as Record<string, unknown>)
      : {};
  const value = metadata.developer ?? metadata.mobileDeveloper;

  return value === true || value === "true" || value === "yes" || value === 1;
}
