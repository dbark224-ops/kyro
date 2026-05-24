"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDocumentTemplateAction,
  updateDocumentTemplateAction,
} from "../../actions";
import {
  DOCUMENT_ACCENT_THEMES,
  DOCUMENT_CURRENCIES,
  type CustomDocumentTemplate,
  type DocumentTemplateReferenceFile,
  type DocumentTemplateSettings,
} from "../../../../lib/documents/settings";
import { buildQuoteTemplatePreviewHtml } from "../../../../lib/documents/render";
import type { QuoteLineItem } from "../../../../lib/documents/templates";
import { InfoBubble } from "../../../settings/info-bubble";

const PREVIEW_DOCUMENT_WIDTH = 920;

type LineItemRow = {
  description: string;
  id: string;
  notes: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

type ReferenceFilePreview = {
  name: string;
  size: number;
  type?: string;
};

type TemplateRevisionPayload = {
  description: string;
  label: string;
  lineItems: Array<{
    description: string;
    notes: string | null;
    quantity: number | null;
    unit: string | null;
    unitPrice: number | null;
  }>;
  notes: string;
  revisionRequest: string | null;
  settings: {
    accentTheme: DocumentTemplateSettings["accentTheme"];
    currency: DocumentTemplateSettings["currency"];
    footerText: string;
    paymentTerms: string;
    quoteStyleDirection: string;
    showPreparedBy: boolean;
    validityDays: number;
  };
};

type TemplateBuilderFormProps = {
  mode?: "create" | "edit";
  settings: DocumentTemplateSettings;
  template?: CustomDocumentTemplate | null;
  workspaceName: string;
};

function newRowId() {
  return globalThis.crypto?.randomUUID?.() ?? `template-line-${Date.now()}-${Math.random()}`;
}

function valueFromNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function blankRow(): LineItemRow {
  return {
    description: "",
    id: newRowId(),
    notes: "",
    quantity: "",
    unit: "",
    unitPrice: "",
  };
}

function rowFromLineItem(item: QuoteLineItem, index: number): LineItemRow {
  return {
    description: item.description,
    id: `${item.description}-${index}-${newRowId()}`,
    notes: item.notes ?? "",
    quantity: valueFromNumber(item.quantity),
    unit: item.unit ?? "",
    unitPrice: valueFromNumber(item.unitPrice),
  };
}

function initialRows(template?: CustomDocumentTemplate | null) {
  if (template?.lineItems.length) {
    return template.lineItems.map(rowFromLineItem);
  }

  return [blankRow()];
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parsedNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function lineTotal(row: LineItemRow) {
  const quantity = parsedNumber(row.quantity);
  const unitPrice = parsedNumber(row.unitPrice);

  if (quantity === null || unitPrice === null) {
    return null;
  }

  return Math.round(quantity * unitPrice * 100) / 100;
}

function formatLineTotal(row: LineItemRow) {
  const total = lineTotal(row);

  if (total === null) {
    return "-";
  }

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(total);
}

function labelText(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function templateFileKey(file: ReferenceFilePreview) {
  return `${file.name}-${file.size}-${file.type ?? ""}`;
}

function referenceFilePayload(files: ReferenceFilePreview[]): DocumentTemplateReferenceFile[] {
  return files
    .filter((file) => file.name.trim())
    .slice(0, 8)
    .map((file) => ({
      name: file.name.slice(0, 180),
      size: Math.max(0, Math.round(file.size)),
      type: (file.type || "application/octet-stream").slice(0, 120),
    }));
}

function rowsFromRevision(lineItems: TemplateRevisionPayload["lineItems"]): LineItemRow[] {
  const rows = lineItems.map((item, index) =>
    rowFromLineItem(
      {
        description: item.description,
        notes: item.notes,
        quantity: item.quantity,
        total:
          item.quantity !== null && item.unitPrice !== null
            ? Math.round(item.quantity * item.unitPrice * 100) / 100
            : null,
        unit: item.unit,
        unitPrice: item.unitPrice,
      },
      index,
    ),
  );

  return rows.length > 0 ? rows : [blankRow()];
}

function TemplateHeading({
  children,
  info,
}: Readonly<{
  children: React.ReactNode;
  info: React.ReactNode;
}>) {
  return (
    <span className="template-builder-title-with-info">
      {children}
      <InfoBubble>{info}</InfoBubble>
    </span>
  );
}

function shouldPreviewRow(row: LineItemRow) {
  return Boolean(
    row.description.trim() ||
      row.notes.trim() ||
      row.unitPrice.trim(),
  );
}

function rowToLineItem(row: LineItemRow): QuoteLineItem {
  const quantity = parsedNumber(row.quantity);
  const unitPrice = parsedNumber(row.unitPrice);

  return {
    description: row.description.trim() || "Quote line item",
    notes: row.notes.trim() || null,
    quantity,
    total:
      quantity !== null && unitPrice !== null
        ? Math.round(quantity * unitPrice * 100) / 100
        : null,
    unit: row.unit.trim() || null,
    unitPrice,
  };
}

export function TemplateBuilderForm({
  mode = "create",
  settings,
  template = null,
  workspaceName,
}: TemplateBuilderFormProps) {
  const [label, setLabel] = useState(template?.label ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [revisionRequest, setRevisionRequest] = useState(template?.revisionRequest ?? "");
  const [rows, setRows] = useState<LineItemRow[]>(() => initialRows(template));
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [quoteStyleDirection, setQuoteStyleDirection] = useState(
    template?.settings.quoteStyleDirection ?? settings.quoteStyleDirection,
  );
  const [accentTheme, setAccentTheme] = useState(
    template?.settings.accentTheme ?? settings.accentTheme,
  );
  const [currency, setCurrency] = useState(template?.settings.currency ?? settings.currency);
  const [validityDays, setValidityDays] = useState(
    String(template?.settings.validityDays ?? settings.validityDays),
  );
  const [paymentTerms, setPaymentTerms] = useState(
    template?.settings.paymentTerms ?? settings.paymentTerms,
  );
  const [footerText, setFooterText] = useState(template?.settings.footerText ?? settings.footerText);
  const [showPreparedBy, setShowPreparedBy] = useState(
    template?.settings.showPreparedBy ?? settings.showPreparedBy,
  );
  const [files, setFiles] = useState<ReferenceFilePreview[]>([]);
  const [savedFiles, setSavedFiles] = useState<ReferenceFilePreview[]>(
    template?.referenceFiles ?? [],
  );
  const [revisionStatus, setRevisionStatus] = useState<string | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [isRevising, setIsRevising] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const previewModalShellRef = useRef<HTMLDivElement | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const previewModalFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_DOCUMENT_WIDTH);
  const [previewModalWidth, setPreviewModalWidth] = useState(PREVIEW_DOCUMENT_WIDTH);
  const [renderedPreviewMeasurement, setRenderedPreviewMeasurement] = useState<{
    height: number;
    source: string;
  } | null>(null);

  const formAction = mode === "edit" ? updateDocumentTemplateAction : createDocumentTemplateAction;
  const previewLineItems = useMemo(
    () => rows.filter(shouldPreviewRow).map(rowToLineItem),
    [rows],
  );
  const previewSettings = useMemo(
    () => ({
      accentTheme,
      currency,
      footerText,
      paymentTerms,
      quoteStyleDirection,
      showPreparedBy,
      validityDays: parsedNumber(validityDays) ?? settings.validityDays,
    }),
    [
      accentTheme,
      currency,
      footerText,
      paymentTerms,
      quoteStyleDirection,
      settings.validityDays,
      showPreparedBy,
      validityDays,
    ],
  );
  const previewHtml = useMemo(
    () =>
      buildQuoteTemplatePreviewHtml({
        lineItems: previewLineItems,
        notes,
        settings: previewSettings,
        templateDescription: description,
        templateLabel: label,
        workspace: { name: workspaceName },
      }),
    [
      description,
      label,
      notes,
      previewLineItems,
      previewSettings,
      workspaceName,
    ],
  );
  const previewDocumentHeightEstimate = Math.max(
    1040,
    780 + Math.max(previewLineItems.length, 1) * 64 + (notes.trim() ? 110 : 0),
  );
  const renderedPreviewHeight =
    renderedPreviewMeasurement?.source === previewHtml ? renderedPreviewMeasurement.height : 0;
  const previewDocumentHeight = Math.max(previewDocumentHeightEstimate, renderedPreviewHeight);
  const previewScale = Math.min(1, previewWidth / PREVIEW_DOCUMENT_WIDTH);
  const previewModalScale = Math.min(1, previewModalWidth / PREVIEW_DOCUMENT_WIDTH);
  const mergedReferenceFiles = useMemo(
    () => [...savedFiles, ...files].slice(0, 8),
    [files, savedFiles],
  );

  useEffect(() => {
    const element = previewShellRef.current;

    if (!element) {
      return;
    }

    function updatePreviewWidth() {
      setPreviewWidth(Math.max(280, element?.clientWidth ?? PREVIEW_DOCUMENT_WIDTH));
    }

    updatePreviewWidth();

    if (typeof ResizeObserver === "undefined") {
      globalThis.addEventListener("resize", updatePreviewWidth);

      return () => globalThis.removeEventListener("resize", updatePreviewWidth);
    }

    const observer = new ResizeObserver(updatePreviewWidth);

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  function measureRenderedPreview(frame: HTMLIFrameElement | null) {
    if (!frame) {
      return;
    }

    try {
      const frameDocument = frame.contentDocument;
      const root = frameDocument?.documentElement;
      const body = frameDocument?.body;
      const measuredHeight = Math.max(
        root?.scrollHeight ?? 0,
        root?.offsetHeight ?? 0,
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
      );

      if (Number.isFinite(measuredHeight) && measuredHeight > 0) {
        setRenderedPreviewMeasurement({
          height: Math.ceil(measuredHeight) + 2,
          source: frame.srcdoc,
        });
      }
    } catch {
      // If the browser blocks measurement, the estimate keeps the preview usable.
    }
  }

  useEffect(() => {
    if (!isPreviewExpanded) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPreviewExpanded(false);
      }
    }

    globalThis.addEventListener("keydown", handleKeydown);

    return () => {
      document.body.style.overflow = previousOverflow;
      globalThis.removeEventListener("keydown", handleKeydown);
    };
  }, [isPreviewExpanded]);

  useEffect(() => {
    if (!isPreviewExpanded) {
      return;
    }

    const element = previewModalShellRef.current;

    if (!element) {
      return;
    }

    function updatePreviewModalWidth() {
      setPreviewModalWidth(Math.max(280, element?.clientWidth ?? PREVIEW_DOCUMENT_WIDTH));
    }

    updatePreviewModalWidth();

    if (typeof ResizeObserver === "undefined") {
      globalThis.addEventListener("resize", updatePreviewModalWidth);

      return () => globalThis.removeEventListener("resize", updatePreviewModalWidth);
    }

    const observer = new ResizeObserver(updatePreviewModalWidth);

    observer.observe(element);

    return () => observer.disconnect();
  }, [isPreviewExpanded]);

  function updateRow(index: number, key: keyof LineItemRow, value: string) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [key]: value,
            }
          : row,
      ),
    );
  }

  function addLine() {
    setRows((current) => [...current, blankRow()]);
  }

  function removeLine(index: number) {
    setRows((current) =>
      current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current,
    );
  }

  function updateFiles(fileList: FileList | null) {
    setFiles(
      Array.from(fileList ?? [])
        .filter((file) => file.size > 0)
        .slice(0, 8)
        .map((file) => ({ name: file.name, size: file.size, type: file.type })),
    );
  }

  function removeSavedFile(key: string) {
    setSavedFiles((current) => current.filter((file) => templateFileKey(file) !== key));
  }

  async function reviseTemplate() {
    const instruction = revisionRequest.trim();

    if (!instruction) {
      setRevisionError("Describe what you want Kyro to change first.");
      setRevisionStatus(null);
      return;
    }

    setIsRevising(true);
    setRevisionError(null);
    setRevisionStatus(null);

    try {
      const response = await fetch("/api/documents/templates/revise", {
        body: JSON.stringify({
          instruction,
          template: {
            description,
            label,
            lineItems: rows.map((row) => ({
              description: row.description,
              notes: row.notes || null,
              quantity: parsedNumber(row.quantity),
              unit: row.unit || null,
              unitPrice: parsedNumber(row.unitPrice),
            })),
            notes,
            revisionRequest: instruction,
            settings: {
              accentTheme,
              currency,
              footerText,
              paymentTerms,
              quoteStyleDirection,
              showPreparedBy,
              validityDays: parsedNumber(validityDays) ?? settings.validityDays,
            },
          },
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: TemplateRevisionPayload;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Kyro could not revise this template yet.");
      }

      setLabel(payload.data.label);
      setDescription(payload.data.description);
      setRows(rowsFromRevision(payload.data.lineItems));
      setNotes(payload.data.notes);
      setRevisionRequest(payload.data.revisionRequest ?? instruction);
      setAccentTheme(payload.data.settings.accentTheme);
      setCurrency(payload.data.settings.currency);
      setFooterText(payload.data.settings.footerText);
      setPaymentTerms(payload.data.settings.paymentTerms);
      setQuoteStyleDirection(payload.data.settings.quoteStyleDirection);
      setShowPreparedBy(payload.data.settings.showPreparedBy);
      setValidityDays(String(payload.data.settings.validityDays));
      setRevisionStatus("Kyro updated the preview. Review it before saving.");
    } catch (error) {
      setRevisionError(
        error instanceof Error
          ? error.message
          : "Kyro could not revise this template yet.",
      );
    } finally {
      setIsRevising(false);
    }
  }

  return (
    <form action={formAction} className="template-builder-form">
      {template ? <input name="templateKey" type="hidden" value={template.key} /> : null}
      <input
        name="existingReferenceFiles"
        type="hidden"
        value={JSON.stringify(referenceFilePayload(savedFiles))}
      />
      <div className="template-builder-workspace">
        <div className="template-builder-editor-stack">
          <section className="panel template-builder-section accent-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Template basics</p>
                <h2>
                  <TemplateHeading info="Name and describe this reusable document template. These details help you identify it later in the Templates pane; they are not rendered as customer-facing quote copy.">
                    {mode === "edit" ? "Review and edit template" : "Create a reusable quote template"}
                  </TemplateHeading>
                </h2>
              </div>
            </div>
            <div className="document-form-grid">
              <label>
                Template name
                <input
                  name="label"
                  onChange={(event) => setLabel(event.currentTarget.value)}
                  placeholder="Premium Bathroom Renovation Quote"
                  required
                  type="text"
                  value={label}
                />
              </label>
              <label className="full-row">
                Short description
                <input
                  name="description"
                  onChange={(event) => setDescription(event.currentTarget.value)}
                  placeholder="A polished quote structure for larger renovation work."
                  type="text"
                  value={description}
                />
              </label>
            </div>
          </section>

          <section className="panel template-builder-section template-assistant-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Kyro edits</p>
                <h2>
                  <TemplateHeading info="Use this to ask Kyro for structured template edits, such as making the layout more premium or changing the reusable sections. Changes update the on-screen draft only until you save.">
                    Describe the changes you want
                  </TemplateHeading>
                </h2>
              </div>
            </div>
            <label className="template-builder-notes compact">
              Direction for Kyro
              <textarea
                name="revisionRequest"
                onChange={(event) => setRevisionRequest(event.currentTarget.value)}
                placeholder="e.g. Make this feel premium but practical, include staged-work sections, and keep customer-facing copy concise."
                rows={4}
                value={revisionRequest}
              />
            </label>
            <div className="template-builder-assistant-actions">
              <button
                className="secondary-button"
                disabled={isRevising}
                onClick={reviseTemplate}
                type="button"
              >
                {isRevising ? "Kyro is editing..." : "Apply to preview"}
              </button>
              <span>
                This updates the draft template on screen only. Save when the preview looks right.
              </span>
            </div>
            {revisionStatus ? <p className="form-alert">{revisionStatus}</p> : null}
            {revisionError ? <p className="form-alert error">{revisionError}</p> : null}
          </section>

          <section className="panel template-builder-section">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Reference material</p>
                <h2>
                  <TemplateHeading info="Attach example PDFs, images, or documents as inspiration for this template. For now these are stored as lightweight reference metadata; describe the important visual or wording changes in Kyro edits.">
                    Example files
                  </TemplateHeading>
                </h2>
              </div>
            </div>
            <label className="template-file-drop">
              <input
                multiple
                name="referenceFiles"
                onChange={(event) => updateFiles(event.currentTarget.files)}
                type="file"
              />
              <strong>Add examples</strong>
              <span>Upload PDFs, images, or docs as reference material for this template&apos;s style and structure.</span>
            </label>
            {mergedReferenceFiles.length > 0 ? (
              <div className="template-reference-list">
                {savedFiles.map((file) => (
                  <button
                    className="template-reference-chip"
                    key={templateFileKey(file)}
                    onClick={() => removeSavedFile(templateFileKey(file))}
                    type="button"
                  >
                    {file.name} · {formatFileSize(file.size)} ×
                  </button>
                ))}
                {files.map((file) => (
                  <span key={templateFileKey(file)}>
                    {file.name} · {formatFileSize(file.size)}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="panel template-builder-section">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Reusable structure</p>
                <h2>
                  <TemplateHeading info="Set the reusable line-item structure new quote drafts should start with. Leave quantity, unit, or price blank when the user should fill those values in per job.">
                    Line items
                  </TemplateHeading>
                </h2>
              </div>
              <button className="secondary-button compact" onClick={addLine} type="button">
                Add line
              </button>
            </div>
            <div className="document-line-item-list">
              {rows.map((row, index) => (
                <div className="document-line-item-row" key={row.id}>
                  <label className="document-line-item-description">
                    Item
                    <input
                      name="lineItemDescription"
                      onChange={(event) => updateRow(index, "description", event.currentTarget.value)}
                      placeholder="Callout and diagnosis"
                      type="text"
                      value={row.description}
                    />
                  </label>
                  <label>
                    Qty
                    <input
                      inputMode="decimal"
                      min="0"
                      name="lineItemQuantity"
                      onChange={(event) => updateRow(index, "quantity", event.currentTarget.value)}
                      step="0.01"
                      type="number"
                      value={row.quantity}
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      name="lineItemUnit"
                      onChange={(event) => updateRow(index, "unit", event.currentTarget.value)}
                      placeholder="job"
                      type="text"
                      value={row.unit}
                    />
                  </label>
                  <label>
                    Unit price
                    <input
                      inputMode="decimal"
                      min="0"
                      name="lineItemUnitPrice"
                      onChange={(event) => updateRow(index, "unitPrice", event.currentTarget.value)}
                      step="0.01"
                      type="number"
                      value={row.unitPrice}
                    />
                  </label>
                  <div className="document-line-item-total">
                    <span>Total</span>
                    <strong>{formatLineTotal(row)}</strong>
                  </div>
                  <label className="document-line-item-notes">
                    Note
                    <input
                      name="lineItemNotes"
                      onChange={(event) => updateRow(index, "notes", event.currentTarget.value)}
                      placeholder="Optional line note"
                      type="text"
                      value={row.notes}
                    />
                  </label>
                  <button
                    aria-label={`Remove line item ${index + 1}`}
                    className="document-line-item-remove"
                    disabled={rows.length <= 1}
                    onClick={() => removeLine(index)}
                    type="button"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
            <label className="template-builder-notes">
              Overall notes
              <textarea
                name="notes"
                onChange={(event) => setNotes(event.currentTarget.value)}
                rows={4}
                value={notes}
              />
            </label>
          </section>

          <section className="panel template-builder-section">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Design direction</p>
                <h2>
                  <TemplateHeading info="These settings guide the customer-facing document output. The natural-language direction is an internal style instruction, while accent, currency, validity, terms, and footer are saved with the template.">
                    Template output
                  </TemplateHeading>
                </h2>
              </div>
            </div>
            <div className="document-form-grid">
              <label className="full-row">
                Natural language direction
                <textarea
                  name="quoteStyleDirection"
                  onChange={(event) => setQuoteStyleDirection(event.currentTarget.value)}
                  rows={4}
                  value={quoteStyleDirection}
                />
              </label>
              <label>
                Accent
                <select
                  name="accentTheme"
                  onChange={(event) => setAccentTheme(event.currentTarget.value as typeof accentTheme)}
                  value={accentTheme}
                >
                  {DOCUMENT_ACCENT_THEMES.map((theme) => (
                    <option key={theme} value={theme}>
                      {labelText(theme)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Currency
                <select
                  name="currency"
                  onChange={(event) => setCurrency(event.currentTarget.value as typeof currency)}
                  value={currency}
                >
                  {DOCUMENT_CURRENCIES.map((currencyOption) => (
                    <option key={currencyOption} value={currencyOption}>
                      {currencyOption}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Valid days
                <input
                  max={90}
                  min={1}
                  name="validityDays"
                  onChange={(event) => setValidityDays(event.currentTarget.value)}
                  type="number"
                  value={validityDays}
                />
              </label>
              <label className="full-row">
                Payment terms
                <textarea
                  name="paymentTerms"
                  onChange={(event) => setPaymentTerms(event.currentTarget.value)}
                  rows={3}
                  value={paymentTerms}
                />
              </label>
              <label className="full-row">
                Footer text
                <textarea
                  name="footerText"
                  onChange={(event) => setFooterText(event.currentTarget.value)}
                  rows={3}
                  value={footerText}
                />
              </label>
              <label className="document-template-checkbox full-row">
                <input
                  checked={showPreparedBy}
                  name="showPreparedBy"
                  onChange={(event) => setShowPreparedBy(event.currentTarget.checked)}
                  type="checkbox"
                />
                Show prepared-by footer
              </label>
            </div>
          </section>
        </div>

        <aside className="template-builder-review panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Review before saving</p>
              <h2>
                <TemplateHeading info="This is the live rendered customer document using the same HTML renderer as the print/PDF view. Click the preview to open a larger inspection modal before saving.">
                  Customer quote preview
                </TemplateHeading>
              </h2>
            </div>
            <span className="pill">Live</span>
          </div>
          <div
            className="template-render-preview-shell"
            ref={previewShellRef}
            style={{ height: `${Math.ceil(previewDocumentHeight * previewScale)}px` }}
          >
            <iframe
              className="template-render-preview-frame"
              onLoad={(event) => measureRenderedPreview(event.currentTarget)}
              ref={previewFrameRef}
              sandbox="allow-same-origin"
              srcDoc={previewHtml}
              style={{
                height: `${previewDocumentHeight}px`,
                transform: `scale(${previewScale})`,
                width: `${PREVIEW_DOCUMENT_WIDTH}px`,
              }}
              title="Rendered quote template preview"
            />
            <button
              aria-label="Open larger template preview"
              className="template-render-preview-hitbox"
              onClick={() => setIsPreviewExpanded(true)}
              type="button"
            >
              <span>Expand preview</span>
            </button>
          </div>
          {isPreviewExpanded ? (
            <div
              className="template-preview-modal"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsPreviewExpanded(false);
                }
              }}
            >
              <section
                aria-labelledby="template-preview-modal-title"
                aria-modal="true"
                className="template-preview-modal-card"
                role="dialog"
              >
                <div className="template-preview-modal-header">
                  <div>
                    <p className="eyebrow">Large preview</p>
                    <h2 id="template-preview-modal-title">Customer quote preview</h2>
                  </div>
                  <button
                    className="secondary-button compact"
                    onClick={() => setIsPreviewExpanded(false)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
                <div className="template-preview-modal-body">
                  <div
                    className="template-preview-modal-stage"
                    ref={previewModalShellRef}
                    style={{ height: `${Math.ceil(previewDocumentHeight * previewModalScale)}px` }}
                  >
                    <iframe
                      className="template-preview-modal-frame"
                      onLoad={(event) => measureRenderedPreview(event.currentTarget)}
                      ref={previewModalFrameRef}
                      sandbox="allow-same-origin"
                      srcDoc={previewHtml}
                      style={{
                        height: `${previewDocumentHeight}px`,
                        transform: `scale(${previewModalScale})`,
                        width: `${PREVIEW_DOCUMENT_WIDTH}px`,
                      }}
                      title="Large rendered quote template preview"
                    />
                  </div>
                </div>
              </section>
            </div>
          ) : null}
          <div className="template-review-summary">
            <div>
              <span>Direction</span>
              <p>{quoteStyleDirection}</p>
            </div>
            <div>
              <span>References</span>
              <p>
                {mergedReferenceFiles.length > 0
                  ? `${mergedReferenceFiles.length} file${mergedReferenceFiles.length === 1 ? "" : "s"} attached as reference metadata`
                  : "No reference files attached"}
              </p>
            </div>
          </div>
          <div className="template-builder-actions">
            <button className="primary-button" type="submit">
              {mode === "edit" ? "Save changes" : "Save template"}
            </button>
          </div>
        </aside>
      </div>
    </form>
  );
}
