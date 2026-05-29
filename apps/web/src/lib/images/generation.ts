import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { insertAuditLog } from "../engine/event-action-audit";
import { createServiceSupabaseClient } from "../supabase/service";
import {
  buildOpenAiImageGenerationUsageEvent,
  openAiImageUsageFromResponse,
  toUsageEventRows,
  usageEventTotals,
} from "../usage/openai";

const GENERATED_IMAGE_BUCKET =
  process.env.KYRO_FILE_STORAGE_BUCKET?.trim() || "kyro-files";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "auto";
const DEFAULT_IMAGE_QUALITY = "high";
const MAX_REFERENCE_IMAGES = 8;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const ensuredGeneratedImageBuckets = new Set<string>();
const SUPPORTED_IMAGE_SIZES = [
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
] as const;

type SupportedImageSize = (typeof SUPPORTED_IMAGE_SIZES)[number];

export type GeneratedKyroImage = {
  aiRunId: string;
  contentType: string;
  downloadHref: string;
  editMode: boolean;
  fileId: string;
  filename: string;
  href: string;
  model: string;
  prompt: string;
  provider: "openai";
  quality: string;
  referenceFiles: Array<{
    contentType: string;
    fileId: string;
    filename: string;
  }>;
  revisedPrompt: string | null;
  size: string;
  sizeBytes: number;
  storageBucket: string;
  storagePath: string;
};

type WorkspaceInput = {
  id: string;
  name: string;
};

type ReferenceImage = {
  bytes: Buffer;
  contentType: string;
  fileId: string;
  filename: string;
};

function envValue(key: string) {
  return process.env[key]?.trim() ?? "";
}

function openAiApiKey() {
  return envValue("OPENAI_API_KEY");
}

function imageModel() {
  return envValue("OPENAI_IMAGE_MODEL") || DEFAULT_IMAGE_MODEL;
}

function normalizeImageSize(value: string | null): SupportedImageSize | null {
  const normalized = value?.toLowerCase().replace(/\s+/g, "") ?? "";

  return SUPPORTED_IMAGE_SIZES.includes(normalized as SupportedImageSize)
    ? (normalized as SupportedImageSize)
    : null;
}

function ratioSizeFromPrompt(prompt: string): SupportedImageSize | null {
  const ratio = prompt.match(/\b(\d{1,2})\s*[:x/]\s*(\d{1,2})\b/i);

  if (!ratio) {
    return null;
  }

  const width = Number(ratio[1]);
  const height = Number(ratio[2]);

  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return null;
  }

  const aspect = width / height;

  if (Math.abs(aspect - 1) < 0.12) {
    return "1024x1024";
  }

  return aspect > 1 ? "1536x1024" : "1024x1536";
}

export function imageSizeForPrompt(prompt: string) {
  const text = prompt
    .toLowerCase()
    .replace(/[^a-z0-9:\/\sx-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ratioSize = ratioSizeFromPrompt(text);

  if (ratioSize) {
    return ratioSize;
  }

  if (
    /\b(square|1\s*[:x/]\s*1|9\s*[:x/]\s*9|icon|avatar|logo)\b/.test(text) ||
    /\binstagram\b/.test(text) && /\b(post|grid|feed)\b/.test(text)
  ) {
    return "1024x1024";
  }

  if (
    /\b(portrait|vertical|phone|mobile|story|stories|reel|tiktok|poster|flyer|a4|letter|tall)\b/.test(
      text,
    )
  ) {
    return "1024x1536";
  }

  if (
    /\b(landscape|wide|horizontal|banner|hero|cover|thumbnail|website)\b/.test(
      text,
    )
  ) {
    return "1536x1024";
  }

  return normalizeImageSize(envValue("OPENAI_IMAGE_SIZE")) ?? DEFAULT_IMAGE_SIZE;
}

function imageQuality() {
  return envValue("OPENAI_IMAGE_QUALITY") || DEFAULT_IMAGE_QUALITY;
}

function safeStorageSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 96) || "image"
  );
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function openAiErrorMessage(payload: unknown) {
  const error = objectRecord(payload).error;

  if (error && typeof error === "object") {
    return textValue(objectRecord(error).message);
  }

  return null;
}

function imageResponseData(payload: unknown) {
  const data = objectRecord(payload).data;

  return Array.isArray(data) ? objectRecord(data[0]) : {};
}

function responseProviderUsageId(payload: unknown) {
  return textValue(objectRecord(payload).id);
}

function imageBase64OrUrl(payload: unknown) {
  const first = imageResponseData(payload);

  return {
    b64Json: textValue(first.b64_json),
    revisedPrompt: textValue(first.revised_prompt),
    url: textValue(first.url),
  };
}

