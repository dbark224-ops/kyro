import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  mobileErrorResponse,
  requireMobileWorkspaceContext,
} from "../../../../../lib/mobile/context";

export const dynamic = "force-dynamic";

type ReportPayload = {
  generatedAt?: string;
  periodLabel?: string;
  sections?: Array<{
    columns?: string[];
    emptyText?: string;
    rows?: string[][];
    title?: string;
  }>;
  summaryCards?: Array<{
    detail?: string;
    label?: string;
    value?: string;
  }>;
  subtitle?: string;
  title?: string;
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function wrapText(text: string, maxChars: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

export async function POST(request: Request) {
  try {
    await requireMobileWorkspaceContext(request);
    const payload = (await request.json().catch(() => null)) as ReportPayload | null;

    if (!payload || typeof payload !== "object") {
      throw new Error("Report payload is required.");
    }

    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([612, 792]);
    const margin = 48;
    const width = page.getWidth();
    let y = 730;

    const ensureSpace = (height: number) => {
      if (y - height > margin) {
        return;
      }

      page = pdf.addPage([612, 792]);
      y = 730;
    };
    const drawText = (
      text: string,
      options: {
        color?: ReturnType<typeof rgb>;
        font?: typeof regular;
        maxChars?: number;
        size?: number;
      } = {},
    ) => {
      const size = options.size ?? 10;
      const lines = wrapText(text, options.maxChars ?? 92);

      for (const line of lines) {
        ensureSpace(size + 8);
        page.drawText(line, {
          color: options.color ?? rgb(0.08, 0.09, 0.12),
          font: options.font ?? regular,
          size,
          x: margin,
          y,
        });
        y -= size + 6;
      }
    };

    drawText(stringValue(payload.title) ?? "Workspace report", {
      font: bold,
      maxChars: 56,
      size: 24,
    });
    drawText(stringValue(payload.subtitle) ?? "Kyro report", {
      color: rgb(0.36, 0.38, 0.44),
      maxChars: 80,
      size: 11,
    });
    drawText(
      `Generated ${new Date(
        stringValue(payload.generatedAt) ?? Date.now(),
      ).toLocaleString("en")}`,
      {
        color: rgb(0.36, 0.38, 0.44),
        size: 9,
      },
    );
    y -= 16;

    const summaryCards = payload.summaryCards ?? [];

    if (summaryCards.length) {
      drawText("Summary", { font: bold, size: 13 });
      for (const card of summaryCards) {
        drawText(
          `${stringValue(card.label) ?? "Metric"}: ${
            stringValue(card.value) ?? "-"
          }${card.detail ? ` - ${card.detail}` : ""}`,
          { maxChars: 88, size: 10 },
        );
      }
      y -= 12;
    }

    for (const section of payload.sections ?? []) {
      ensureSpace(70);
      drawText(stringValue(section.title) ?? "Rows", { font: bold, size: 13 });
      const columns = section.columns?.length ? section.columns : ["Item", "Value"];
      const rows = section.rows ?? [];

      if (!rows.length) {
        drawText(stringValue(section.emptyText) ?? "No rows in this report.", {
          color: rgb(0.36, 0.38, 0.44),
          size: 10,
        });
        y -= 8;
        continue;
      }

      drawText(columns.join("  |  "), {
        color: rgb(0.0, 0.55, 0.7),
        font: bold,
        maxChars: 90,
        size: 9,
      });

      for (const row of rows) {
        ensureSpace(36);
        const line = row.map((cell) => cell || "-").join("  |  ");
        drawText(line, { maxChars: 112, size: 8.5 });
      }

      y -= 10;
    }

    page.drawText("Kyro", {
      color: rgb(0.0, 0.55, 0.7),
      font: bold,
      size: 9,
      x: width - margin - 24,
      y: 28,
    });

    const bytes = await pdf.save();
    const title = sanitizeFilename(stringValue(payload.title) ?? "kyro-report");

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Disposition": `inline; filename="${title || "kyro-report"}.pdf"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
