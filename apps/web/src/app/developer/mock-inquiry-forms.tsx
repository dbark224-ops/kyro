"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { AddressAutocompleteField } from "../components/address-autocomplete-field";
import { createManualInboundAction } from "../inbound/actions";
import {
  createMockEmailInboundAction,
  createMockSmsInboundAction,
} from "./actions";
import styles from "./mock-inquiry-forms.module.css";

export type DeveloperMockMode = "email" | "manual" | "sms";

type EmailConnectionOption = {
  accountEmail: string | null;
  id: string;
  provider: "google" | "microsoft";
};

type PhoneNumberOption = {
  friendlyName: string | null;
  id: string;
  phoneNumber: string;
};

type DeveloperMockInquiryFormsProps = {
  emailConnections: EmailConnectionOption[];
  initialMode: DeveloperMockMode;
  phoneNumbers: PhoneNumberOption[];
  redirectPaths?: Partial<Record<DeveloperMockMode, string>>;
  submissionKeys: Record<DeveloperMockMode, string>;
};

const modes: Array<{ label: string; value: DeveloperMockMode }> = [
  { label: "Structured", value: "manual" },
  { label: "Email", value: "email" },
  { label: "SMS", value: "sms" },
];

function SubmitButton({
  children,
  disabled = false,
}: {
  children: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className="primary-button compact settings-submit-button"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? (
        <span className="settings-submit-spinner" aria-hidden="true" />
      ) : null}
      {pending ? "Ingesting..." : children}
    </button>
  );
}

function StructuredInquiryForm({
  redirectTo,
  submissionKey,
}: {
  redirectTo: string;
  submissionKey: string;
}) {
  return (
    <form action={createManualInboundAction} className="developer-form">
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <input name="submissionKey" type="hidden" value={submissionKey} />

      <div className="document-form-grid">
        <label>
          Contact name
          <input
            name="contactName"
            placeholder="Jamie Redknapp"
            required
            type="text"
          />
        </label>
        <label>
          Email
          <input name="email" placeholder="customer@example.com" type="email" />
        </label>
        <label>
          Phone
          <input name="phone" placeholder="0400 000 000" type="text" />
        </label>
        <label>
          Company
          <input name="company" placeholder="Optional" type="text" />
        </label>
        <label>
          Contact type
          <select defaultValue="client" name="contactType">
            <option value="client">Client</option>
            <option value="supplier">Supplier</option>
            <option value="contractor">Contractor</option>
            <option value="builder">Builder</option>
            <option value="property_manager">Property manager</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Service type
          <input
            name="serviceType"
            placeholder="Bathroom quote, blocked drain, hot water..."
            type="text"
          />
        </label>
        <AddressAutocompleteField
          className="full-row"
          label="Address"
          name="address"
          placeholder="Site or contact address"
        />
        <label className="full-row">
          Inquiry message
          <textarea
            name="message"
            placeholder="Paste or type the inbound inquiry here..."
            required
          />
        </label>
      </div>

      <div className="settings-footer">
        <span>
          Creates a pre-structured contact, lead, conversation, message, and AI
          triage run.
        </span>
        <SubmitButton>Ingest structured inquiry</SubmitButton>
      </div>
    </form>
  );
}

