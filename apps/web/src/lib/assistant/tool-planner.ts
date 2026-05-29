import type {
  AssistantContextSnapshot,
  AssistantModelRoute,
  AssistantRecentMessage,
} from "./types";
import {
  estimateTokens,
  openAiProviderUsageId,
  openAiUsageFromResponse,
  type OpenAiTokenUsage,
} from "../usage/openai";

export type AssistantToolName =
  | "app_help"
  | "contact_lookup"
  | "document_template_create"
  | "document_template_update"
  | "email_sync"
  | "general_chat"
  | "history_search"
  | "image_generation"
  | "image_recall"
  | "inbound_email_awareness"
  | "inquiry_lookup"
  | "memory_save"
  | "overview"
  | "pronunciation_update"
  | "quote_create"
  | "quote_history"
  | "quote_lookup"
  | "quote_send"
  | "quote_send_ready_list"
  | "settings_update"
  | "usage_summary"
  | "work_queue";

export type AssistantToolSelection = {
  confidence?: number | null;
  mode?:
    | "direct"
    | "edit_previous_image"
    | "recall_previous_image"
    | string
    | null;
  name: AssistantToolName;
  prompt: string;
  reason?: string | null;
};

export type AssistantToolPlanResult = {
  fallbackReason?: string;
  inputTokens: number;
  modelPlanned: boolean;
  outputTokens: number;
  providerUsageId?: string;
  selection: AssistantToolSelection | null;
  tokenUsage?: OpenAiTokenUsage;
};

type ToolDefinition = {
  description: string;
  name: Exclude<AssistantToolName, "general_chat">;
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    description:
      "Show conversations, leads, approvals, or the current inbox/work queue that need attention.",
    name: "work_queue",
  },
  {
    description:
      "Look up one or more customer inquiries, jobs, leads, or conversations by customer, job, or status.",
    name: "inquiry_lookup",
  },
  {
    description:
      "Look up contacts, customers, clients, companies, suppliers, contractors, builders, or CRM profiles.",
    name: "contact_lookup",
  },
  {
    description:
      "Find quote drafts or document drafts by customer, title, status, or document details.",
    name: "quote_lookup",
  },
  {
    description:
      "Create a quote, invoice, or reusable document draft from templates. Do not use this for visual images.",
    name: "quote_create",
  },
  {
    description:
      "Prepare, send, email, or attach a quote/document to a customer. Kyro code still enforces send approvals and policy.",
    name: "quote_send",
  },
  {
    description:
      "List quote/document drafts that are ready to send or blocked from sending.",
    name: "quote_send_ready_list",
  },
  {
    description:
      "Answer whether a quote/document was sent, approved, changed, viewed, or has history/version activity.",
    name: "quote_history",
  },
  {
    description:
      "Generate a new image, photo rendering, marketing image, social graphic, or renovation visual.",
    name: "image_generation",
  },
  {
    description:
      "Show, recall, open, or download the latest generated image in this assistant thread.",
    name: "image_recall",
  },
  {
    description:
      "Create a new reusable quote/document template from chat instructions.",
    name: "document_template_create",
  },
  {
    description:
      "Edit, update, revise, or rename an existing reusable quote/document template.",
    name: "document_template_update",
  },
  {
    description:
      "Summarize API usage, billing, costs, metering, provider cost, customer charge, or margin.",
    name: "usage_summary",
  },
  {
    description:
      "Explain how Kyro works, what a setting means, where to find a feature, or provide product help.",
    name: "app_help",
  },
  {
    description:
      "Run or check inbound email sync for connected Gmail/Outlook accounts.",
    name: "email_sync",
  },
  {
    description:
      "Answer what came in by email, skipped/filtered emails, inbound email awareness, attachments, or recent mail decisions.",
    name: "inbound_email_awareness",
  },
  {
    description:
      "Search older assistant chat history or compacted context when the user asks what was discussed earlier, yesterday, last week, previously, or asks where an old chat item went.",
    name: "history_search",
  },
  {
    description:
      "Safely update assistant-editable settings, sender rules, sync settings, pronunciation policy, or voice settings.",
    name: "settings_update",
  },
  {
    description:
      "Save an explicit memory when the user says remember, note, or for future reference.",
    name: "memory_save",
  },
  {
    description:
      "Add or update pronunciation/vocabulary hints when the user says a word should be pronounced a certain way.",
    name: "pronunciation_update",
  },
  {
    description:
      "Show a workspace/dashboard overview, business summary, or general CRM snapshot.",
    name: "overview",
  },
];

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedToolName(name: string): AssistantToolName | null {
  const cleaned = name.replace(/^kyro_/, "");

  return TOOL_DEFINITIONS.some((tool) => tool.name === cleaned)
    ? (cleaned as AssistantToolName)
    : null;
}

