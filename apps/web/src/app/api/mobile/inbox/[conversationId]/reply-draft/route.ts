import { fetchAiProvider } from "../../../../../../lib/http/fetch-with-timeout";
import { getConversationReview } from "../../../../../../lib/crm/queries";
import {
  MobileApiError,
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../../lib/mobile/context";
import {
  openAiBalancedModel,
  openAiReasoningRequest,
} from "../../../../../../lib/ai/openai-models";
import { assertWorkspaceAutomationAllowed } from "../../../../../../lib/billing/access";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function defaultSubject(subject: string | null) {
  const value = subject ?? "Thanks for reaching out";

  return value.toLowerCase().startsWith("re:") ? value : `Re: ${value}`;
}

function parseDraft(value: string, fallbackSubject: string) {
  const trimmed = value.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const subject = textValue(parsed.subject);
    const body = textValue(parsed.body);

    if (body) {
      return {
        body,
        subject: subject ?? fallbackSubject,
      };
    }
  }

  return {
    body: trimmed,
    subject: fallbackSubject,
  };
}

function mobileMissingInfo(
  profile: NonNullable<Awaited<ReturnType<typeof getConversationReview>>>,
) {
  const missing = [...(profile.inquiryFacts?.missingInfo ?? [])];

  if (!profile.inquiryFacts?.address && !profile.contact?.address) {
    missing.push("job address");
  }

  if (!profile.inquiryFacts?.preferredTime) {
    missing.push("preferred day or time");
  }

  if (!profile.contact?.phone) {
    missing.push("phone number");
  }

  return Array.from(
    new Set(missing.map((item) => item.trim().toLowerCase()).filter(Boolean)),
  );
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const { supabase, workspace } =
      await requireMobileWorkspaceContext(request);
    await assertWorkspaceAutomationAllowed(workspace.id);
    const payload = (await request.json().catch(() => null)) as {
      prompt?: unknown;
    } | null;
    const prompt = textValue(payload?.prompt);
    const profile = await getConversationReview(
      supabase,
      workspace.id,
      conversationId,
    );

    if (!profile) {
      throw new MobileApiError("Conversation was not found.", 404);
    }

    const latestSubject =
      profile.messages.find((message) => message.subject)?.subject ??
      profile.lead?.title ??
      null;
    const fallbackSubject = defaultSubject(latestSubject);
    const thread = [...profile.messages]
      .reverse()
      .slice(-10)
      .map((message, index) =>
        [
          `${index + 1}. ${message.direction.toUpperCase()}`,
          message.subject ? `Subject: ${message.subject}` : null,
          message.bodyText ? `Body: ${message.bodyText}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      return Response.json({
        body: fallbackDraftBody(profile, prompt),
        subject: fallbackSubject,
      });
    }

    const model =
      process.env.OPENAI_REPLY_DRAFT_MODEL?.trim() || openAiBalancedModel();
    const response = await fetchAiProvider(
      "https://api.openai.com/v1/responses",
      {
        body: JSON.stringify({
          input: [
            {
              content:
                "You draft concise, useful outbound replies for a trade/service business. Return strict JSON only with keys subject and body.",
              role: "system",
            },
            {
              content: JSON.stringify({
                contact: profile.contact,
                instruction: prompt,
                lead: profile.lead,
                requiredMissingInfo: mobileMissingInfo(profile),
                thread,
                rules: [
                  "Every customer service inquiry needs an attendable job address. Ask for it if not present in the thread or CRM profile.",
                  "Every customer service inquiry needs a preferred day or time. Ask for it if not present.",
                  "For email-originated inquiries, ask for a phone number if the customer profile/thread does not contain one.",
                  "Do not claim calendar availability unless the context explicitly provides it.",
                ],
                task: "Draft an outbound reply for the user to review before sending.",
              }),
              role: "user",
            },
          ],
          max_output_tokens: 700,
          model,
          ...openAiReasoningRequest(
            model,
            "OPENAI_REPLY_DRAFT_REASONING_EFFORT",
            "low",
          ),
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string };
      output_text?: string;
    } | null;

    if (!response.ok) {
      throw new Error(
        data?.error?.message ?? "Unable to generate reply draft.",
      );
    }

    const outputText = textValue(data?.output_text);

    if (!outputText) {
      throw new Error("OpenAI returned an empty reply draft.");
    }

    return Response.json(parseDraft(outputText, fallbackSubject));
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

function fallbackDraftBody(
  profile: NonNullable<Awaited<ReturnType<typeof getConversationReview>>>,
  prompt: string | null,
) {
  const name =
    profile.contact?.name?.split(" ")[0] ?? profile.contact?.company ?? "there";
  const contextLine = prompt
    ? `\n\n${prompt}`
    : mobileMissingInfo(profile).length
      ? `\n\nCould you please send through ${mobileMissingInfo(profile).join(
          ", ",
        )} so I can help properly?`
      : "";

  return `Hi ${name},\n\nThanks for reaching out.${contextLine}\n\nKind regards`;
}
