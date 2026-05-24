import type { QuoteDraftProfile } from "../crm/queries";
import {
  normalizeQuoteLineItems,
  type QuoteLineItem,
} from "./templates";
import type { DocumentTemplateDesignSettings } from "./settings";

type WorkspaceForDocument = {
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

type QuoteDocumentRenderInput = {
  businessProfile: BusinessProfileForDocument;
  generatedAt?: Date;
  chrome?: "print" | "preview";
  profile: QuoteDraftProfile;
  settings: DocumentTemplateDesignSettings;
  workspace: WorkspaceForDocument;
};

type QuoteTemplatePreviewInput = {
  generatedAt?: Date;
  lineItems: QuoteLineItem[];
  notes: string | null;
  settings: DocumentTemplateDesignSettings;
  templateDescription: string | null;
  templateLabel: string | null;
  workspace: WorkspaceForDocument;
};

const THEME_COLORS: Record<DocumentTemplateDesignSettings["accentTheme"], string> = {
  blue: "#2563eb",
  cyan: "#0891b2",
  graphite: "#111827",
  green: "#16a34a",
  pink: "#db2777",
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function addDays(date: Date, days: number) {
  const next = new Date(date);

  next.setDate(next.getDate() + days);

  return next;
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

export function buildQuoteDocumentHtml({
  businessProfile,
  chrome = "print",
  generatedAt = new Date(),
  profile,
  settings,
  workspace,
}: QuoteDocumentRenderInput) {
  const quote = profile.quoteDraft;
  const lineItems = normalizeQuoteLineItems(quote.lineItems);
  const subtotal = lineItems.reduce(
    (sum, item) => sum + (lineItemTotal(item) ?? 0),
    0,
  );
  const hasPricedItems = lineItems.some((item) => lineItemTotal(item) !== null);
  const accent = THEME_COLORS[settings.accentTheme];
  const businessName =
    textValue(businessProfile?.businessName) ?? workspace.name ?? "Kyro customer";
  const validUntil = formatDate(addDays(generatedAt, settings.validityDays));
  const meta = customerMeta(profile);
  const details = jobDetails(profile);
  const printActions =
    chrome === "print"
      ? `<div class="print-actions"><button onclick="window.print()">Print / save PDF</button></div>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(quote.title)}</title>
  <style>
    :root { --accent: ${accent}; --ink: #111827; --muted: #667085; --line: #e5e7eb; --wash: #f8fafc; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #e5e7eb; color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; }
    .page { width: min(100%, 920px); min-height: 100vh; margin: 0 auto; background: white; padding: 42px; }
    .top-strip { height: 8px; margin: -42px -42px 34px; background: linear-gradient(90deg, var(--accent), #111827); }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: start; margin-bottom: 34px; }
    .brand { display: grid; gap: 8px; }
    .eyebrow { margin: 0; color: var(--accent); font-size: 11px; font-weight: 900; letter-spacing: .11em; text-transform: uppercase; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 8px; font-size: clamp(32px, 5vw, 52px); line-height: .95; letter-spacing: -.04em; }
    h2 { margin-bottom: 10px; font-size: 18px; letter-spacing: -.01em; }
    h3 { margin-bottom: 4px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
    .quote-meta { display: grid; gap: 8px; min-width: 210px; border: 1px solid var(--line); border-radius: 18px; background: var(--wash); padding: 16px; font-size: 13px; }
    .quote-meta div { display: flex; justify-content: space-between; gap: 16px; }
    .quote-meta span { color: var(--muted); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .card { border: 1px solid var(--line); border-radius: 20px; padding: 18px; }
    .card p, .muted { color: var(--muted); }
    .meta-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .meta-list li { color: var(--muted); }
    table { width: 100%; border-collapse: collapse; margin: 24px 0; overflow: hidden; border: 1px solid var(--line); border-radius: 20px; }
    th { background: #111827; color: white; font-size: 11px; letter-spacing: .08em; text-align: left; text-transform: uppercase; }
    th, td { padding: 14px 16px; vertical-align: top; border-bottom: 1px solid var(--line); }
    tr:last-child td { border-bottom: 0; }
    td:nth-child(2), td:nth-child(3) { width: 150px; text-align: right; white-space: nowrap; }
    .line-note { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
    .total { display: flex; justify-content: flex-end; margin-bottom: 28px; }
    .total-card { min-width: 280px; border-radius: 20px; background: var(--wash); padding: 18px; text-align: right; }
    .total-card span { color: var(--muted); }
    .total-card strong { display: block; margin-top: 4px; font-size: 30px; }
    .notes { display: grid; gap: 14px; margin-top: 24px; }
    .notes section { border-left: 4px solid var(--accent); background: var(--wash); padding: 16px 18px; border-radius: 0 16px 16px 0; }
    .notes p { margin-bottom: 0; white-space: pre-line; }
    footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
    .print-actions { position: sticky; top: 16px; z-index: 20; display: flex; height: 0; justify-content: flex-end; margin: -28px 0 28px; padding: 0; pointer-events: none; }
    .print-actions button { border: 0; border-radius: 999px; background: #111827; box-shadow: 0 12px 28px rgba(17, 24, 39, .18); color: white; cursor: pointer; font-weight: 800; padding: 9px 14px; pointer-events: auto; }
    @page { size: A4; margin: 0; }
    @media print { body { background: white; } .page { width: auto; min-height: auto; margin: 0; padding: 18mm; } .top-strip { margin: -18mm -18mm 26px; } .print-actions { display: none; } }
    @media (max-width: 720px) { .page { padding: 24px; } .top-strip { margin: -24px -24px 28px; } header, .grid { grid-template-columns: 1fr; } td:nth-child(2), td:nth-child(3) { width: auto; } }
  </style>
</head>
<body>
  <main class="page">
    ${printActions}
    <div class="top-strip"></div>
    <header>
      <div class="brand">
        <p class="eyebrow">${escapeHtml(businessName)}</p>
        <h1>${escapeHtml(quote.title)}</h1>
      </div>
      <aside class="quote-meta" aria-label="Quote metadata">
        <div><span>Created</span><strong>${escapeHtml(formatDate(generatedAt))}</strong></div>
        <div><span>Valid until</span><strong>${escapeHtml(validUntil)}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(quote.status)}</strong></div>
      </aside>
    </header>

    <section class="grid">
      <article class="card">
        <h3>Prepared for</h3>
        <h2>${escapeHtml(customerName(profile))}</h2>
        ${meta.length > 0 ? `<ul class="meta-list">${meta.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>No customer contact details saved yet.</p>`}
      </article>
      <article class="card">
        <h3>Job details</h3>
        ${details.length > 0 ? `<ul class="meta-list">${details.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join("")}</ul>` : `<p>No job details saved yet.</p>`}
      </article>
    </section>

    <table>
      <thead><tr><th>Scope</th><th>Quantity</th><th>Amount</th></tr></thead>
      <tbody>
        ${lineItems.length > 0 ? lineItems.map((item) => `<tr><td><strong>${escapeHtml(item.description)}</strong>${item.notes ? `<span class="line-note">${escapeHtml(item.notes)}</span>` : ""}</td><td>${escapeHtml(lineItemQuantity(item))}</td><td>${escapeHtml(formatMoney(lineItemTotal(item), settings.currency))}</td></tr>`).join("") : `<tr><td colspan="3">No line items saved yet.</td></tr>`}
      </tbody>
    </table>

    <div class="total"><div class="total-card"><span>${hasPricedItems ? "Subtotal" : "Pricing"}</span><strong>${hasPricedItems ? escapeHtml(formatMoney(subtotal, settings.currency)) : "To be confirmed"}</strong></div></div>

    <div class="notes">
      ${quote.notes ? `<section><h2>Notes</h2><p>${escapeHtml(quote.notes)}</p></section>` : ""}
      <section><h2>Payment and approval</h2><p>${escapeHtml(settings.paymentTerms)}</p></section>
    </div>

    <footer>
      ${settings.showPreparedBy ? `<p>Prepared by ${escapeHtml(businessName)}.</p>` : ""}
      <p>${escapeHtml(settings.footerText)}</p>
      ${businessProfile?.serviceArea ? `<p>Service area: ${escapeHtml(businessProfile.serviceArea)}</p>` : ""}
    </footer>
  </main>
</body>
</html>`;
}

export function buildQuoteTemplatePreviewHtml({
  generatedAt = new Date(),
  lineItems,
  notes,
  settings,
  templateDescription,
  templateLabel,
  workspace,
}: QuoteTemplatePreviewInput) {
  const title = textValue(templateLabel) ?? "Untitled quote template";
  const description = textValue(templateDescription);
  const profile: QuoteDraftProfile = {
    auditLogs: [],
    inquiryFacts: {
      address: null,
      budget: null,
      fit: null,
      jobType: description ?? title,
      missingInfo: [],
      preferredTime: null,
      urgency: null,
    },
    messages: [],
    quoteDraft: {
      contact: null,
      conversation: null,
      createdAt: generatedAt.toISOString(),
      id: "template-preview",
      inquiryFacts: {
        address: null,
        budget: null,
        jobType: description ?? title,
        preferredTime: null,
      },
      lead: null,
      lineItemCount: lineItems.length,
      lineItems,
      metadata: {
        customerName: "Customer",
        jobType: description ?? "Quote scope",
      },
      notes,
      status: "draft",
      title,
      updatedAt: generatedAt.toISOString(),
    },
  };

  return buildQuoteDocumentHtml({
    businessProfile: {
      businessName: workspace.name,
      defaultReplyInstructions: null,
      description: null,
      industry: null,
      serviceArea: null,
      toneOfVoice: null,
    },
    chrome: "preview",
    generatedAt,
    profile,
    settings,
    workspace,
  });
}