function EmailInquiryForm({
  connections,
  redirectTo,
  submissionKey,
}: {
  connections: EmailConnectionOption[];
  redirectTo: string;
  submissionKey: string;
}) {
  const hasConnections = connections.length > 0;

  return (
    <form action={createMockEmailInboundAction} className="developer-form">
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <input name="submissionKey" type="hidden" value={submissionKey} />

      <div className={styles.modeNote}>
        This is the normalized envelope Kyro receives after Gmail or Outlook
        returns a message. It uses the workspace&apos;s real filtering and
        triage rules.
      </div>

      <div className="document-form-grid">
        <label>
          Connected inbox
          <select disabled={!hasConnections} name="connectionId" required>
            {hasConnections ? null : (
              <option value="">Connect Gmail or Outlook first</option>
            )}
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.provider === "google" ? "Gmail" : "Outlook"} -{" "}
                {connection.accountEmail ?? "Connected account"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Received at
          <input name="receivedAt" type="datetime-local" />
        </label>
        <label>
          From name
          <input name="fromName" placeholder="Jamie Redknapp" type="text" />
        </label>
        <label>
          From email
          <input
            name="fromEmail"
            placeholder="customer@example.com"
            required
            type="email"
          />
        </label>
        <label className="full-row">
          To
          <input
            name="toEmails"
            placeholder="Connected inbox by default; separate multiple addresses with commas"
            type="text"
          />
        </label>
        <label className="full-row">
          Subject
          <input
            name="subject"
            placeholder="Request for a bathroom quote"
            required
            type="text"
          />
        </label>
        <label className="full-row">
          Plain-text body
          <textarea
            name="bodyText"
            placeholder="Paste the exact email body Kyro should receive..."
            required
          />
        </label>
      </div>

      <details className={styles.providerDetails}>
        <summary>Provider and threading fields</summary>
        <div className="document-form-grid">
          <label className="full-row">
            HTML body
            <textarea
              className={styles.compactTextarea}
              name="bodyHtml"
              placeholder="Optional raw HTML body"
            />
          </label>
          <label className="full-row">
            Snippet
            <input
              name="snippet"
              placeholder="Generated from the plain-text body when blank"
              type="text"
            />
          </label>
          <label>
            Provider message ID
            <input
              name="providerMessageId"
              placeholder="Auto-generated"
              type="text"
            />
          </label>
          <label>
            Provider thread ID
            <input name="externalThreadId" placeholder="Optional" type="text" />
          </label>
          <label>
            External message ID
            <input
              name="externalMessageId"
              placeholder="Auto-generated"
              type="text"
            />
          </label>
          <label>
            Header Message-ID
            <input
              name="headerMessageId"
              placeholder="&lt;message@example.com&gt;"
              type="text"
            />
          </label>
          <label>
            In-Reply-To
            <input
              name="inReplyTo"
              placeholder="&lt;previous@example.com&gt;"
              type="text"
            />
          </label>
          <label>
            References
            <input
              name="references"
              placeholder="Message IDs separated by spaces"
              type="text"
            />
          </label>
          <label>
            Attachment filename
            <input
              name="attachmentFilename"
              placeholder="plans.pdf"
              type="text"
            />
          </label>
          <label>
            Attachment content type
            <input
              name="attachmentContentType"
              placeholder="application/pdf"
              type="text"
            />
          </label>
          <label>
            Attachment provider ID
            <input name="attachmentId" placeholder="Optional" type="text" />
          </label>
          <label>
            Attachment size (bytes)
            <input
              min="0"
              name="attachmentSizeBytes"
              placeholder="204800"
              type="number"
            />
          </label>
          <label className={styles.checkboxField}>
            <input name="automated" type="checkbox" />
            Mark as provider-detected automated mail
          </label>
        </div>
      </details>

      <div className="settings-footer">
        <span>
          Runs the real email classifier, sender rules, thread matching,
          attachments metadata, CRM promotion, drafts, audit, and usage.
        </span>
        <SubmitButton disabled={!hasConnections}>
          Ingest mock email
        </SubmitButton>
      </div>
    </form>
  );
}

function SmsInquiryForm({
  phoneNumbers,
  redirectTo,
  submissionKey,
}: {
  phoneNumbers: PhoneNumberOption[];
  redirectTo: string;
  submissionKey: string;
}) {
  const hasNumbers = phoneNumbers.length > 0;

  return (
    <form action={createMockSmsInboundAction} className="developer-form">
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <input name="submissionKey" type="hidden" value={submissionKey} />

      <div className={styles.modeNote}>
        These are the four Twilio fields Kyro consumes. The sender will be
        routed as an internal user, consent keyword, or external inquiry using
        the same rules as the live webhook.
      </div>

      <div className="document-form-grid">
        <label>
          From
          <input name="from" placeholder="+15755550123" required type="tel" />
        </label>
        <label>
          To
          <select disabled={!hasNumbers} name="to" required>
            {hasNumbers ? null : (
              <option value="">Assign an active Kyro number first</option>
            )}
            {phoneNumbers.map((number) => (
              <option key={number.id} value={number.phoneNumber}>
                {number.phoneNumber}
                {number.friendlyName ? ` - ${number.friendlyName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="full-row">
          Message SID
          <input
            name="messageSid"
            placeholder="Auto-generated when blank"
            type="text"
          />
        </label>
        <label className="full-row">
          Body
          <textarea
            name="body"
            placeholder="Type the exact inbound SMS body..."
            required
          />
        </label>
      </div>

      <div className="settings-footer">
        <span>
          Runs trusted-sender recognition, opt-in/out handling, assistant or
          inquiry routing, CRM triage, audit, and SMS metering.
        </span>
        <SubmitButton disabled={!hasNumbers}>Ingest mock SMS</SubmitButton>
      </div>
    </form>
  );
}

export function DeveloperMockInquiryForms({
  emailConnections,
  initialMode,
  phoneNumbers,
  redirectPaths,
  submissionKeys,
}: DeveloperMockInquiryFormsProps) {
  const [mode, setMode] = useState(initialMode);

  function selectMode(nextMode: DeveloperMockMode) {
    setMode(nextMode);
  }

  return (
    <div>
      <div
        className={styles.switcher}
        aria-label="Mock inquiry type"
        role="group"
      >
        {modes.map((item) => (
          <button
            aria-pressed={mode === item.value}
            className={mode === item.value ? styles.activeMode : styles.mode}
            key={item.value}
            onClick={() => selectMode(item.value)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === "manual" ? (
        <StructuredInquiryForm
          redirectTo={redirectPaths?.manual ?? "/developer?mock=manual"}
          submissionKey={submissionKeys.manual}
        />
      ) : null}
      {mode === "email" ? (
        <EmailInquiryForm
          connections={emailConnections}
          redirectTo={redirectPaths?.email ?? "/developer?mock=email"}
          submissionKey={submissionKeys.email}
        />
      ) : null}
      {mode === "sms" ? (
        <SmsInquiryForm
          phoneNumbers={phoneNumbers}
          redirectTo={redirectPaths?.sms ?? "/developer?mock=sms"}
          submissionKey={submissionKeys.sms}
        />
      ) : null}
    </div>
  );
}
