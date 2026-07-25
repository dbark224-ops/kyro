"use client";

import { useState } from "react";
import { AddressAutocompleteField } from "../components/address-autocomplete-field";
import { createManualLeadAction } from "./actions";

const PRIORITY_OPTIONS = [
  { label: "Normal", value: "normal" },
  { label: "High", value: "high" },
  { label: "Urgent", value: "urgent" },
  { label: "Low", value: "low" },
] as const;

export function ManualLeadModal() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="primary-button compact crm-add-lead-trigger"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        Add
      </button>
      {isOpen ? (
        <div className="crm-lead-modal-backdrop" role="presentation">
          <section
            aria-label="Add manual lead"
            className="crm-lead-modal"
            role="dialog"
          >
            <header className="crm-lead-modal-header">
              <div>
                <p className="eyebrow">CRM</p>
                <h2>Add lead</h2>
              </div>
              <button
                className="secondary-button compact"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                Close
              </button>
            </header>

            <form action={createManualLeadAction} className="crm-lead-form">
              <section className="crm-lead-form-section">
                <h3>Job</h3>
                <div className="crm-lead-form-grid">
                  <label className="full-row">
                    Lead title
                    <input
                      autoFocus
                      name="title"
                      placeholder="Leaking shower in ensuite"
                      required
                      type="text"
                    />
                  </label>
                  <label className="full-row">
                    Description
                    <textarea
                      name="description"
                      placeholder="What does the customer need help with?"
                      rows={4}
                    />
                  </label>
                  <label>
                    Service type
                    <input
                      name="serviceType"
                      placeholder="Bathroom repair"
                      type="text"
                    />
                  </label>
                  <label>
                    Priority
                    <select name="priority" defaultValue="normal">
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Estimated value
                    <input
                      inputMode="decimal"
                      name="estimatedValue"
                      placeholder="650"
                      type="text"
                    />
                  </label>
                  <label className="full-row">
                    Next step
                    <input
                      name="nextStep"
                      placeholder="Call back today to book inspection"
                      type="text"
                    />
                  </label>
                </div>
              </section>

              <section className="crm-lead-form-section">
                <h3>Customer</h3>
                <div className="crm-lead-form-grid">
                  <label>
                    Name
                    <input name="name" placeholder="Customer name" type="text" />
                  </label>
                  <label>
                    Company
                    <input name="company" placeholder="Company" type="text" />
                  </label>
                  <label>
                    Email
                    <input
                      autoComplete="email"
                      name="email"
                      placeholder="name@example.com"
                      type="email"
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      autoComplete="tel"
                      name="phone"
                      placeholder="0400..."
                      type="tel"
                    />
                  </label>
                  <AddressAutocompleteField
                    className="full-row"
                    label="Address"
                    name="address"
                    placeholder="Street, suburb, site..."
                  />
                  <label className="full-row">
                    Contact notes
                    <textarea
                      name="contactNotes"
                      placeholder="Access details, preferences, or context"
                      rows={3}
                    />
                  </label>
                </div>
              </section>

              <footer className="crm-lead-modal-footer">
                <button
                  className="secondary-button compact"
                  onClick={() => setIsOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button className="primary-button compact" type="submit">
                  Create lead
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
