"use client";

import { type ChangeEvent, type FormEvent, useState } from "react";

type FormStatus =
  | { message: string; tone: "error" | "success" }
  | null;

type AccountDeletionResponse = {
  error?: string;
  ok?: boolean;
  requestId?: string;
};

const initialForm = {
  businessName: "",
  companyWebsite: "",
  confirmation: "",
  email: "",
  name: "",
  reason: "",
  workspaceName: "",
};

export function AccountDeletionForm() {
  const [form, setForm] = useState(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<FormStatus>(null);

  const updateField =
    (field: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((current) => ({
        ...current,
        [field]: event.currentTarget.value,
      }));
    };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus(null);

    try {
      const response = await fetch("/api/account-deletion", {
        body: JSON.stringify(form),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as
        | AccountDeletionResponse
        | null;

      if (!response.ok || !result?.ok) {
        setStatus({
          message:
            result?.error ??
            "Kyro could not submit this deletion request. Try again or use the contact page.",
          tone: "error",
        });
        return;
      }

      setForm(initialForm);
      setStatus({
        message:
          "Deletion request received. Kyro will verify the account and process the request as soon as reasonably possible.",
        tone: "success",
      });
    } catch {
      setStatus({
        message:
          "Kyro could not submit this deletion request. Check your connection and try again.",
        tone: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="marketing-contact-form account-deletion-form" onSubmit={submit}>
      <label>
        Your name
        <input
          autoComplete="name"
          maxLength={160}
          name="name"
          onChange={updateField("name")}
          required
          type="text"
          value={form.name}
        />
      </label>
      <label>
        Account email
        <input
          autoComplete="email"
          maxLength={320}
          name="email"
          onChange={updateField("email")}
          required
          type="email"
          value={form.email}
        />
      </label>
      <label>
        Business name
        <input
          autoComplete="organization"
          maxLength={160}
          name="businessName"
          onChange={updateField("businessName")}
          type="text"
          value={form.businessName}
        />
      </label>
      <label>
        Workspace name
        <input
          maxLength={160}
          name="workspaceName"
          onChange={updateField("workspaceName")}
          type="text"
          value={form.workspaceName}
        />
      </label>
      <label>
        Anything Kyro should know?
        <textarea
          maxLength={2000}
          name="reason"
          onChange={updateField("reason")}
          rows={4}
          value={form.reason}
        />
      </label>
      <label className="hidden-field" tabIndex={-1}>
        Company website
        <input
          autoComplete="off"
          name="companyWebsite"
          onChange={updateField("companyWebsite")}
          tabIndex={-1}
          type="text"
          value={form.companyWebsite}
        />
      </label>
      <label>
        Type delete to confirm this request
        <input
          autoComplete="off"
          name="confirmation"
          onChange={updateField("confirmation")}
          pattern="delete"
          required
          type="text"
          value={form.confirmation}
        />
      </label>
      {status ? (
        <p className={`marketing-form-status ${status.tone}`}>
          {status.message}
        </p>
      ) : null}
      <button
        className="marketing-button destructive"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Submitting..." : "Request account deletion"}
      </button>
    </form>
  );
}
