import { createWorkspaceBootstrapDefaults, type WorkspaceBootstrapInput } from "@kyro/api";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { usageMarkupRate } from "../usage/pricing";
import {
  WORKSPACE_GENERAL_POLICY_TYPE,
  normalizeWorkspaceGeneralSettings,
} from "./general-settings";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
};

export type DashboardSnapshot = {
  workspace: WorkspaceSummary;
  counts: {
    messages: number;
    leads: number;
    pendingActions: number;
    usageEvents: number;
  };
  leads: Array<{
    id: string;
    title: string;
    source: string | null;
    status: string;
    estimatedValue: string | null;
  }>;
};

function requireUserEmail(user: User) {
  if (!user.email) {
    throw new Error("The authenticated user does not have an email address.");
  }

  return user.email;
}

export async function ensureUserProfile(supabase: SupabaseClient, user: User) {
  const email = requireUserEmail(user);
  const firstName =
    typeof user.user_metadata.first_name === "string"
      ? user.user_metadata.first_name
      : typeof user.user_metadata.firstName === "string"
        ? user.user_metadata.firstName
        : null;
  const lastName =
    typeof user.user_metadata.last_name === "string"
      ? user.user_metadata.last_name
      : typeof user.user_metadata.lastName === "string"
        ? user.user_metadata.lastName
        : null;
  const name =
    typeof user.user_metadata.name === "string"
      ? user.user_metadata.name
      : typeof user.user_metadata.full_name === "string"
        ? user.user_metadata.full_name
        : null;

  const { error } = await supabase.from("users").upsert({
    id: user.id,
    email,
    first_name: firstName,
    last_name: lastName,
    name
  });

  if (error) {
    throw new Error(`Unable to sync user profile: ${error.message}`);
  }
}

export async function getPrimaryWorkspace(supabase: SupabaseClient): Promise<WorkspaceSummary | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,name,slug")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Unable to load workspace: ${error.message}`);
  }

  return data?.[0] ?? null;
}

export async function createWorkspaceBootstrap(
  supabase: SupabaseClient,
  user: User,
  input: WorkspaceBootstrapInput
) {
  await ensureUserProfile(supabase, user);

  const defaults = createWorkspaceBootstrapDefaults(input);

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({
      name: defaults.workspace.name,
      slug: defaults.workspace.slug,
      owner_user_id: user.id
    })
    .select("id,name,slug")
    .single();

  if (workspaceError || !workspace) {
    throw new Error(`Unable to create workspace: ${workspaceError?.message ?? "unknown error"}`);
  }

  const workspaceId = workspace.id as string;

  const { error: memberError } = await supabase.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: "owner"
  });

  if (memberError) {
    throw new Error(`Unable to create workspace membership: ${memberError.message}`);
  }

  const { error: profileError } = await supabase.from("business_profiles").insert({
    workspace_id: workspaceId,
    business_name: defaults.businessProfile.businessName,
    industry: defaults.businessProfile.industry,
    description: defaults.businessProfile.description,
    service_area: defaults.businessProfile.serviceArea,
    tone_of_voice: defaults.businessProfile.toneOfVoice,
    default_reply_instructions: defaults.businessProfile.defaultReplyInstructions
  });

  if (profileError) {
    throw new Error(`Unable to create business profile: ${profileError.message}`);
  }

  const { error: policyError } = await supabase.from("workspace_policies").insert(
    defaults.policies.map((policy) => ({
      workspace_id: workspaceId,
      policy_type: policy.policyType,
      settings:
        policy.policyType === WORKSPACE_GENERAL_POLICY_TYPE
          ? normalizeWorkspaceGeneralSettings({
              ...policy.settings,
              usageMarkupRate: usageMarkupRate(),
            })
          : policy.settings
    }))
  );

  if (policyError) {
    throw new Error(`Unable to seed workspace policies: ${policyError.message}`);
  }

  const { error: entitlementError } = await supabase.from("workspace_entitlements").insert(
    defaults.entitlements.map((entitlement) => ({
      workspace_id: workspaceId,
      entitlement_key: entitlement.entitlementKey,
      value: entitlement.value,
      source: entitlement.source
    }))
  );

  if (entitlementError) {
    throw new Error(`Unable to seed entitlements: ${entitlementError.message}`);
  }

  const { error: budgetError } = await supabase.from("workspace_budgets").insert({
    workspace_id: workspaceId,
    period: defaults.budget.period,
    soft_limit: defaults.budget.softLimit,
    hard_limit: defaults.budget.hardLimit,
    currency: defaults.budget.currency,
    settings: defaults.budget.settings
  });

  if (budgetError) {
    throw new Error(`Unable to seed workspace budget: ${budgetError.message}`);
  }

  const { error: pricingError } = await supabase.from("pricing_rules").insert(
    defaults.pricingRules.map((rule) => ({
      workspace_id: workspaceId,
      plan_key: "bootstrap",
      service: rule.service,
      provider: rule.provider,
      model: rule.model,
      usage_type: rule.usageType,
      unit: rule.unit,
      markup_type: rule.markupType,
      markup_value: rule.markupValue,
      currency: rule.currency
    }))
  );

  if (pricingError) {
    throw new Error(`Unable to seed pricing rules: ${pricingError.message}`);
  }

  return workspace as WorkspaceSummary;
}

async function getWorkspaceCount(supabase: SupabaseClient, table: string, workspaceId: string) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (error) {
    throw new Error(`Unable to count ${table}: ${error.message}`);
  }

  return count ?? 0;
}

export async function getDashboardSnapshot(
  supabase: SupabaseClient,
  workspace: WorkspaceSummary
): Promise<DashboardSnapshot> {
  const [messages, leads, pendingActions, usageEvents, leadRows] = await Promise.all([
    getWorkspaceCount(supabase, "messages", workspace.id),
    getWorkspaceCount(supabase, "leads", workspace.id),
    supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("status", "pending_approval"),
    getWorkspaceCount(supabase, "usage_events", workspace.id),
    supabase
      .from("leads")
      .select("id,title,source,status,estimated_value")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(5)
  ]);

  if (pendingActions.error) {
    throw new Error(`Unable to count pending actions: ${pendingActions.error.message}`);
  }

  if (leadRows.error) {
    throw new Error(`Unable to load leads: ${leadRows.error.message}`);
  }

  return {
    workspace,
    counts: {
      messages,
      leads,
      pendingActions: pendingActions.count ?? 0,
      usageEvents
    },
    leads: (leadRows.data ?? []).map((lead) => ({
      id: String(lead.id),
      title: String(lead.title),
      source: typeof lead.source === "string" ? lead.source : null,
      status: String(lead.status),
      estimatedValue:
        typeof lead.estimated_value === "string" || typeof lead.estimated_value === "number"
          ? String(lead.estimated_value)
          : null
    }))
  };
}
