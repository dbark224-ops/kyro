"use client";

import { useMemo, useState } from "react";
import {
  draftTitleFromTemplate,
  normalizeQuoteLineItems,
  type QuoteTemplate,
} from "../../lib/documents/templates";
import { QuoteDraftEditorForm } from "../documents/[quoteDraftId]/quote-draft-editor-form";

const STATUS_OPTIONS = [
  { label: "Draft", value: "draft" },
  { label: "Ready", value: "ready" },
  { label: "Sent", value: "sent" },
  { label: "Approved", value: "approved" },
  { label: "Changes requested", value: "changes_requested" },
  { label: "Archived", value: "archived" },
] as const;

function invoiceTemplateFallback(
  templates: QuoteTemplate[],
  defaultTemplateKey: string | null,
) {
  return (
    templates.find((template) => template.key === defaultTemplateKey) ??
    templates.find((template) => /invoice/i.test(template.label)) ??
    templates[0] ??
    null
  );
}

export function CreateInvoiceModal({
  defaultTemplateKey,
  disabled = false,
  disabledReason = null,
  templates,
}: Readonly<{
  defaultTemplateKey: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
  templates: QuoteTemplate[];
}>) {
  const initialTemplate = invoiceTemplateFallback(
    templates,
    defaultTemplateKey,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState(initialTemplate?.key ?? "");
  const selectedTemplate = useMemo(
    () =>
      templates.find((template) => template.key === templateKey) ??
      initialTemplate,
    [initialTemplate, templateKey, templates],
  );

  return (
    <>
      <button
        className="secondary-button payments-invoice-trigger"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        title={disabled ? (disabledReason ?? undefined) : undefined}
        type="button"
      >
        Create invoice
      </button>
      {isOpen ? (
        <div className="payments-modal-backdrop" role="presentation">
          <section
            aria-label="Create invoice draft"
            className="payments-modal payments-invoice-modal"
            role="dialog"
          >
            <header className="payments-modal-header">
              <div>
                <p className="eyebrow">Invoice draft</p>
                <h2>Create invoice</h2>
              </div>
              <button
                className="secondary-button"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                Close
              </button>
            </header>

            {templates.length > 0 ? (
              <>
                <label className="payments-invoice-template-select">
                  <span>Template</span>
                  <select
                    value={templateKey}
                    onChange={(event) =>
                      setTemplateKey(event.currentTarget.value)
                    }
                  >
                    {templates.map((template) => (
                      <option key={template.key} value={template.key}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedTemplate ? (
                  <QuoteDraftEditorForm
                    customer={{
                      company: "",
                      email: "",
                      jobAddress: "",
                      name: "",
                      phone: "",
                    }}
                    initialContact={null}
                    jobType={selectedTemplate.label}
                    lineItems={normalizeQuoteLineItems(
                      selectedTemplate.lineItems,
                    )}
                    mode="create"
                    notes={selectedTemplate.notes}
                    preferredTime=""
                    status="draft"
                    statusOptions={STATUS_OPTIONS}
                    submitLabel="Create invoice draft"
                    templateKey={selectedTemplate.key}
                    title={draftTitleFromTemplate(selectedTemplate)}
                  />
                ) : null}
              </>
            ) : (
              <div className="payments-empty-state">
                <strong>No document templates yet.</strong>
                <span>
                  Create an invoice template in Files first, then use it here as
                  the default payment invoice flow.
                </span>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
