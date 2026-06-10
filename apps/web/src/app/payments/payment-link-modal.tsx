"use client";

import { useMemo, useState } from "react";
import type { PaymentsContactOption } from "../../lib/payments/queries";

type PaymentLine = {
  amount: string;
  description: string;
  quantity: string;
};

type CreatedPaymentLink = {
  paymentRequestId: string;
  url: string | null;
};

function centsFromAmount(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function amountFromCents(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    style: "currency",
  }).format(cents / 100);
}

export function PaymentLinkModal({
  contacts,
  currency,
}: Readonly<{
  contacts: PaymentsContactOption[];
  currency: string;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const [description, setDescription] = useState("");
  const [taxIncluded, setTaxIncluded] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [recipientBusinessName, setRecipientBusinessName] = useState("");
  const [recipientTaxId, setRecipientTaxId] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactCompany, setNewContactCompany] = useState("");
  const [lines, setLines] = useState<PaymentLine[]>([
    { amount: "", description: "", quantity: "1" },
  ]);
  const [created, setCreated] = useState<CreatedPaymentLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedContact = contacts.find((contact) => contact.id === contactId) ?? null;
  const totalCents = useMemo(
    () =>
      lines.reduce((total, line) => {
        const quantity = Math.max(1, Math.round(Number(line.quantity) || 1));

        return total + centsFromAmount(line.amount) * quantity;
      }, 0),
    [lines],
  );

  function updateLine(index: number, patch: Partial<PaymentLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  async function submitPaymentLink() {
    setCreated(null);
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/payments/create-link", {
        body: JSON.stringify({
          contactId: contactId || null,
          currency,
          description: description || lines[0]?.description,
          lineItems: lines.map((line) => ({
            amountCents: centsFromAmount(line.amount),
            description: line.description,
            quantity: Math.max(1, Math.round(Number(line.quantity) || 1)),
          })),
          newContact: contactId
            ? null
            : {
                company: newContactCompany,
                email: newContactEmail,
                name: newContactName,
                phone: newContactPhone,
              },
          notifyChannels: [
            notifyEmail ? "email" : null,
            notifySms ? "sms" : null,
          ].filter(Boolean),
          notifyEmail: selectedContact?.email ?? newContactEmail,
          notifyPhone: selectedContact?.phone ?? newContactPhone,
          paymentInstructions,
          paymentMethods: ["card"],
          recipientBusinessName,
          recipientTaxId,
          taxIncluded,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; paymentRequestId?: string; url?: string | null }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to create payment link.");
      }

      setCreated({
        paymentRequestId: payload?.paymentRequestId ?? "",
        url: payload?.url ?? null,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create payment link.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        className="primary-action-button payments-link-trigger"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        Create payment link
      </button>
      {isOpen ? (
        <div className="payments-modal-backdrop" role="presentation">
          <section
            aria-label="Create payment link"
            className="payments-modal"
            role="dialog"
          >
            <header className="payments-modal-header">
              <div>
                <p className="eyebrow">Payment request</p>
                <h2>Create payment link</h2>
              </div>
              <button
                className="secondary-button"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="payments-modal-grid">
              <label>
                <span>Customer</span>
                <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
                  <option value="">Create or enter manually</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.label}
                      {contact.email ? ` - ${contact.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Invoice description</span>
                <input
                  placeholder="Bathroom rough-in deposit"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              {!contactId ? (
                <>
                  <label>
                    <span>Name</span>
                    <input value={newContactName} onChange={(event) => setNewContactName(event.target.value)} />
                  </label>
                  <label>
                    <span>Company</span>
                    <input value={newContactCompany} onChange={(event) => setNewContactCompany(event.target.value)} />
                  </label>
                  <label>
                    <span>Email</span>
                    <input value={newContactEmail} onChange={(event) => setNewContactEmail(event.target.value)} />
                  </label>
                  <label>
                    <span>Phone</span>
                    <input value={newContactPhone} onChange={(event) => setNewContactPhone(event.target.value)} />
                  </label>
                </>
              ) : null}
              <label>
                <span>Recipient business</span>
                <input
                  placeholder="Optional"
                  value={recipientBusinessName}
                  onChange={(event) => setRecipientBusinessName(event.target.value)}
                />
              </label>
              <label>
                <span>ABN / ACN</span>
                <input
                  placeholder="Optional"
                  value={recipientTaxId}
                  onChange={(event) => setRecipientTaxId(event.target.value)}
                />
              </label>
            </div>

            <div className="payments-line-items">
              <div className="payments-line-items-header">
                <p className="eyebrow">Items</p>
                <button
                  className="subtle-button"
                  onClick={() =>
                    setLines((current) => [
                      ...current,
                      { amount: "", description: "", quantity: "1" },
                    ])
                  }
                  type="button"
                >
                  Add item
                </button>
              </div>
              {lines.map((line, index) => (
                <div className="payments-line-item-row" key={index}>
                  <input
                    aria-label="Item description"
                    placeholder="Description"
                    value={line.description}
                    onChange={(event) => updateLine(index, { description: event.target.value })}
                  />
                  <input
                    aria-label="Quantity"
                    inputMode="decimal"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(event) => updateLine(index, { quantity: event.target.value })}
                  />
                  <input
                    aria-label="Amount"
                    inputMode="decimal"
                    placeholder="Amount"
                    value={line.amount}
                    onChange={(event) => updateLine(index, { amount: event.target.value })}
                  />
                  <button
                    className="subtle-button"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="payments-modal-options">
              <label className="inline-toggle">
                <input
                  checked={taxIncluded}
                  onChange={(event) => setTaxIncluded(event.target.checked)}
                  type="checkbox"
                />
                Tax included
              </label>
              <label className="inline-toggle">
                <input
                  checked={notifyEmail}
                  onChange={(event) => setNotifyEmail(event.target.checked)}
                  type="checkbox"
                />
                Notify by email
              </label>
              <label className="inline-toggle">
                <input
                  checked={notifySms}
                  onChange={(event) => setNotifySms(event.target.checked)}
                  type="checkbox"
                />
                Notify by SMS
              </label>
              <span className="payments-method-pill">Card checkout</span>
            </div>

            <label className="payments-instructions-field">
              <span>Payment instructions</span>
              <textarea
                placeholder="Optional note for the customer or internal payment context."
                value={paymentInstructions}
                onChange={(event) => setPaymentInstructions(event.target.value)}
              />
            </label>

            <footer className="payments-modal-footer">
              <strong>{amountFromCents(totalCents, currency)}</strong>
              <button
                className="primary-action-button"
                disabled={isSubmitting || totalCents < 50}
                onClick={submitPaymentLink}
                type="button"
              >
                {isSubmitting ? "Creating..." : "Create link"}
              </button>
            </footer>

            {error ? <p className="engine-error compact">{error}</p> : null}
            {created ? (
              <div className="payments-created-link">
                <p>Payment link created.</p>
                {created.url ? (
                  <a href={created.url} rel="noreferrer" target="_blank">
                    Open checkout
                  </a>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
