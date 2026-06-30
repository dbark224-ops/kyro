import {
  COMMUNICATION_POLICY_TYPE,
  normalizeCommunicationSettings,
  normalizeEmailSignatureSettings,
} from "../../../../lib/communication/settings";
import { insertAuditLog } from "../../../../lib/engine/event-action-audit";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const MAX_SIGNATURE_LOGO_BYTES = 512 * 1024;

function formString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function formBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
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

async function signatureLogoPayload(
  formData: FormData,
  prefix: "manualSignature" | "aiGeneratedSignature",
) {
  const upload = formData.get(`${prefix}LogoFile`);

  if (upload && isUploadFile(upload) && upload.name.trim() && upload.size > 0) {
    if (!upload.type.startsWith("image/")) {
      return {
        error: "Signature logos must be image files.",
        payload: null,
      };
    }

    if (upload.size > MAX_SIGNATURE_LOGO_BYTES) {
      return {
        error: "Signature logos are limited to 512 KB for now.",
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
      logoContentBase64: formString(formData, `${prefix}LogoContentBase64`),
      logoContentType: formString(formData, `${prefix}LogoContentType`),
      logoFilename: formString(formData, `${prefix}LogoFilename`),
      logoSizeBytes: formString(formData, `${prefix}LogoSizeBytes`),
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const [manualLogo, aiLogo] = await Promise.all([
      signatureLogoPayload(formData, "manualSignature"),
      signatureLogoPayload(formData, "aiGeneratedSignature"),
    ]);

    if (manualLogo.error || !manualLogo.payload) {
      return NextResponse.json({ error: manualLogo.error }, { status: 400 });
    }

    if (aiLogo.error || !aiLogo.payload) {
      return NextResponse.json({ error: aiLogo.error }, { status: 400 });
    }

    const { supabase, user, workspace } = await requireWorkspaceContext();
    const beforeResult = await supabase
      .from("workspace_policies")
      .select("id,settings")
      .eq("workspace_id", workspace.id)
      .eq("policy_type", COMMUNICATION_POLICY_TYPE)
      .maybeSingle();

    if (beforeResult.error) {
      return NextResponse.json(
        { error: beforeResult.error.message },
        { status: 500 },
      );
    }

    const beforeSettings = normalizeCommunicationSettings(
      beforeResult.data?.settings,
    );
    const manualSignature = normalizeEmailSignatureSettings({
      ...manualLogo.payload,
      logoUrl: formString(formData, "manualSignatureLogoUrl"),
      logoWidthPx: formString(formData, "manualSignatureLogoWidthPx"),
      text: formString(formData, "manualSignatureText"),
    });
    const aiGeneratedSignature = normalizeEmailSignatureSettings({
      ...aiLogo.payload,
      logoUrl: formString(formData, "aiGeneratedSignatureLogoUrl"),
      logoWidthPx: formString(formData, "aiGeneratedSignatureLogoWidthPx"),
      text: formString(formData, "aiGeneratedSignatureText"),
    });
    const settings = normalizeCommunicationSettings({
      ...beforeSettings,
      aiGeneratedSignature,
      businessSignature: manualSignature.text,
      manualSignature,
      useSeparateAiSignature: formBoolean(formData, "useSeparateAiSignature"),
    });
    const savedResult = await supabase
      .from("workspace_policies")
      .upsert(
        {
          policy_type: COMMUNICATION_POLICY_TYPE,
          settings,
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
            savedResult.error?.message ?? "Unable to save email signatures.",
        },
        { status: 500 },
      );
    }

    insertAuditLog(supabase, {
      action: "workspace_communication.email_signatures_updated",
      actorId: user.id,
      actorType: "user",
      after: {
        aiGeneratedSignature: settings.aiGeneratedSignature,
        manualSignature: settings.manualSignature,
        useSeparateAiSignature: settings.useSeparateAiSignature,
      },
      before: {
        aiGeneratedSignature: beforeSettings.aiGeneratedSignature,
        manualSignature: beforeSettings.manualSignature,
        useSeparateAiSignature: beforeSettings.useSeparateAiSignature,
      },
      entityId: String(savedResult.data.id),
      entityType: "workspace_policy",
      workspaceId: workspace.id,
    }).catch((auditError) => {
      console.error(
        auditError instanceof Error
          ? auditError.message
          : "Unable to record email signature audit log.",
      );
    });

    return NextResponse.json({
      data: {
        aiGeneratedSignature: settings.aiGeneratedSignature,
        manualSignature: settings.manualSignature,
        useSeparateAiSignature: settings.useSeparateAiSignature,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save email signatures.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
