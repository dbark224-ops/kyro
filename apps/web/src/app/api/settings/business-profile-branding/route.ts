import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import {
  WORKSPACE_GENERAL_POLICY_TYPE,
  normalizeWorkspaceBusinessProfileSettings,
  normalizeWorkspaceGeneralSettings,
} from "../../../../lib/workspace/general-settings";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BUSINESS_LOGO_BYTES = 512 * 1024;

function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === "string") {
    return false;
  }

  const maybeFile = value as {
    arrayBuffer?: unknown;
    name?: unknown;
    size?: unknown;
    type?: unknown;
  };

  return (
    typeof maybeFile.arrayBuffer === "function" &&
    typeof maybeFile.name === "string" &&
    typeof maybeFile.size === "number"
  );
}

async function businessLogoPayload(formData: FormData) {
  const upload = formData.get("businessProfileLogoFile");

  if (upload && isUploadFile(upload) && upload.name.trim() && upload.size > 0) {
    if (!upload.type.startsWith("image/")) {
      return {
        error: "Business logos must be image files.",
        payload: null,
      };
    }

    if (upload.size > MAX_BUSINESS_LOGO_BYTES) {
      return {
        error: "Business logos are limited to 512 KB for now.",
        payload: null,
      };
    }

    return {
      error: null,
      payload: {
        logoContentBase64: Buffer.from(await upload.arrayBuffer()).toString(
          "base64",
        ),
        logoContentType: upload.type,
        logoFilename: upload.name,
        logoSizeBytes: upload.size,
      },
    };
  }

  return {
    error: null,
    payload: {
      logoContentBase64: formString(formData, "businessProfileLogoContentBase64"),
      logoContentType: formString(formData, "businessProfileLogoContentType"),
      logoFilename: formString(formData, "businessProfileLogoFilename"),
      logoSizeBytes: formString(formData, "businessProfileLogoSizeBytes"),
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const { error: logoError, payload: logoPayload } =
      await businessLogoPayload(formData);

    if (logoError || !logoPayload) {
      return NextResponse.json(
        { error: logoError ?? "Unable to read business logo." },
        { status: 400 },
      );
    }

    const { supabase, user, workspace } = await requireWorkspaceContext();
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
    const businessProfile = normalizeWorkspaceBusinessProfileSettings(
      {
        ...beforeSettings.businessProfile,
        ...logoPayload,
        brandAccentColor: formString(formData, "businessBrandAccentColor"),
        brandPrimaryColor: formString(formData, "businessBrandPrimaryColor"),
        brandStyle: formString(formData, "businessBrandStyle"),
        logoUrl: formString(formData, "businessProfileLogoUrl"),
        logoWidthPx: formString(formData, "businessProfileLogoWidthPx"),
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
            savedResult.error?.message ??
            "Unable to save business profile branding.",
        },
        { status: 500 },
      );
    }

    insertAuditLog(supabase, {
      action: "workspace_business_profile.branding_updated",
      actorId: user.id,
      actorType: "user",
      after: {
        brandAccentColor: businessProfile.brandAccentColor,
        brandPrimaryColor: businessProfile.brandPrimaryColor,
        brandStyle: businessProfile.brandStyle,
        logoFilename: businessProfile.logoFilename,
        logoUrl: businessProfile.logoUrl,
      },
      before: {
        brandAccentColor: beforeSettings.businessProfile.brandAccentColor,
        brandPrimaryColor: beforeSettings.businessProfile.brandPrimaryColor,
        brandStyle: beforeSettings.businessProfile.brandStyle,
        logoFilename: beforeSettings.businessProfile.logoFilename,
        logoUrl: beforeSettings.businessProfile.logoUrl,
      },
      entityId: String(savedResult.data.id),
      entityType: "workspace_policy",
      workspaceId: workspace.id,
    }).catch((auditError) => {
      console.error(
        auditError instanceof Error
          ? auditError.message
          : "Unable to record business profile branding audit log.",
      );
    });

    return NextResponse.json({
      data: {
        brandAccentColor: businessProfile.brandAccentColor,
        brandPrimaryColor: businessProfile.brandPrimaryColor,
        brandStyle: businessProfile.brandStyle,
        logoFilename: businessProfile.logoFilename,
        logoUrl: businessProfile.logoUrl,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to save business profile branding.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