function toolArguments(value: unknown) {
  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    return objectRecord(parsed);
  } catch {
    return {};
  }
}

function responseToolCall(payload: unknown) {
  const output = objectRecord(payload).output;
  const items = Array.isArray(output) ? output : [];

  for (const item of items) {
    const record = objectRecord(item);

    if (record.type === "function_call") {
      return record;
    }
  }

  return null;
}

function responseText(payload: unknown) {
  const outputText = textValue(objectRecord(payload).output_text);

  if (outputText) {
    return outputText;
  }

  return null;
}

function providerErrorMessage(payload: unknown) {
  const error = objectRecord(objectRecord(payload).error);

  return textValue(error.message) ?? "OpenAI assistant tool planning failed.";
}

function recentContextForPlanning(
  recentMessages: readonly AssistantRecentMessage[],
) {
  return recentMessages.slice(-8).map((message) => ({
    content: message.content,
    generatedImages: (message.uiBlocks ?? []).flatMap((block) =>
      block.type === "generated_image"
        ? block.images.map((image) => ({
            editMode: image.editMode,
            fileId: image.fileId,
            prompt: image.prompt,
            size: image.size,
          }))
        : [],
    ),
    intent: message.intent ?? null,
    role: message.role,
  }));
}

function toolSchema(tool: ToolDefinition) {
  return {
    description: tool.description,
    name: `kyro_${tool.name}`,
    parameters: {
      additionalProperties: false,
      properties: {
        confidence: {
          description:
            "0 to 1 confidence that this is the best Kyro tool for the user's message.",
          type: "number",
        },
        mode: {
          description:
            "Use edit_previous_image for requests like 'make it nighttime' after an image. Use recall_previous_image for 'where is it' or 'show it again'. Otherwise direct.",
          enum: [
            "direct",
            "edit_previous_image",
            "recall_previous_image",
          ],
          type: "string",
        },
        prompt: {
          description:
            "The concise user request to pass to Kyro's deterministic tool executor. Preserve names, job details, and follow-up intent.",
          type: "string",
        },
        reason: {
          description:
            "Brief reason this tool was selected. This is internal debug context.",
          type: "string",
        },
      },
      required: ["prompt", "mode", "confidence", "reason"],
      type: "object",
    },
    strict: true,
    type: "function",
  };
}

function plannerPrompt({
  contextSnapshots,
  inputSource,
  prompt,
  recentMessages,
  threadSummary,
}: {
  contextSnapshots?: readonly AssistantContextSnapshot[];
  inputSource?: string;
  prompt: string;
  recentMessages: readonly AssistantRecentMessage[];
  threadSummary?: string | null;
}) {
  return JSON.stringify(
    {
      inputSource: inputSource ?? "typed",
      compactedContext: (contextSnapshots ?? []).map((snapshot) => ({
        messageCount: snapshot.messageCount,
        periodEnd: snapshot.periodEnd,
        periodStart: snapshot.periodStart,
        summary: snapshot.summary,
        title: snapshot.title,
        type: snapshot.snapshotType,
      })),
      recentMessages: recentContextForPlanning(recentMessages),
      threadSummary: threadSummary ?? null,
      userPrompt: prompt,
    },
    null,
    2,
  );
}

