import { resolveAssistantCommand } from "../../../../../lib/assistant/commands";
import {
  assistantWebSearchEnabled,
  runAssistantWebSearch,
} from "../../../../../lib/assistant/web-search";
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

  if (name !== "kyro_context_lookup" && name !== "kyro_web_search") {
    return Response.json({ error: "Unsupported realtime tool." }, { status: 400 });
  }

  if (!prompt) {
    return Response.json({ error: "Tool prompt is required." }, { status: 400 });
  }

  const { supabase, user, workspace } = await requireWorkspaceContext();

  if (name === "kyro_web_search") {
    if (!assistantWebSearchEnabled()) {
      return Response.json({ error: "Web search is disabled." }, { status: 403 });
    }

    const result = await runAssistantWebSearch({ prompt });

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
    prompt,
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
