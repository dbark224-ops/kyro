import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import {
  WORKSPACE_GENERAL_POLICY_TYPE,
  normalizeWorkspaceBusinessProfileSettings,
  normalizeWorkspaceGeneralSettings,
} from "../../../../lib/workspace/general-settings";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const TAG_FIELD_MAP = {
  businessServiceArea: {
    key: "serviceArea",
    maxLength: 1600,
  },
  businessServicePostcodes: {
    key: "servicePostcodes",
    maxLength: 1000,
  },
  businessServiceSuburbs: {
    key: "serviceSuburbs",
    maxLength: 1600,
  },
} as const;

type TagFieldName = keyof typeof TAG_FIELD_MAP;

function isTagFieldName(value: unknown): value is TagFieldName {
  return typeof value === "string" && value in TAG_FIELD_MAP;
}

function normalizedTagValue(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  const seen = new Set<string>();
  const tags = value
    .split(/[\n,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

  return tags.join(", ").slice(0, maxLength);
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      name?: unknown;
      value?: unknown;
    };

    if (!isTagFieldName(payload.name)) {
      return NextResponse.json(
        { error: "Choose a valid business profile field." },
        { status: 400 },
      );
    }

    const { supabase, user, workspace } = await requireWorkspaceContext();
    const field = TAG_FIELD_MAP[payload.name];
    const nextValue = normalizedTagValue(payload.value, field.maxLength);
    const beforeResult = await supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", WORKSPACE_GENERAL_POLICY_TYPE)
      .maybeSingle();

    if (beforeResult.error) {
      return NextResponse.json(
        { error: beforeResult.error.message },
        { status: 500 },
      );
    }

    const beforeSettings = normalizeWorkspaceGeneralSettings(
      beforeResult.data?.settings,
    );
    const profilePatch =
      payload.name === "businessServiceArea"
        ? {
            serviceArea: nextValue,
            servicePostcodes: "",
            serviceSuburbs: "",
          }
        : {
            [field.key]: nextValue,
          };
    const businessProfile = normalizeWorkspaceBusinessProfileSettings(
      {
        ...beforeSettings.businessProfile,
        ...profilePatch,
      },
      {
        businessName: workspace.name,
        publicEmail: user.email ?? "",
      },
    );
    const nextSettings = normalizeWorkspaceGeneralSettings({
      ...beforeSettings,
      businessProfile,
    });
    const savedResult = await supabase
      .from("workspace_policies")
      .upsert(
        {
          policy_type: WORKSPACE_GENERAL_POLICY_TYPE,
          settings: nextSettings,
          workspace_id: workspace.id,
        },
        {
          onConflict: "workspace_id,policy_type",
        },
      )
      .select("id")
      .single();

    if (savedResult.error || !savedResult.data) {
      return NextResponse.json(
        {
          error:
            savedResult.error?.message ?? "Unable to save business profile.",
        },
        { status: 500 },
      );
    }

    insertAuditLog(supabase, {
      action: "workspace_business_profile.tags_updated",
      actorId: user.id,
      actorType: "user",
      after: {
        field: field.key,
        value: nextValue,
      },
      before: {
        field: field.key,
        value: beforeSettings.businessProfile[field.key],
      },
      entityId: String(savedResult.data.id),
      entityType: "workspace_policy",
      workspaceId: workspace.id,
    }).catch((auditError) => {
      console.error(
        auditError instanceof Error
          ? auditError.message
          : "Unable to record business profile tag audit log.",
      );
    });

    return NextResponse.json({
      data: {
        field: field.key,
        value: businessProfile[field.key],
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to save business profile tags.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