function selectionFromResponse(
  payload: unknown,
  originalPrompt: string,
): AssistantToolSelection | null {
  const call = responseToolCall(payload);

  if (!call) {
    return null;
  }

  const rawName = textValue(call.name);
  const name = rawName ? normalizedToolName(rawName) : null;

  if (!name) {
    return null;
  }

  const args = toolArguments(call.arguments);

  return {
    confidence: numberValue(args.confidence),
    mode: textValue(args.mode) ?? "direct",
    name,
    prompt: textValue(args.prompt) ?? originalPrompt,
    reason: textValue(args.reason),
  };
}

export function parseAssistantToolPlanResponse(
  payload: unknown,
  originalPrompt: string,
): AssistantToolSelection | null {
  return selectionFromResponse(payload, originalPrompt);
}

export async function planAssistantToolCall({
  contextSnapshots = [],
  inputSource,
  prompt,
  recentMessages = [],
  route,
  threadSummary = null,
}: {
  contextSnapshots?: AssistantContextSnapshot[];
  inputSource?: string;
  prompt: string;
  recentMessages?: AssistantRecentMessage[];
  route: AssistantModelRoute;
  threadSummary?: string | null;
}): Promise<AssistantToolPlanResult> {
  if (route.provider !== "openai") {
    return {
      fallbackReason: "Tool planning currently only runs on OpenAI routes.",
      inputTokens: estimateTokens(prompt),
      modelPlanned: false,
      outputTokens: 0,
      selection: null,
    };
  }

  const apiKey = openAiApiKey();
  const input = plannerPrompt({
    contextSnapshots,
    inputSource,
    prompt,
    recentMessages,
    threadSummary,
  });

  if (!apiKey) {
    return {
      fallbackReason: "OPENAI_API_KEY is not configured for tool planning.",
      inputTokens: estimateTokens(input),
      modelPlanned: false,
      outputTokens: 0,
      selection: null,
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input,
        instructions: [
          "You are Kyro's tool planner. Decide whether the user's message needs a Kyro app tool.",
          "Call exactly one Kyro tool only when tool-backed app state, files, documents, images, settings, email sync, usage, CRM records, or outbound actions are needed.",
          "For normal conversation, jokes, opinions, broad reasoning, or casual chat, do not call a tool.",
          "Use compactedContext for continuity. If the user asks about older assistant chat history, what was discussed before, or where an older generated/saved thing went and recentMessages are insufficient, call kyro_history_search.",
          "Use recentMessages to understand follow-ups. If a recent generated image exists and the user says make it nighttime, darker, brighter, edit it, redo it, or similar, call kyro_image_generation with mode edit_previous_image.",
          "If a recent generated image exists and the user asks where it is, show it again, open it, or download it, call kyro_image_recall.",
          "Never claim that an action was performed. Only choose the tool; Kyro code will execute or reject it.",
        ].join(" "),
        max_output_tokens: 180,
        model: route.model,
        parallel_tool_calls: false,
        tools: TOOL_DEFINITIONS.map(toolSchema),
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(providerErrorMessage(payload));
    }

    const selection = selectionFromResponse(payload, prompt);
    const plannerText = responseText(payload) ?? "";
    const usage = openAiUsageFromResponse(payload, {
      prompt: input,
      text: plannerText || JSON.stringify(selection ?? {}),
    });

    return {
      inputTokens: usage.inputTokens,
      modelPlanned: true,
      outputTokens: usage.outputTokens,
      providerUsageId: openAiProviderUsageId(payload) ?? undefined,
      selection,
      tokenUsage: usage,
    };
  } catch (error) {
    return {
      fallbackReason:
        error instanceof Error
          ? error.message
          : "OpenAI assistant tool planning failed.",
      inputTokens: estimateTokens(input),
      modelPlanned: false,
      outputTokens: 0,
      selection: null,
    };
  }
}