function sourceFileIdsFromPrompt(prompt: string) {
  const ids = new Set<string>();
  const pattern =
    /\b(?:kyro\s+file\s+id|file\s+id|source\s+file)\s*:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;
  let match = pattern.exec(prompt);

  while (match?.[1]) {
    ids.add(match[1]);
    match = pattern.exec(prompt);
  }

  return [...ids].slice(0, MAX_REFERENCE_IMAGES);
}

function isSupportedReferenceImage(contentType: string | null) {
  return (
    contentType === "image/png" ||
    contentType === "image/jpeg" ||
    contentType === "image/jpg" ||
    contentType === "image/webp"
  );
}

async function ensureGeneratedImageBucket(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  bucket: string,
) {
  if (ensuredGeneratedImageBuckets.has(bucket)) {
    return;
  }

  const { error } = await serviceSupabase.storage.getBucket(bucket);

  if (!error) {
    ensuredGeneratedImageBuckets.add(bucket);
    return;
  }

  const { error: createError } = await serviceSupabase.storage.createBucket(
    bucket,
    {
      public: false,
    },
  );

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(createError.message);
  }

  ensuredGeneratedImageBuckets.add(bucket);
}

function buildImagePrompt({
  prompt,
  workspace,
}: {
  prompt: string;
  workspace: WorkspaceInput;
}) {
  return [
    `Workspace: ${workspace.name}`,
    "Create a polished, practical image for a trades business workflow.",
    "Default to a premium photorealistic result unless the user explicitly asks for illustration, diagram, cartoon, or graphic design.",
    "For architecture, renovation concepts, houses, interiors, bathrooms, kitchens, landscaping, and project renders, use realistic architectural photography: crisp detail, natural daylight or plausible lighting, real materials, believable proportions, and no soft CGI or painterly look.",
    "If the user asks for a renovation concept or project rendering, keep it realistic and clearly useful for explaining the proposed job to a customer.",
    "If the user asks for marketing, social, or text-heavy material, keep the hierarchy clean and every word legible; avoid tiny fine print.",
    "Do not invent regulated claims, prices, license numbers, or guarantees unless the user provided them.",
    `User request: ${prompt}`,
  ].join("\n");
}

async function loadReferenceImages({
  sourceFileIds,
  workspaceId,
}: {
  sourceFileIds: string[];
  workspaceId: string;
}) {
  if (sourceFileIds.length === 0) {
    return [] as ReferenceImage[];
  }

  const serviceSupabase = createServiceSupabaseClient();
  const { data, error } = await serviceSupabase
    .from("files")
    .select("id,storage_bucket,storage_path,filename,content_type,size_bytes")
    .eq("workspace_id", workspaceId)
    .in("id", sourceFileIds);

  if (error) {
    throw new Error(`Unable to load image reference files: ${error.message}`);
  }

  const references: ReferenceImage[] = [];

  for (const row of data ?? []) {
    const contentType = textValue(row.content_type);

    if (!isSupportedReferenceImage(contentType)) {
      continue;
    }

    const sizeBytes =
      typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes ?? 0);

    if (sizeBytes > MAX_REFERENCE_IMAGE_BYTES) {
      continue;
    }

    const { data: blob, error: downloadError } = await serviceSupabase.storage
      .from(String(row.storage_bucket))
      .download(String(row.storage_path));

    if (downloadError || !blob) {
      continue;
    }

    references.push({
      bytes: Buffer.from(await blob.arrayBuffer()),
      contentType: contentType ?? "image/png",
      fileId: String(row.id),
      filename: String(row.filename),
    });
  }

  return references.slice(0, MAX_REFERENCE_IMAGES);
}

