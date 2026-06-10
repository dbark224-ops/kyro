import { updateDefaultInvoiceTemplateAction } from "../documents/actions";
import type { QuoteTemplate } from "../../lib/documents/templates";

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
  return (
    <form action={updateDefaultInvoiceTemplateAction} className={className}>
      <input name="returnTo" type="hidden" value={returnTo} />
      <label>
        <span>Default invoice template</span>
        <select
          aria-label="Default invoice template"
          defaultValue={selectedTemplateKey ?? ""}
          name="defaultInvoiceTemplateKey"
        >
          <option value="">No template selected</option>
          {templates.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
        </select>
      </label>
      <button className="secondary-button compact" type="submit">
        Set template
      </button>
    </form>
  );
}
