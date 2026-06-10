import { updateDefaultInvoiceTemplateAction } from "../documents/actions";
import type { QuoteTemplate } from "../../lib/documents/templates";

export function DefaultInvoiceTemplateForm({
  selectedTemplateKey,
  templates,
}: Readonly<{
  selectedTemplateKey: string | null;
  templates: QuoteTemplate[];
}>) {
  return (
    <form action={updateDefaultInvoiceTemplateAction} className="payments-template-form">
      <input name="returnTo" type="hidden" value="/payments" />
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