async function callOpenAiImageApi({
  apiKey,
  model,
  prompt,
  quality,
  references,
  size,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  quality: string;
  references: ReferenceImage[];
  size: string;
}) {
  if (references.length > 0) {
    const body = new FormData();

    body.set("model", model);
    body.set("prompt", prompt);
    body.set("n", "1");
    body.set("quality", quality);
    body.set("size", size);

    const imageFieldName = references.length > 1 ? "image[]" : "image";

    for (const reference of references) {
      body.append(
        imageFieldName,
        new Blob([new Uint8Array(reference.bytes)], {
          type: reference.contentType,
        }),
        reference.filename,
      );
    }

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      body,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new Error(
        openAiErrorMessage(payload) ??
          `OpenAI image editing failed with HTTP ${response.status}.`,
      );
    }

    return payload;
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    body: JSON.stringify({
      model,
      n: 1,
      prompt,
      quality,
      size,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(
      openAiErrorMessage(payload) ??
        `OpenAI image generation failed with HTTP ${response.status}.`,
    );
  }

  return payload;
}

async function imageBytesFromPayload(payload: unknown) {
  const { b64Json, url } = imageBase64OrUrl(payload);

  if (b64Json) {
    return {
      bytes: Buffer.from(b64Json, "base64"),
      contentType: "image/png",
    };
  }

  if (url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Unable to download generated image from OpenAI.`);
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "image/png",
    };
  }

  throw new Error("OpenAI did not return generated image data.");
}

export async function generateKyroImage({
  prompt,
  supabase,
  user,
  workspace,
}: {
  prompt: string;
  supabase: SupabaseClient;
  user: User;
  workspace: WorkspaceInput;
}): Promise<GeneratedKyroImage> {
  const apiKey = openAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for image generation.");
  }

  const model = imageModel();
  const size = imageSizeForPrompt(prompt);
  const quality = imageQuality();
  const requestedPrompt = prompt.trim();
  const sourceFileIds = sourceFileIdsFromPrompt(requestedPrompt);
  const references = await loadReferenceImages({
    sourceFileIds,
    workspaceId: workspace.id,
  });
  const providerPrompt = buildImagePrompt({
    prompt: requestedPrompt,
    workspace,
  });
  const startedAt = Date.now();
  const { data: aiRun, error: aiRunError } = await supabase
    .from("ai_runs")
    .insert({
      actual_cost: "0",
      estimated_cost: "0",
      input_refs: {
        prompt: requestedPrompt,
        referenceFileIds: references.map((reference) => reference.fileId),
        source: "assistant.image_generation",
      },
      mode: "tool",
      model,
      output: {},
      provider: "openai",
      risk_level: "medium",
      status: "running",
      task_type: "image_generation",
      tool_calls: [
        {
          input: {
            model,
            prompt: requestedPrompt,
            quality,
            referenceFileCount: references.length,
            size,
          },
          name: references.length > 0 ? "image.edit" : "image.generate",
          result: {},
          status: "proposed",
        },
      ],
      usage: {},
      user_id: user.id,
      workspace_id: workspace.id,
    })
    .select("id")
    .single();

  if (aiRunError || !aiRun) {
    throw new Error(
      `Unable to create image generation AI run: ${
        aiRunError?.message ?? "unknown error"
      }`,
    );
  }

  const aiRunId = String(aiRun.id);
  const serviceSupabase = createServiceSupabaseClient();
  const bucket = GENERATED_IMAGE_BUCKET;

  try {
    const payload = await callOpenAiImageApi({
      apiKey,
      model,
      prompt: providerPrompt,
      quality,
      references,
      size,
    });
    const providerUsageId = responseProviderUsageId(payload);
    const providerUsage = openAiImageUsageFromResponse(payload);
    const { revisedPrompt } = imageBase64OrUrl(payload);
    const generated = await imageBytesFromPayload(payload);
    const extension =
      generated.contentType === "image/webp"
        ? "webp"
        : generated.contentType === "image/jpeg" ||
            generated.contentType === "image/jpg"
          ? "jpg"
          : "png";
    const contentHash = createHash("sha256")
      .update(generated.bytes)
      .digest("hex");
    const now = new Date();
    const filename = `kyro-generated-${safeStorageSegment(
      requestedPrompt.split(/\s+/).slice(0, 6).join("-") || "image",
    )}-${contentHash.slice(0, 10)}.${extension}`;
    const storagePath = [
      workspace.id,
      "generated-images",
      `${now.getUTCFullYear()}`,
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${randomUUID()}-${safeStorageSegment(filename)}`,
    ].join("/");

    await ensureGeneratedImageBucket(serviceSupabase, bucket);

    const { error: uploadError } = await serviceSupabase.storage
      .from(bucket)
      .upload(storagePath, generated.bytes, {
        contentType: generated.contentType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Unable to store generated image: ${uploadError.message}`);
    }

    const { data: file, error: fileError } = await serviceSupabase
      .from("files")
      .insert({
        workspace_id: workspace.id,
        storage_bucket: bucket,
        storage_path: storagePath,
        filename,
        content_type: generated.contentType,
        size_bytes: generated.bytes.byteLength,
        source: "generated_image",
      })
      .select("id")
      .single();

    if (fileError || !file) {
      throw new Error(
        `Unable to record generated image metadata: ${
          fileError?.message ?? "unknown error"
        }`,
      );
    }

    const fileId = String(file.id);
    const usageEvent = buildOpenAiImageGenerationUsageEvent({
      context: {
        aiRunId,
        metadata: {
          source: "assistant.image_generation",
          referenceFileCount: references.length,
        },
        providerUsageId,
        sourceId: aiRunId,
        sourceType: "ai_run",
        userId: user.id,
        workspaceId: workspace.id,
      },
      editMode: references.length > 0,
      model,
      providerUsage,
      quality,
      size,
    });
    const totals = usageEventTotals([usageEvent]);
    const { error: usageError } = await supabase
      .from("usage_events")
      .insert(toUsageEventRows([usageEvent]));

    if (usageError) {
      throw new Error(
        `Unable to record image generation usage: ${usageError.message}`,
      );
    }

    const output = {
      contentHash,
      contentType: generated.contentType,
      editMode: references.length > 0,
      fileId,
      filename,
      providerUsageId,
      providerUsage,
      quality,
      referenceFileIds: references.map((reference) => reference.fileId),
      revisedPrompt,
      size,
      sizeBytes: generated.bytes.byteLength,
      storageBucket: bucket,
      storagePath,
    };

    const { error: completeError } = await supabase
      .from("ai_runs")
      .update({
        actual_cost: String(totals.costSnapshot),
        completed_at: new Date().toISOString(),
        estimated_cost: String(totals.costSnapshot),
        latency_ms: Date.now() - startedAt,
        output,
        status: "completed",
        tool_calls: [
          {
            input: {
              model,
              prompt: requestedPrompt,
              quality,
              referenceFileCount: references.length,
              size,
            },
            name: references.length > 0 ? "image.edit" : "image.generate",
            result: output,
            status: "completed",
          },
        ],
        usage: {
          customerCharge: totals.customerChargeSnapshot,
          imageCount: 1,
          providerCost: totals.costSnapshot,
          providerUsage,
        },
      })
      .eq("id", aiRunId);

    if (completeError) {
      throw new Error(`Unable to complete image AI run: ${completeError.message}`);
    }

    await insertAuditLog(supabase, {
      workspaceId: workspace.id,
      action: "image.generated",
      actorId: aiRunId,
      actorType: "ai",
      after: output,
      entityId: fileId,
      entityType: "file",
      metadata: {
        requestedByUserId: user.id,
        source: "assistant.image_generation",
      },
    });

    return {
      aiRunId,
      contentType: generated.contentType,
      downloadHref: `/api/files/${fileId}`,
      editMode: references.length > 0,
      fileId,
      filename,
      href: `/api/files/${fileId}?disposition=inline`,
      model,
      prompt: requestedPrompt,
      provider: "openai",
      quality,
      referenceFiles: references.map((reference) => ({
        contentType: reference.contentType,
        fileId: reference.fileId,
        filename: reference.filename,
      })),
      revisedPrompt,
      size,
      sizeBytes: generated.bytes.byteLength,
      storageBucket: bucket,
      storagePath,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to generate image.";

    await supabase
      .from("ai_runs")
      .update({
        completed_at: new Date().toISOString(),
        error: message,
        latency_ms: Date.now() - startedAt,
        status: "failed",
        tool_calls: [
          {
            input: {
              model,
              prompt: requestedPrompt,
              quality,
              referenceFileCount: references.length,
              size,
            },
            name: references.length > 0 ? "image.edit" : "image.generate",
            result: { error: message },
            status: "blocked",
          },
        ],
      })
      .eq("id", aiRunId);

    throw error;
  }
}

export function looksLikeKyroImageGenerationRequest(prompt: string) {
  const text = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const explicitOutputWords =
    /\b(image|images|imag|img|mage|picture|pic|photo|visual|render|rendering|mockup|concept|graphic|flyer|poster|instagram|facebook|social|ad|advert|marketing|before after|version|variation|variant)\b/;
  const projectWords =
    /\b(bathroom|kitchen|renovation|remodel|extension|deck|laundry|ensuite|backyard|garden|patio|outdoor|pool|landscaping)\b/;
  const actionWords =
    /\b(generate|generation|create|make|design|visualise|visualize|show|turn|mock up|render|draw|produce|edit|change|update|adjust|modify|redo|regenerate|rework|revise)\b/;
  const visualSceneWords =
    /\b(overlooking|looking over|view of|with a view|concept for|render of|mockup of|visual of)\b/;

  if (explicitOutputWords.test(text) && actionWords.test(text)) {
    return true;
  }

  if (projectWords.test(text)) {
    return (
      visualSceneWords.test(text) ||
      /\bwhat (?:this|it|the|my|our) .{0,40}?(?:could|would|will) look like\b/.test(
        text,
      ) ||
      /\b(show|render|visualise|visualize|mock up|create|make|generate) .{0,80}?(?:look like|after|concept|design|image|picture|photo|visual|render)\b/.test(
        text,
      )
    );
  }

  return /\bwhat (?:this|it) (?:could|would) look like\b/.test(text);
}
