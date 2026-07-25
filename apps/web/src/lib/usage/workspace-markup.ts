import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import { normalizeUsageMarkupRate, usageMarkupRate } from "./pricing";

export async function resolveWorkspaceUsageMarkupRate(
  supabase: SupabaseClient,
  workspaceId: string | null | undefined,
  ...overrideKeys: string[]
) {
  if (!workspaceId) {
    return usageMarkupRate(...overrideKeys);
  }

  try {
    const settings = await getWorkspaceGeneralSettings(supabase, workspaceId);
    const workspaceMarkupRate = normalizeUsageMarkupRate(
      settings.usageMarkupRate,
      null,
    );

    if (workspaceMarkupRate !== null) {
      return workspaceMarkupRate;
    }
  } catch {
    // Usage still needs to be metered if settings fallback loading is unavailable.
  }

  return usageMarkupRate(...overrideKeys);
}
