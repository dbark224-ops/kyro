"use client";

import { useEffect, useRef, useState } from "react";
import { createQuoteDraftAction, updateQuoteDraftAction } from "../actions";
import type { QuoteLineItem } from "../../../lib/documents/templates";
import type { ContactSearchResult } from "../../../lib/crm/queries";

type ContactOption = Omit<ContactSearchResult, "updatedAt">;

type CustomerFields = {
  company: string;
  email: string;
  jobAddress: string;
  name: string;
  phone: string;
};

type LineItemEditorRow = {
  description: string;
  id: string;
  notes: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

type QuoteDraftEditorFormProps = {
  customer: CustomerFields;
  initialContact: ContactOption | null;
  jobType: string;
  lineItems: QuoteLineItem[];
  mode?: "create" | "edit";
  notes: string;
  preferredTime: string;
  quoteDraftId?: string;
  status: string;
  statusOptions: ReadonlyArray<{ label: string; value: string }>;
  templateKey?: string | null;
  title: string;
};

function moneyInputValue(value: number | null) {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

function newLineItemId() {
  return globalThis.crypto?.randomUUID?.() ?? `line-${Date.now()}-${Math.random()}`;
}

function lineItemToEditorRow(item: QuoteLineItem): LineItemEditorRow {
  return {
    description: item.description,
    id: newLineItemId(),
    notes: item.notes ?? "",
    quantity: moneyInputValue(item.quantity),
    unit: item.unit ?? "",
    unitPrice: moneyInputValue(item.unitPrice),
  };
}

function blankLineItem(): LineItemEditorRow {
  return {
    description: "",
    id: newLineItemId(),
    notes: "",
    quantity: "1",
    unit: "job",
    unitPrice: "",
  };
}

function contactLabel(contact: ContactOption) {
  return [contact.name, contact.company, contact.email]
    .filter(Boolean)
    .join(" - ") || "Unnamed contact";
}

function contactMeta(contact: ContactOption) {
  return [contact.email, contact.phone, contact.address]
    .filter(Boolean)
    .join(" · ");
}

function lineTotal(row: LineItemEditorRow) {
  if (!row.quantity.trim() || !row.unitPrice.trim()) {
    return "-";
  }

  const quantity = Number(row.quantity);
  const unitPrice = Number(row.unitPrice);

  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
    return "-";
  }

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(quantity * unitPrice);
}

export function QuoteDraftEditorForm({
  customer,
  initialContact,
  jobType,
  lineItems,
  mode = "edit",
  notes,
  preferredTime,
  quoteDraftId,
  status,
  statusOptions,
  templateKey = null,
  title,
}: QuoteDraftEditorFormProps) {
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const [selectedContactId, setSelectedContactId] = useState(
    initialContact?.id ?? "",
  );
  const [contactSearch, setContactSearch] = useState(
    initialContact ? contactLabel(initialContact) : "",
  );
  const [contactResults, setContactResults] = useState<ContactOption[]>([]);
  const [contactSearchState, setContactSearchState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [contactSearchOpen, setContactSearchOpen] = useState(false);
  const [customerFields, setCustomerFields] = useState(customer);
  const [rows, setRows] = useState<LineItemEditorRow[]>(
    lineItems.length > 0 ? lineItems.map(lineItemToEditorRow) : [blankLineItem()],
  );
  const formAction = mode === "create" ? createQuoteDraftAction : updateQuoteDraftAction;

  useEffect(() => {
    function closeWhenClickingOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setContactSearchOpen(false);
      }
    }

    document.addEventListener("mousedown", closeWhenClickingOutside);

    return () => {
      document.removeEventListener("mousedown", closeWhenClickingOutside);
    };
  }, []);

  useEffect(() => {
    const query = contactSearch.trim();

    if (query.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setContactSearchState("loading");

      try {
        const response = await fetch(
          `/api/contacts/search?q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | { data?: ContactSearchResult[]; error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Contact search failed.");
        }

        setContactResults(payload?.data ?? []);
        setContactSearchState("ready");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setContactResults([]);
        setContactSearchState("error");
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [contactSearch]);

  function updateCustomerField(key: keyof CustomerFields, value: string) {
    setCustomerFields((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateLineItem(
    index: number,
    key: keyof LineItemEditorRow,
    value: string,
  ) {
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

  function selectContact(contact: ContactOption) {
    setSelectedContactId(contact.id);
    setContactSearch(contactLabel(contact));
    setContactSearchOpen(false);
    setCustomerFields({
      company: contact.company ?? "",
      email: contact.email ?? "",
      jobAddress: contact.address ?? customerFields.jobAddress,
      name: contact.name ?? contact.company ?? "",
      phone: contact.phone ?? "",
    });
  }

  function updateContactSearch(value: string) {
    setContactSearch(value);
    setContactSearchOpen(true);

    if (value.trim().length < 2) {
      setContactResults([]);
      setContactSearchState("idle");
    }

    if (!initialContact || value !== contactLabel(initialContact)) {
      setSelectedContactId("");
    }
  }

  function clearSelectedContact() {
    setSelectedContactId("");
    setContactSearch("");
    setContactResults([]);
    setContactSearchOpen(false);
  }

  function addLineItem() {
    setRows((current) => [...current, blankLineItem()]);
  }

  function removeLineItem(index: number) {
    setRows((current) =>
      current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current,
    );
  }

  return (
    <form action={formAction} className="document-editor-form">
      {quoteDraftId ? <input name="quoteDraftId" type="hidden" value={quoteDraftId} /> : null}
      {templateKey ? <input name="templateKey" type="hidden" value={templateKey} /> : null}
      <input name="contactId" type="hidden" value={selectedContactId} />
      <div className="document-form-grid">
        <label>
          Title
          <input name="title" required type="text" defaultValue={title} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={status}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="document-contact-search full-row" ref={searchContainerRef}>
          <label htmlFor="quote-contact-search">Select customer</label>
          <div className="document-contact-search-row">
            <input
              autoComplete="off"
              id="quote-contact-search"
              onChange={(event) => updateContactSearch(event.currentTarget.value)}
              onFocus={() => setContactSearchOpen(true)}
              placeholder="Search by first name, last name, company, email, phone..."
              type="search"
              value={contactSearch}
            />
            {selectedContactId ? (
              <button
                className="secondary-button compact"
                onClick={clearSelectedContact}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>
          {selectedContactId ? (
            <small className="document-contact-search-status">
              Linked contact selected. Customer fields below can still be edited.
            </small>
          ) : (
            <small className="document-contact-search-status">
              No linked contact selected. Search and choose a suggestion, or keep this as a manual quote.
            </small>
          )}
          {contactSearchOpen && contactSearch.trim().length >= 2 ? (
            <div className="document-contact-results" role="listbox">
              {contactSearchState === "loading" ? (
                <div className="document-contact-result muted">Searching contacts...</div>
              ) : null}
              {contactSearchState === "error" ? (
                <div className="document-contact-result muted">
                  Could not search contacts. Try again.
                </div>
              ) : null}
              {contactSearchState === "ready" && contactResults.length === 0 ? (
                <div className="document-contact-result muted">No matching contacts.</div>
              ) : null}
              {contactResults.map((contact) => (
                <button
                  className="document-contact-result"
                  key={contact.id}
                  onClick={() => selectContact(contact)}
                  aria-selected={contact.id === selectedContactId}
                  role="option"
                  type="button"
                >
                  <strong>{contactLabel(contact)}</strong>
                  {contactMeta(contact) ? <span>{contactMeta(contact)}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <label>
          Customer name
          <input
            name="customerName"
            onChange={(event) => updateCustomerField("name", event.currentTarget.value)}
            type="text"
            value={customerFields.name}
          />
        </label>
        <label>
          Company
          <input
            name="customerCompany"
            onChange={(event) => updateCustomerField("company", event.currentTarget.value)}
            type="text"
            value={customerFields.company}
          />
        </label>
        <label>
          Email
          <input
            name="customerEmail"
            onChange={(event) => updateCustomerField("email", event.currentTarget.value)}
            type="email"
            value={customerFields.email}
          />
        </label>
        <label>
          Phone
          <input
            name="customerPhone"
            onChange={(event) => updateCustomerField("phone", event.currentTarget.value)}
            type="tel"
            value={customerFields.phone}
          />
        </label>
        <label>
          Job type
          <input name="jobType" type="text" defaultValue={jobType} />
        </label>
        <label>
          Preferred time
          <input name="preferredTime" type="text" defaultValue={preferredTime} />
        </label>
        <label className="full-row">
          Job address
          <input
            name="jobAddress"
            onChange={(event) => updateCustomerField("jobAddress", event.currentTarget.value)}
            type="text"
            value={customerFields.jobAddress}
          />
        </label>
        <section className="document-line-items full-row" aria-label="Line items">
          <div className="document-line-items-heading">
            <div>
              <span>Line items</span>
              <small>Item, quantity, unit price, unit, and optional line note.</small>
            </div>
            <button className="secondary-button compact" onClick={addLineItem} type="button">
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
                    onChange={(event) =>
                      updateLineItem(index, "description", event.currentTarget.value)
                    }
                    placeholder="Callout and diagnosis"
                    type="text"
                    value={row.description}
                  />
                </label>
                <label>
                  Qty
                  <input
                    inputMode="decimal"
                    name="lineItemQuantity"
                    onChange={(event) =>
                      updateLineItem(index, "quantity", event.currentTarget.value)
                    }
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.quantity}
                  />
                </label>
                <label>
                  Unit
                  <input
                    name="lineItemUnit"
                    onChange={(event) =>
                      updateLineItem(index, "unit", event.currentTarget.value)
                    }
                    placeholder="job"
                    type="text"
                    value={row.unit}
                  />
                </label>
                <label>
                  Unit price
                  <input
                    inputMode="decimal"
                    name="lineItemUnitPrice"
                    onChange={(event) =>
                      updateLineItem(index, "unitPrice", event.currentTarget.value)
                    }
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.unitPrice}
                  />
                </label>
                <div className="document-line-item-total">
                  <span>Total</span>
                  <strong>{lineTotal(row)}</strong>
                </div>
                <label className="document-line-item-notes">
                  Note
                  <input
                    name="lineItemNotes"
                    onChange={(event) =>
                      updateLineItem(index, "notes", event.currentTarget.value)
                    }
                    placeholder="Optional line note"
                    type="text"
                    value={row.notes}
                  />
                </label>
                <button
                  aria-label={`Remove line item ${index + 1}`}
                  className="document-line-item-remove"
                  disabled={rows.length <= 1}
                  onClick={() => removeLineItem(index)}
                  type="button"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </section>
        <label className="full-row">
          Notes
          <textarea name="notes" defaultValue={notes} rows={5} />
        </label>
      </div>
      <button className="primary-button profile-submit" type="submit">
        Save quote draft
      </button>
    </form>
  );
}
