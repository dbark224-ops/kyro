import type { WorkspaceReport } from "./data";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 38;
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

export function reportFilename(report: WorkspaceReport) {
  return `${safeFilename(`${report.business.name} ${report.title}`)}.pdf`;
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
      --purple: #7c3aed;
      --surface: #ffffff;
      font-family: "Manrope", "Inter", Arial, sans-serif;
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
      width: min(980px, calc(100vw - 32px));
      margin: 24px auto;
      border: 1px solid #d8e5ee;
      border-radius: 16px;
      background: var(--surface);
      box-shadow: 0 24px 70px rgb(15 23 42 / 0.12);
      padding: 42px;
    }

    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 24px;
      border-bottom: 3px solid var(--cyan);
      padding-bottom: 24px;
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
      font-size: 38px;
      letter-spacing: 0;
      line-height: 1.02;
    }

    h2 {
      margin: 0 0 12px;
      font-size: 18px;
      letter-spacing: 0;
    }

    .subtitle {
      max-width: 640px;
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }

    .brand-logo img {
      max-width: 150px;
      max-height: 76px;
      object-fit: contain;
    }

    .brand-name {
      max-width: 230px;
      color: var(--purple);
      font-size: 26px;
      font-weight: 900;
      line-height: 1.05;
      text-align: right;
    }

    .meta-grid,
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 18px;
    }

    .meta-card,
    .summary-card {
      border: 1px solid #d8e5ee;
      border-radius: 12px;
      background: #f8fbff;
      padding: 12px;
    }

    .summary-card strong {
      display: block;
      margin: 4px 0;
      font-size: 24px;
      line-height: 1;
    }

    .meta-card span,
    .summary-card span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 850;
      text-transform: uppercase;
    }

    .meta-card p,
    .summary-card p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    section {
      margin-top: 26px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    th,
    td {
      border-bottom: 1px solid #e5eef6;
      padding: 9px 8px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }

    th {
      color: var(--muted);
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }

    td {
      font-size: 12px;
      line-height: 1.35;
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
      padding: 14px 16px;
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
        padding: 26px;
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
    <section class="notes">
      ${report.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
    </section>
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
  const ink = rgb(0.067, 0.094, 0.153);
  const muted = rgb(0.392, 0.439, 0.522);
  let y = PAGE_HEIGHT - MARGIN;

  page.drawRectangle({
    color: cyan,
    height: 5,
    width: CONTENT_WIDTH,
    x: MARGIN,
    y,
  });
  y -= 30;

  if (!logo) {
    page.drawText(report.business.name, {
      color: cyan,
      font: fonts.bold,
      size: 11,
      x: MARGIN,
      y,
    });
    y -= 30;
  } else {
    y -= 10;
  }
  y = drawTextLines({
    font: fonts.bold,
    lineHeight: 28,
    maxLines: 2,
    maxWidth: 360,
    page,
    size: 28,
    text: report.title,
    x: MARGIN,
    y,
  });
  y -= 6;
  y = drawTextLines({
    color: muted,
    font: fonts.regular,
    lineHeight: 13,
    maxLines: 3,
    maxWidth: 400,
    page,
    size: 10,
    text: report.subtitle,
    x: MARGIN,
    y,
  });

  if (logo) {
    const maxLogoWidth = 138;
    const maxLogoHeight = 48;
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
      y: PAGE_HEIGHT - MARGIN - height - 16,
    });
  }

  const metaX = PAGE_WIDTH - MARGIN - 160;
  const metaY = PAGE_HEIGHT - MARGIN - (logo ? 82 : 28);
  page.drawRectangle({
    borderColor: rgb(0.86, 0.9, 0.94),
    borderWidth: 1,
    color: rgb(0.98, 0.99, 1),
    height: 88,
    width: 160,
    x: metaX,
    y: metaY - 80,
  });
  [
    ["Generated", formatDateTime(report.generatedAt)],
    ["Period", report.period.label],
    ["Workspace", report.business.name],
  ].forEach(([label, value], index) => {
    const rowY = metaY - index * 25;
    page.drawText(label, {
      color: muted,
      font: fonts.regular,
      size: 8,
      x: metaX + 12,
      y: rowY,
    });
    page.drawText(truncatedText(value, 26), {
      color: ink,
      font: fonts.bold,
      size: 8,
      x: metaX + 64,
      y: rowY,
    });
  });

  return y - 22;
}

