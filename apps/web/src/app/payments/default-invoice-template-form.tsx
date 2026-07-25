"use client";

import { updateDefaultInvoiceTemplateAction } from "../documents/actions";
import type { QuoteTemplate } from "../../lib/documents/templates";
import { useId, useState } from "react";

export function DefaultInvoiceTemplateForm({
  className = "payments-template-form",
  returnTo = "/payments",
  selectedTemplateKey,
  templates,
}: Readonly<{
  className?: string;
  returnTo?: string;
  selectedTemplateKey: string | null;
  templates: QuoteTemplate[];
}>) {
  const templateMenuId = useId();
  const options = [
    { label: "No template selected", value: "" },
    ...templates.map((template) => ({
      label: template.label,
      value: template.key,
    })),
  ];
  const [selectedValue, setSelectedValue] = useState(selectedTemplateKey ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedOption =
    options.find((option) => option.value === selectedValue) ?? options[0];

  return (
    <form action={updateDefaultInvoiceTemplateAction} className={className}>
      <input name="returnTo" type="hidden" value={returnTo} />
      <input
        name="defaultInvoiceTemplateKey"
        type="hidden"
        value={selectedValue}
      />
      <div className="invoice-template-picker">
        <span>Default invoice template</span>
        <button
          aria-controls={templateMenuId}
          aria-expanded={menuOpen}
          className="invoice-template-picker-button"
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          <span>{selectedOption.label}</span>
          <span
            className="invoice-template-picker-chevron"
            aria-hidden="true"
          />
        </button>
        {menuOpen ? (
          <div className="invoice-template-picker-menu" id={templateMenuId}>
            {options.map((option) => {
              const selected = option.value === selectedValue;

              return (
                <button
                  aria-pressed={selected}
                  className={`invoice-template-picker-option${
                    selected ? " selected" : ""
                  }`}
                  key={option.value || "none"}
                  onClick={() => {
                    setSelectedValue(option.value);
                    setMenuOpen(false);
                  }}
                  type="button"
                >
                  <span
                    className="invoice-template-option-check"
                    aria-hidden="true"
                  />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <button className="secondary-button compact" type="submit">
        Set template
      </button>
    </form>
  );
}
