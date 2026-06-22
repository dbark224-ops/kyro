import type { WorkspaceReport } from "./data";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function safeFilename(value: string) {
  return (
    value
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/[\\/:*?"<>|\r\n]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 96) || "report"
  );
}

function filenameTimestamp(value: string) {
  const date = new Date(value);
  const source = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${[
    source.getFullYear(),
    pad(source.getMonth() + 1),
    pad(source.getDate()),
  ].join("-")}-${pad(source.getHours())}${pad(
    source.getMinutes(),
  )}${pad(source.getSeconds())}`;
}

export function reportFilename(report: WorkspaceReport) {
  return `${safeFilename(
    `${report.business.name} ${report.title} ${filenameTimestamp(report.generatedAt)}`,
  )}.pdf`;
}

export function buildReportPrintHtml(report: WorkspaceReport, queryString = "") {
  const logoMarkup = report.business.logoDataUrl
    ? `<img alt="${escapeHtml(report.business.name)} logo" src="${report.business.logoDataUrl}" />`
    : report.business.logoUrl
      ? `<img alt="${escapeHtml(report.business.name)} logo" src="${escapeHtml(report.business.logoUrl)}" />`
    : "";
  const brandMarkup = logoMarkup
    ? `<div class="brand-logo">${logoMarkup}</div>`
    : `<div class="brand-name">${escapeHtml(report.business.name)}</div>`;
  const notesMarkup = report.notes.length
    ? `<section class="notes">
      ${report.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
    </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.title)}</title>
  <style>
    :root {
      --ink: #111827;
      --muted: #64748b;
      --line: #dbeafe;
      --cyan: #38d9f2;
      --pink: #ec368d;
      --surface: #ffffff;
      font-family: "Manrope", "Inter", Arial, sans-serif;
    }

    @page {
      size: A4 landscape;
      margin: 14mm;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: #eef7fb;
      color: var(--ink);
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-bottom: 1px solid #d8e5ee;
      background: rgb(255 255 255 / 0.92);
      padding: 12px 18px;
    }

    .toolbar button,
    .toolbar a {
      border: 1px solid #f2c6dd;
      border-radius: 999px;
      background: #fbe4f0;
      color: #111827;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 850;
      padding: 8px 13px;
      text-decoration: none;
    }

    .page {
      width: min(1080px, calc(100vw - 32px));
      margin: 24px auto;
      border: 1px solid #d8e5ee;
      border-radius: 12px;
      background: var(--surface);
      box-shadow: 0 18px 54px rgb(15 23 42 / 0.1);
      padding: 28px;
    }

    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 18px;
      border-bottom: 2px solid var(--cyan);
      padding-bottom: 14px;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: 0;
      line-height: 1.02;
    }

    h2 {
      margin: 0 0 10px;
      font-size: 16px;
      letter-spacing: 0;
    }

    .subtitle {
      max-width: 640px;
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.42;
    }

    .brand-logo img {
      max-width: 150px;
      max-height: 76px;
      object-fit: contain;
    }

    .brand-name {
      max-width: 230px;
      color: var(--ink);
      font-size: 16px;
      font-weight: 900;
      line-height: 1.05;
      text-align: right;
    }

    .meta-grid,
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .meta-card,
    .summary-card {
      border-left: 1px solid #d8e5ee;
      padding: 2px 10px 4px;
    }

    .summary-card strong {
      display: block;
      margin: 3px 0;
      font-size: 18px;
      line-height: 1;
    }

    .meta-card span,
    .summary-card span {
      display: block;
      color: var(--muted);
      font-size: 9px;
      font-weight: 850;
      text-transform: uppercase;
    }

    .meta-card p,
    .summary-card p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.35;
    }

    section {
      margin-top: 18px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    th,
    td {
      border-bottom: 1px solid #e5eef6;
      padding: 6px 7px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }

    th {
      color: var(--muted);
      font-size: 9px;
      font-weight: 900;
      text-transform: uppercase;
    }

    td {
      font-size: 10px;
      line-height: 1.3;
    }

    .empty {
      border: 1px solid #e5eef6;
      border-radius: 12px;
      color: var(--muted);
      padding: 16px;
    }

    .notes {
      display: grid;
      gap: 6px;
      border-left: 3px solid var(--pink);
      background: #fdf7fb;
      padding: 10px 12px;
    }

    .notes p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    @media print {
      body { background: #fff; }
      .toolbar { display: none; }
      .page {
        width: auto;
        margin: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Print</button>
    <a href="/reports/pdf?${escapeHtml(queryString)}">Download PDF</a>
  </div>
  <main class="page">
    <header>
      <div>
        <h1>${escapeHtml(report.title)}</h1>
        <p class="subtitle">${escapeHtml(report.subtitle)}</p>
      </div>
      ${brandMarkup}
    </header>
    <div class="meta-grid">
      <div class="meta-card">
        <span>Workspace</span>
        <strong>${escapeHtml(report.business.name)}</strong>
      </div>
      <div class="meta-card">
        <span>Generated</span>
        <strong>${escapeHtml(formatDateTime(report.generatedAt))}</strong>
      </div>
      ${report.filters
        .slice(0, 2)
        .map(
          (filter) => `<div class="meta-card">
        <span>${escapeHtml(filter.label)}</span>
        <strong>${escapeHtml(filter.value)}</strong>
      </div>`,
        )
        .join("")}
    </div>
    <div class="summary-grid">
      ${report.summaryCards
        .map(
          (card) => `<article class="summary-card">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.value)}</strong>
        ${card.detail ? `<p>${escapeHtml(card.detail)}</p>` : ""}
      </article>`,
        )
        .join("")}
    </div>
    ${report.sections
      .map((section) => {
        const rows = section.rows.length
          ? `<table>
        <thead>
          <tr>${section.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${section.rows
            .map(
              (row) =>
                `<tr>${section.columns
                  .map((_, index) => `<td>${escapeHtml(row[index] ?? "-")}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>`
          : `<p class="empty">${escapeHtml(section.emptyText ?? "No rows for this report.")}</p>`;

        return `<section>
      <h2>${escapeHtml(section.title)}</h2>
      ${section.description ? `<p class="subtitle">${escapeHtml(section.description)}</p>` : ""}
      ${rows}
    </section>`;
      })
      .join("")}
    ${notesMarkup}
  </main>
</body>
</html>`;
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

function drawTextLines({
  color = rgb(0.067, 0.094, 0.153),
  font,
  lineHeight,
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
  lineHeight: number;
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

function truncatedText(value: string, maxLength = 140) {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value;
}

function drawCompactItem({
  detail,
  fonts,
  label,
  page,
  value,
  width,
  x,
  y,
}: {
  detail?: string;
  fonts: { bold: PDFFont; regular: PDFFont };
  label: string;
  page: PDFPage;
  value: string;
  width: number;
  x: number;
  y: number;
}) {
  const muted = rgb(0.392, 0.439, 0.522);
  const ink = rgb(0.067, 0.094, 0.153);

  page.drawText(truncatedText(label.toUpperCase(), 24), {
    color: muted,
    font: fonts.bold,
    size: 6.5,
    x,
    y,
  });
  page.drawText(truncatedText(value, 32), {
    color: ink,
    font: fonts.bold,
    size: 10,
    x,
    y: y - 13,
  });

  if (detail) {
    page.drawText(truncatedText(detail, 44), {
      color: muted,
      font: fonts.regular,
      size: 6.5,
      x,
      y: y - 24,
    });
  }

  if (width > 0) {
    page.drawLine({
      color: rgb(0.86, 0.9, 0.94),
      end: { x: x + width - 8, y: y - 31 },
      start: { x, y: y - 31 },
      thickness: 0.7,
    });
  }
}

function drawCompactGrid({
  fonts,
  items,
  page,
  y,
}: {
  fonts: { bold: PDFFont; regular: PDFFont };
  items: Array<{ detail?: string; label: string; value: string }>;
  page: PDFPage;
  y: number;
}) {
  const gap = 14;
  const width = (CONTENT_WIDTH - gap * (items.length - 1)) / items.length;

  items.forEach((item, index) => {
    drawCompactItem({
      ...item,
      fonts,
      page,
      width,
      x: MARGIN + index * (width + gap),
      y,
    });
  });

  return y - 42;
}

function columnWeight(column: string) {
  const value = column.toLowerCase();

  if (value.includes("date") || value.includes("updated")) {
    return 1.1;
  }

  if (
    value.includes("direction") ||
    value.includes("channel") ||
    value.includes("status") ||
    value.includes("type") ||
    value.includes("size")
  ) {
    return 0.85;
  }

  if (
    value.includes("amount") ||
    value.includes("charge") ||
    value.includes("cost") ||
    value.includes("usage")
  ) {
    return 0.9;
  }

  if (
    value.includes("preview") ||
    value.includes("message") ||
    value.includes("missing") ||
    value.includes("filename")
  ) {
    return 2.2;
  }

  if (
    value.includes("contact") ||
    value.includes("subject") ||
    value.includes("title") ||
    value.includes("model")
  ) {
    return 1.35;
  }

  return 1;
}

function resolveColumnWidths(columns: string[]) {
  const weights = columns.map(columnWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  return weights.map((weight) => (CONTENT_WIDTH * weight) / total);
}

async function embedReportLogo(
  pdf: PDFDocument,
  report: WorkspaceReport,
): Promise<PDFImage | null> {
  if (!report.business.logoContentBase64 || !report.business.logoContentType) {
    return null;
  }

  const contentType = report.business.logoContentType.toLowerCase();
  const bytes = Buffer.from(report.business.logoContentBase64, "base64");

  try {
    if (contentType.includes("png")) {
      return await pdf.embedPng(bytes);
    }

    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      return await pdf.embedJpg(bytes);
    }
  } catch {
    return null;
  }

  return null;
}

function drawHeader(
  page: PDFPage,
  report: WorkspaceReport,
  fonts: { bold: PDFFont; regular: PDFFont },
  logo: PDFImage | null,
) {
  const cyan = rgb(0.208, 0.851, 0.949);
  const muted = rgb(0.392, 0.439, 0.522);
  const ink = rgb(0.067, 0.094, 0.153);
  let y = PAGE_HEIGHT - MARGIN;

  page.drawRectangle({
    color: cyan,
    height: 3,
    width: CONTENT_WIDTH,
    x: MARGIN,
    y,
  });
  y -= 24;

  y = drawTextLines({
    font: fonts.bold,
    lineHeight: 22,
    maxLines: 2,
    maxWidth: 560,
    page,
    size: 22,
    text: report.title,
    x: MARGIN,
    y,
  });
  y -= 4;
  y = drawTextLines({
    color: muted,
    font: fonts.regular,
    lineHeight: 11,
    maxLines: 2,
    maxWidth: 560,
    page,
    size: 8,
    text: report.subtitle,
    x: MARGIN,
    y,
  });

  if (logo) {
    const maxLogoWidth = 124;
    const maxLogoHeight = 42;
    const scale = Math.min(
      maxLogoWidth / logo.width,
      maxLogoHeight / logo.height,
      1,
    );
    const width = logo.width * scale;
    const height = logo.height * scale;

    page.drawImage(logo, {
      height,
      width,
      x: PAGE_WIDTH - MARGIN - width,
      y: PAGE_HEIGHT - MARGIN - height - 14,
    });
  } else {
    drawTextLines({
      color: ink,
      font: fonts.bold,
      lineHeight: 13,
      maxLines: 2,
      maxWidth: 180,
      page,
      size: 11,
      text: report.business.name,
      x: PAGE_WIDTH - MARGIN - 180,
      y: PAGE_HEIGHT - MARGIN - 28,
    });
  }

  y -= 10;

  return drawCompactGrid({
    fonts,
    items: [
      { label: "Workspace", value: report.business.name },
      { label: "Generated", value: formatDateTime(report.generatedAt) },
      { label: "Period", value: report.period.label },
      {
        label:
          report.filters.find((filter) => filter.label === "Channel")?.label ??
          "Channel",
        value:
          report.filters.find((filter) => filter.label === "Channel")?.value ??
          "All channels",
      },
    ],
    page,
    y,
  });
}

function drawTableHeader({
  columns,
  font,
  page,
  widths,
  y,
}: {
  columns: string[];
  font: PDFFont;
  page: PDFPage;
  widths: number[];
  y: number;
}) {
  const ink = rgb(0.067, 0.094, 0.153);
  let x = MARGIN;

  page.drawRectangle({
    color: ink,
    height: 18,
    width: CONTENT_WIDTH,
    x: MARGIN,
    y: y - 18,
  });

  columns.forEach((column, index) => {
    page.drawText(truncatedText(column.toUpperCase(), 20), {
      color: rgb(1, 1, 1),
      font,
      size: 6,
      x: x + 5,
      y: y - 12,
    });
    x += widths[index] ?? 0;
  });

  return y - 25;
}

export async function buildReportPdf(report: WorkspaceReport) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedReportLogo(pdf, report);
  const fonts = { bold, regular };
  const ink = rgb(0.067, 0.094, 0.153);
  const muted = rgb(0.392, 0.439, 0.522);
  const line = rgb(0.86, 0.9, 0.94);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = drawHeader(page, report, fonts, logo);

  function addPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensureSpace(height: number) {
    if (y - height > MARGIN) {
      return false;
    }

    addPage();
    return true;
  }

  y = drawCompactGrid({
    fonts,
    items: report.summaryCards.slice(0, 4),
    page,
    y,
  });
  y -= 6;

  for (const section of report.sections) {
    ensureSpace(64);
    page.drawText(section.title, {
      color: ink,
      font: bold,
      size: 12,
      x: MARGIN,
      y,
    });
    y -= 17;

    if (section.description) {
      y = drawTextLines({
        color: muted,
        font: regular,
        lineHeight: 10,
        maxLines: 2,
        maxWidth: CONTENT_WIDTH,
        page,
        size: 8,
        text: section.description,
        x: MARGIN,
        y,
      });
      y -= 5;
    }

    if (section.rows.length === 0) {
      y = drawTextLines({
        color: muted,
        font: regular,
        lineHeight: 12,
        maxLines: 4,
        maxWidth: CONTENT_WIDTH,
        page,
        size: 9,
        text: section.emptyText ?? "No rows for this report.",
        x: MARGIN,
        y,
      });
      y -= 16;
      continue;
    }

    const widths = resolveColumnWidths(section.columns);
    y = drawTableHeader({
      columns: section.columns,
      font: bold,
      page,
      widths,
      y,
    });

    for (const row of section.rows) {
      const cellLines = section.columns.map((_, index) =>
        wrapText(
          truncatedText(row[index] ?? "-", 180),
          regular,
          7,
          Math.max(32, (widths[index] ?? 0) - 10),
        ).slice(0, 2),
      );
      const maxLines = Math.max(1, ...cellLines.map((lines) => lines.length));
      const rowHeight = Math.max(21, maxLines * 8 + 10);

      if (ensureSpace(rowHeight + 26)) {
        page.drawText(`${section.title} continued`, {
          color: muted,
          font: bold,
          size: 8,
          x: MARGIN,
          y,
        });
        y -= 14;
        y = drawTableHeader({
          columns: section.columns,
          font: bold,
          page,
          widths,
          y,
        });
      }

      const rowTop = y;
      let x = MARGIN;

      cellLines.forEach((lines, index) => {
        lines.forEach((lineText, lineIndex) => {
          page.drawText(lineText, {
            color: ink,
            font: regular,
            size: 7,
            x: x + 5,
            y: rowTop - 10 - lineIndex * 8,
          });
        });
        x += widths[index] ?? 0;
      });

      page.drawLine({
        color: line,
        end: { x: MARGIN + CONTENT_WIDTH, y: rowTop - rowHeight },
        start: { x: MARGIN, y: rowTop - rowHeight },
        thickness: 0.8,
      });
      y -= rowHeight;
    }

    y -= 16;
  }

  if (report.notes.length > 0) {
    ensureSpace(42);
    drawTextLines({
      color: muted,
      font: regular,
      lineHeight: 11,
      maxLines: 3,
      maxWidth: CONTENT_WIDTH,
      page,
      size: 8,
      text: report.notes.join("\n"),
      x: MARGIN,
      y,
    });
  }

  return pdf.save();
}