export async function buildReportPdf(report: WorkspaceReport) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedReportLogo(pdf, report);
  const ink = rgb(0.067, 0.094, 0.153);
  const muted = rgb(0.392, 0.439, 0.522);
  const line = rgb(0.86, 0.9, 0.94);
  const faint = rgb(0.98, 0.99, 1);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = drawHeader(page, report, { bold, regular }, logo);

  function ensureSpace(height: number) {
    if (y - height > MARGIN) {
      return;
    }

    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  const cardWidth = (CONTENT_WIDTH - 24) / 4;
  report.summaryCards.slice(0, 4).forEach((card, index) => {
    const x = MARGIN + index * (cardWidth + 8);

    page.drawRectangle({
      borderColor: line,
      borderWidth: 1,
      color: faint,
      height: 58,
      width: cardWidth,
      x,
      y: y - 58,
    });
    page.drawText(card.label.toUpperCase(), {
      color: muted,
      font: bold,
      size: 7,
      x: x + 10,
      y: y - 18,
    });
    page.drawText(truncatedText(card.value, 18), {
      color: ink,
      font: bold,
      size: 17,
      x: x + 10,
      y: y - 40,
    });
  });
  y -= 82;

  for (const section of report.sections) {
    ensureSpace(80);
    page.drawText(section.title, {
      color: ink,
      font: bold,
      size: 14,
      x: MARGIN,
      y,
    });
    y -= 22;

    if (section.rows.length === 0) {
      y = drawTextLines({
        color: muted,
        font: regular,
        lineHeight: 13,
        maxLines: 4,
        maxWidth: CONTENT_WIDTH,
        page,
        size: 10,
        text: section.emptyText ?? "No rows for this report.",
        x: MARGIN,
        y,
      });
      y -= 14;
      continue;
    }

    const columnCount = Math.max(1, section.columns.length);
    const columnWidth = CONTENT_WIDTH / columnCount;

    ensureSpace(32);
    page.drawRectangle({
      color: ink,
      height: 24,
      width: CONTENT_WIDTH,
      x: MARGIN,
      y: y - 24,
    });
    section.columns.forEach((column, index) => {
      page.drawText(truncatedText(column.toUpperCase(), 18), {
        color: rgb(1, 1, 1),
        font: bold,
        size: 7,
        x: MARGIN + index * columnWidth + 6,
        y: y - 16,
      });
    });
    y -= 34;

    for (const row of section.rows.slice(0, 220)) {
      ensureSpace(32);
      const rowTop = y + 10;

      page.drawLine({
        color: line,
        end: { x: MARGIN + CONTENT_WIDTH, y: rowTop - 26 },
        start: { x: MARGIN, y: rowTop - 26 },
        thickness: 1,
      });
      section.columns.forEach((_, index) => {
        drawTextLines({
          color: ink,
          font: regular,
          lineHeight: 10,
          maxLines: 2,
          maxWidth: Math.max(32, columnWidth - 10),
          page,
          size: 8,
          text: row[index] ?? "-",
          x: MARGIN + index * columnWidth + 6,
          y,
        });
      });
      y -= 30;
    }

    if (section.rows.length > 220) {
      ensureSpace(24);
      page.drawText(`${section.rows.length - 220} additional rows omitted from PDF output.`, {
        color: muted,
        font: regular,
        size: 9,
        x: MARGIN,
        y,
      });
      y -= 22;
    }

    y -= 16;
  }

  ensureSpace(60);
  page.drawRectangle({
    borderColor: rgb(0.93, 0.75, 0.85),
    borderWidth: 1,
    color: rgb(0.996, 0.969, 0.984),
    height: 48,
    width: CONTENT_WIDTH,
    x: MARGIN,
    y: y - 48,
  });
  drawTextLines({
    color: muted,
    font: regular,
    lineHeight: 12,
    maxLines: 3,
    maxWidth: CONTENT_WIDTH - 20,
    page,
    size: 9,
    text: report.notes.join("\n"),
    x: MARGIN + 10,
    y: y - 16,
  });

  return pdf.save();
}
