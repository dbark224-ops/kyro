import { resolveAssistantCommand } from "../../../../../lib/assistant/commands";
import {
  assistantWebSearchEnabled,
  runAssistantWebSearch,
} from "../../../../../lib/assistant/web-search";
import {
  syncInboundEmail,
  type InboundEmailProvider,
} from "../../../../../lib/integrations/inbound-email-sync";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";

export const dynamic = "force-dynamic";

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  const body = objectRecord(await request.json().catch(() => ({})));
  const name = textValue(body.name);
  const rawArguments = objectRecord(body.arguments);
  const prompt = textValue(rawArguments.prompt) ?? textValue(rawArguments.query);

  if (
    name !== "kyro_context_lookup" &&
    name !== "kyro_web_search" &&
    name !== "kyro_check_recent_email"
  ) {
    return Response.json({ error: "Unsupported realtime tool." }, { status: 400 });
  }

  if (name !== "kyro_check_recent_email" && !prompt) {
    return Response.json({ error: "Tool prompt is required." }, { status: 400 });
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  if (name === "kyro_check_recent_email") {
    const providerArg = textValue(rawArguments.provider);
    const provider: InboundEmailProvider | undefined =
      providerArg === "google" || providerArg === "microsoft" ? providerArg : undefined;
    const result = await syncInboundEmail({
      provider,
      supabase,
      trigger: "assistant",
      user,
      workspaceId: workspace.id,
    });
    const answer =
      result.needsReconnect.length > 0
        ? `I checked email, but ${result.needsReconnect.length} connected account needs to be reconnected with inbox-read permission. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
        : result.errors.length > 0
          ? `I checked email with ${result.errors.length} issue(s). I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages}, and observed ${result.observedMessages}.`
          : `I checked email. I fetched ${result.fetchedMessages} message(s), promoted ${result.promotedMessages} into Kyro, observed ${result.observedMessages}, and skipped ${result.duplicates} duplicate(s).`;

    return Response.json({
      data: {
        answer,
        result,
      },
    });
  }

  if (name === "kyro_web_search") {
    if (!assistantWebSearchEnabled()) {
      return Response.json({ error: "Web search is disabled." }, { status: 403 });
    }

    const result = await runAssistantWebSearch({ prompt: prompt ?? "" });

    return Response.json({
      data: {
        answer: result.text,
        fallbackReason: result.fallbackReason ?? null,
        sourceCount: result.sources.length,
        sources: result.sources,
        webSearchUsed: result.webSearchUsed,
      },
    });
  }

  const result = await resolveAssistantCommand({
    prompt: prompt ?? "",
    supabase,
    user,
    workspace,
  });

  return Response.json({
    data: {
      answer: result.fallbackAnswer,
      context: result.context,
      intent: result.intent,
      links: result.links,
      mutation: result.mutation ?? null,
      title: result.title,
    },
  });
}
