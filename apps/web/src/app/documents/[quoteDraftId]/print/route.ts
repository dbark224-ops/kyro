import { getQuoteDraftProfile } from "../../../../lib/crm/queries";
import { buildQuoteDocumentHtml } from "../../../../lib/documents/render";
import {
  documentTemplateDesignSettingsForQuote,
  getDocumentTemplateSettings,
} from "../../../../lib/documents/settings";
import { requireWorkspaceContext } from "../../../../lib/workspace/context";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type QuotePrintRouteProps = {
  params: Promise<{
    quoteDraftId: string;
  }>;
};

export async function GET(_request: Request, { params }: QuotePrintRouteProps) {
  const [{ quoteDraftId }, { supabase, workspace }] = await Promise.all([
    params,
    requireWorkspaceContext(),
  ]);
  const [profile, settings, businessProfile] = await Promise.all([
    getQuoteDraftProfile(supabase, workspace.id, quoteDraftId),
    getDocumentTemplateSettings(supabase, workspace.id),
    supabase
      .from("business_profiles")
      .select(
        "business_name,industry,description,service_area,tone_of_voice,default_reply_instructions",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!profile) {
    notFound();
  }

  if (businessProfile.error) {
    throw new Error(
      `Unable to load business profile: ${businessProfile.error.message}`,
    );
  }

  const html = buildQuoteDocumentHtml({
    businessProfile: businessProfile.data
      ? {
          businessName: businessProfile.data.business_name,
          defaultReplyInstructions:
            businessProfile.data.default_reply_instructions,
          description: businessProfile.data.description,
          industry: businessProfile.data.industry,
          serviceArea: businessProfile.data.service_area,
          toneOfVoice: businessProfile.data.tone_of_voice,
        }
      : null,
    profile,
    settings: documentTemplateDesignSettingsForQuote(
      profile.quoteDraft.metadata,
      settings,
    ),
    workspace,
  });

  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
