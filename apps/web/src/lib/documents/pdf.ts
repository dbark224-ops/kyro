import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getQuoteDraftProfile, type QuoteDraftProfile } from "../crm/queries";
import {
  documentTemplateDesignSettingsForQuote,
  getDocumentTemplateSettings,
  type DocumentTemplateDesignSettings,
} from "./settings";
import { quoteDocumentContentHash } from "./history";
import { normalizeQuoteLineItems, type QuoteLineItem } from "./templates";

type WorkspaceForDocument = {
  id?: string;
  name: string;
};

type BusinessProfileForDocument = {
  businessName: string | null;
  defaultReplyInstructions: string | null;
  description: string | null;
  industry: string | null;
  serviceArea: string | null;
  toneOfVoice: string | null;
} | null;

type PdfRenderInput = {
  businessProfile: BusinessProfileForDocument;
  generatedAt?: Date;
  profile: QuoteDraftProfile;
  settings: DocumentTemplateDesignSettings;
  workspace: WorkspaceForDocument;
};

export type QuotePdfArtifact = {
  bytes: Uint8Array;
  contentBase64: string;
  contentHash: string;
  contentType: "application/pdf";
  filename: string;
  generatedAt: string;
  sizeBytes: number;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const THEME_COLORS: Record<DocumentTemplateDesignSettings["accentTheme"], [number, number, number]> = {
  blue: [0.145, 0.388, 0.922],
  cyan: [0.031, 0.569, 0.698],
  graphite: [0.067, 0.094, 0.153],
  green: [0.086, 0.639, 0.29],
  pink: [0.859, 0.153, 0.467],
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeFilename(value: string) {
  return (
    value
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/[\\/:*?"<>|\r\n]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "quote-document"
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) {
    return "To be confirmed";
  }

  return new Intl.NumberFormat("en", {
    currency,
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);

  next.setDate(next.getDate() + days);

  return next;
}

function lineItemTotal(item: QuoteLineItem) {
  if (item.total !== null) {
    return item.total;
  }

  return item.quantity !== null && item.unitPrice !== null
    ? Math.round(item.quantity * item.unitPrice * 100) / 100
    : null;
}

function lineItemQuantity(item: QuoteLineItem) {
  return [item.quantity, item.unit].filter(Boolean).join(" ") || "-";
}

function customerName(profile: QuoteDraftProfile) {
  const metadata = profile.quoteDraft.metadata;

  return (
    textValue(metadata.customerName) ??
    profile.quoteDraft.contact?.name ??
    profile.quoteDraft.contact?.company ??
    textValue(metadata.customerCompany) ??
    "Customer"
  );
}

function customerMeta(profile: QuoteDraftProfile) {
  const metadata = profile.quoteDraft.metadata;

  return [
    textValue(metadata.customerCompany) ?? profile.quoteDraft.contact?.company,
    textValue(metadata.customerEmail) ?? profile.quoteDraft.contact?.email,
    textValue(metadata.customerPhone) ?? profile.quoteDraft.contact?.phone,
  ].filter(Boolean) as string[];
}

function jobDetails(profile: QuoteDraftProfile) {
  const metadata = profile.quoteDraft.metadata;

  return [
    [
      "Job type",
      textValue(metadata.jobType) ??
        profile.inquiryFacts?.jobType ??
        profile.quoteDraft.lead?.serviceType,
    ],
    [
      "Address",
      textValue(metadata.jobAddress) ?? profile.inquiryFacts?.address,
    ],
    [
      "Preferred time",
      textValue(metadata.preferredTime) ?? profile.inquiryFacts?.preferredTime,
    ],
    ["Budget", profile.inquiryFacts?.budget],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));
}

function colorTuple(value: [number, number, number]) {
  return rgb(value[0], value[1], value[2]);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";

    for (const word of words) {
      const next = line ? `${line} ${word}` : word;

      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
        continue;
      }

      if (line) {
        lines.push(line);
      }

      line = word;
    }

    lines.push(line || " ");
  }

  return lines;
}

function drawWrappedText({
  color = rgb(0.067, 0.094, 0.153),
  font,
  lineHeight = 15,
  maxLines = 100,
  maxWidth,
  page,
  size,
  text,
  x,
  y,
}: {
  color?: ReturnType<typeof rgb>;
  font: PDFFont;
  lineHeight?: number;
  maxLines?: number;
  maxWidth: number;
  page: PDFPage;
  size: number;
  text: string;
  x: number;
  y: number;
}) {
  const lines = wrapText(text, font, size, maxWidth).slice(0, maxLines);

  lines.forEach((line, index) => {
    page.drawText(line, {
      color,
      font,
      size,
      x,
      y: y - index * lineHeight,
    });
  });

  return y - lines.length * lineHeight;
}

function drawLabel(page: PDFPage, text: string, x: number, y: number, font: PDFFont, accent: ReturnType<typeof rgb>) {
  page.drawText(text.toUpperCase(), {
    color: accent,
    font,
    size: 8,
    x,
    y,
  });
}

function drawCard(
  page: PDFPage,
  {
    height,
    width,
    x,
    y,
  }: {
    height: number;
    width: number;
    x: number;
    y: number;
  },
) {
  page.drawRectangle({
    borderColor: rgb(0.898, 0.906, 0.922),
    borderWidth: 1,
    color: rgb(1, 1, 1),
    height,
    width,
    x,
    y: y - height,
  });
}

export function quotePdfFilename(title: string) {
  return `${safeFilename(title)}.pdf`;
}

export async function buildQuoteDocumentPdf({
  businessProfile,
  generatedAt = new Date(),
  profile,
  settings,
  workspace,
}: PdfRenderInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const quote = profile.quoteDraft;
  const lineItems = normalizeQuoteLineItems(quote.lineItems);
  const subtotal = lineItems.reduce(
    (sum, item) => sum + (lineItemTotal(item) ?? 0),
    0,
  );
  const hasPricedItems = lineItems.some((item) => lineItemTotal(item) !== null);
  const businessName =
    textValue(businessProfile?.businessName) ?? workspace.name ?? "Kyro customer";
  const accent = colorTuple(THEME_COLORS[settings.accentTheme]);
  const muted = rgb(0.392, 0.439, 0.522);
  const ink = rgb(0.067, 0.094, 0.153);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(height: number) {
    if (y - height > MARGIN) {
      return;
    }

    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  page.drawRectangle({
    color: accent,
    height: 6,
    width: CONTENT_WIDTH,
    x: MARGIN,
    y,
  });
  y -= 42;

  drawLabel(page, businessName, MARGIN, y, bold, accent);
  y -= 34;
  y = drawWrappedText({
    font: bold,
    lineHeight: 36,
    maxLines: 2,
    maxWidth: 330,
    page,
    size: 36,
    text: quote.title,
    x: MARGIN,
    y,
  });

  const metaX = PAGE_WIDTH - MARGIN - 160;
  const metaY = PAGE_HEIGHT - MARGIN - 36;
  drawCard(page, { height: 86, width: 160, x: metaX, y: metaY + 8 });
  [
    ["Created", formatDate(generatedAt)],
    ["Valid until", formatDate(addDays(generatedAt, settings.validityDays))],
    ["Status", quote.status],
  ].forEach(([label, value], index) => {
    const rowY = metaY - index * 24;
    page.drawText(label, { color: muted, font: regular, size: 10, x: metaX + 14, y: rowY });
    page.drawText(value, {
      color: ink,
      font: bold,
      size: 10,
      x: metaX + 82,
      y: rowY,
    });
  });

  y -= 22;
  const cardY = y;
  const cardWidth = (CONTENT_WIDTH - 16) / 2;
  drawCard(page, { height: 104, width: cardWidth, x: MARGIN, y: cardY });
  drawCard(page, {
    height: 104,
    width: cardWidth,
    x: MARGIN + cardWidth + 16,
    y: cardY,
  });
  drawLabel(page, "Prepared for", MARGIN + 14, cardY - 22, bold, accent);
  page.drawText(customerName(profile), {
    color: ink,
    font: bold,
    size: 14,
    x: MARGIN + 14,
    y: cardY - 44,
  });
  const customerLines = customerMeta(profile);
  drawWrappedText({
    color: muted,
    font: regular,
    lineHeight: 13,
    maxLines: 3,
    maxWidth: cardWidth - 28,
    page,
    size: 10,
    text:
      customerLines.length > 0
        ? customerLines.join("\n")
        : "No customer contact details saved yet.",
    x: MARGIN + 14,
    y: cardY - 64,
  });

  const jobX = MARGIN + cardWidth + 30;
  drawLabel(page, "Job details", jobX, cardY - 22, bold, accent);
  const jobLines = jobDetails(profile).map(([label, value]) => `${label}: ${value}`);
  drawWrappedText({
    color: muted,
    font: regular,
    lineHeight: 13,
    maxLines: 5,
    maxWidth: cardWidth - 28,
    page,
    size: 10,
    text: jobLines.length > 0 ? jobLines.join("\n") : "No job details saved yet.",
    x: jobX,
    y: cardY - 46,
  });
  y -= 132;

  ensureSpace(120);
  const tableTop = y;
  page.drawRectangle({
    color: ink,
    height: 30,
    width: CONTENT_WIDTH,
    x: MARGIN,
    y: tableTop - 30,
  });
  page.drawText("SCOPE", { color: rgb(1, 1, 1), font: bold, size: 9, x: MARGIN + 12, y: tableTop - 20 });
  page.drawText("QUANTITY", { color: rgb(1, 1, 1), font: bold, size: 9, x: MARGIN + 350, y: tableTop - 20 });
  page.drawText("AMOUNT", { color: rgb(1, 1, 1), font: bold, size: 9, x: MARGIN + 455, y: tableTop - 20 });
  y -= 44;

  if (lineItems.length === 0) {
    page.drawText("No line items saved yet.", { color: muted, font: regular, size: 11, x: MARGIN + 12, y });
    y -= 28;
  } else {
    for (const item of lineItems) {
      ensureSpace(58);
      const rowTop = y + 16;
      page.drawLine({
        color: rgb(0.898, 0.906, 0.922),
        end: { x: MARGIN + CONTENT_WIDTH, y: rowTop - 34 },
        start: { x: MARGIN, y: rowTop - 34 },
        thickness: 1,
      });
      y = drawWrappedText({
        font: bold,
        lineHeight: 14,
        maxLines: 2,
        maxWidth: 310,
        page,
        size: 11,
        text: item.description,
        x: MARGIN + 12,
        y,
      });
      if (item.notes) {
        y = drawWrappedText({
          color: muted,
          font: regular,
          lineHeight: 12,
          maxLines: 2,
          maxWidth: 310,
          page,
          size: 9,
          text: item.notes,
          x: MARGIN + 12,
          y,
        });
      }
      page.drawText(lineItemQuantity(item), {
        color: ink,
        font: regular,
        size: 11,
        x: MARGIN + 360,
        y: rowTop - 18,
      });
      page.drawText(formatMoney(lineItemTotal(item), settings.currency), {
        color: ink,
        font: regular,
        size: 11,
        x: MARGIN + 455,
        y: rowTop - 18,
      });
      y = Math.min(y, rowTop - 44);
    }
  }

  ensureSpace(92);
  page.drawRectangle({
    color: rgb(0.973, 0.98, 0.988),
    height: 58,
    width: 190,
    x: PAGE_WIDTH - MARGIN - 190,
    y: y - 58,
  });
  page.drawText(hasPricedItems ? "Subtotal" : "Pricing", {
    color: muted,
    font: regular,
    size: 11,
    x: PAGE_WIDTH - MARGIN - 170,
    y: y - 20,
  });
  page.drawText(
    hasPricedItems ? formatMoney(subtotal, settings.currency) : "To be confirmed",
    {
      color: ink,
      font: bold,
      size: hasPricedItems ? 18 : 16,
      x: PAGE_WIDTH - MARGIN - 170,
      y: y - 44,
    },
  );
  y -= 86;

  const noteSections = [
    quote.notes ? ["Notes", quote.notes] : null,
    ["Payment and approval", settings.paymentTerms],
  ].filter((section): section is [string, string] => Boolean(section));

  for (const [label, value] of noteSections) {
    ensureSpace(82);
    const boxTop = y;
    page.drawRectangle({
      color: rgb(0.973, 0.98, 0.988),
      height: 70,
      width: CONTENT_WIDTH,
      x: MARGIN,
      y: boxTop - 70,
    });
    page.drawRectangle({
      color: accent,
      height: 70,
      width: 3,
      x: MARGIN,
      y: boxTop - 70,
    });
    page.drawText(label, { color: ink, font: bold, size: 12, x: MARGIN + 14, y: boxTop - 20 });
    drawWrappedText({
      color: ink,
      font: regular,
      lineHeight: 12,
      maxLines: 3,
      maxWidth: CONTENT_WIDTH - 28,
      page,
      size: 10,
      text: value,
      x: MARGIN + 14,
      y: boxTop - 40,
    });
    y -= 84;
  }

  ensureSpace(60);
  page.drawLine({
    color: rgb(0.898, 0.906, 0.922),
    end: { x: MARGIN + CONTENT_WIDTH, y: y - 4 },
    start: { x: MARGIN, y: y - 4 },
    thickness: 1,
  });
  y -= 24;
  const footerLines = [
    settings.showPreparedBy ? `Prepared by ${businessName}.` : null,
    settings.footerText,
    businessProfile?.serviceArea ? `Service area: ${businessProfile.serviceArea}` : null,
  ].filter((line): line is string => Boolean(line));
  drawWrappedText({
    color: muted,
    font: regular,
    lineHeight: 11,
    maxLines: 5,
    maxWidth: CONTENT_WIDTH,
    page,
    size: 9,
    text: footerLines.join("\n"),
    x: MARGIN,
    y,
  });

  return pdf.save();
}

export function quotePdfMetadata(artifact: QuotePdfArtifact) {
  return {
    contentHash: artifact.contentHash,
    contentType: artifact.contentType,
    filename: artifact.filename,
    generatedAt: artifact.generatedAt,
    renderer: "pdf-lib",
    sizeBytes: artifact.sizeBytes,
  };
}

export async function buildQuotePdfArtifact(input: PdfRenderInput): Promise<QuotePdfArtifact> {
  const generatedAt = input.generatedAt ?? new Date();
  const bytes = await buildQuoteDocumentPdf({
    ...input,
    generatedAt,
  });
  const buffer = Buffer.from(bytes);

  return {
    bytes,
    contentBase64: buffer.toString("base64"),
    contentHash: quoteDocumentContentHash({
      profile: input.profile,
      settings: input.settings,
    }),
    contentType: "application/pdf",
    filename: quotePdfFilename(input.profile.quoteDraft.title),
    generatedAt: generatedAt.toISOString(),
    sizeBytes: buffer.byteLength,
  };
}

export async function buildQuotePdfArtifactForDraft(
  supabase: SupabaseClient,
  {
    generatedAt,
    quoteDraftId,
    workspace,
  }: {
    generatedAt?: Date;
    quoteDraftId: string;
    workspace: WorkspaceForDocument & { id: string };
  },
) {
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
    throw new Error("Quote draft was not found.");
  }

  if (businessProfile.error) {
    throw new Error(`Unable to load business profile: ${businessProfile.error.message}`);
  }

  return buildQuotePdfArtifact({
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
    generatedAt,
    profile,
    settings: documentTemplateDesignSettingsForQuote(
      profile.quoteDraft.metadata,
      settings,
    ),
    workspace,
  });
}

export async function buildInvoicePdfArtifactForDraft(
  supabase: SupabaseClient,
  {
    generatedAt,
    quoteDraftId,
    workspace,
  }: {
    generatedAt?: Date;
    quoteDraftId: string;
    workspace: WorkspaceForDocument & { id: string };
  },
) {
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
    throw new Error("Quote draft was not found.");
  }

  if (businessProfile.error) {
    throw new Error(`Unable to load business profile: ${businessProfile.error.message}`);
  }

  const invoiceTitle = profile.quoteDraft.title.toLowerCase().startsWith("invoice")
    ? profile.quoteDraft.title
    : `Invoice - ${profile.quoteDraft.title}`;
  const invoiceProfile: QuoteDraftProfile = {
    ...profile,
    quoteDraft: {
      ...profile.quoteDraft,
      status: "invoice",
      title: invoiceTitle,
    },
  };

  return buildQuotePdfArtifact({
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
    generatedAt,
    profile: invoiceProfile,
    settings: documentTemplateDesignSettingsForQuote(
      profile.quoteDraft.metadata,
      settings,
    ),
    workspace,
  });
}
