"use client";

import { useState, type FormEvent } from "react";

type FieldErrors = Record<string, string>;

const steps = [
  {
    copy: "Start with the person and business we should contact about early access.",
    eyebrow: "Step 1",
    fields: ["name", "email", "businessName", "industry"],
    title: "Contact details",
  },
  {
    copy: "Help us understand whether Kyro is a good fit for your admin workload.",
    eyebrow: "Step 2",
    fields: ["location", "adminFocus"],
    title: "Business fit",
  },
];

const fieldLabels: Record<string, string> = {
  adminFocus: "What should Kyro help with?",
  businessName: "Business name",
  email: "Email",
  industry: "Trade / industry",
  location: "Location",
  name: "Your first and last name",
};

function fieldElement(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);

  return field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
    ? field
    : null;
}

function fieldValue(form: HTMLFormElement, name: string) {
  return fieldElement(form, name)?.value.trim() ?? "";
}

export function WaitlistForm() {
  const [step, setStep] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  function clearFieldError(name: string) {
    setFieldErrors((current) => {
      if (!current[name]) {
        return current;
      }

      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function validateFields(form: HTMLFormElement, fieldNames: string[]) {
    const nextErrors: FieldErrors = {};

    for (const fieldName of fieldNames) {
      const field = fieldElement(form, fieldName);

      if (!field) {
        continue;
      }

      if (!field.value.trim()) {
        nextErrors[fieldName] = `${fieldLabels[fieldName] ?? "This field"} is required.`;
        continue;
      }

      if (
        field instanceof HTMLInputElement &&
        field.type === "email" &&
        !field.checkValidity()
      ) {
        nextErrors[fieldName] = "Enter a valid email address.";
      }
    }

    setFieldErrors((current) => {
      const cleared = { ...current };
      for (const fieldName of fieldNames) {
        delete cleared[fieldName];
      }
      return { ...cleared, ...nextErrors };
    });

    if (Object.keys(nextErrors).length > 0) {
      fieldElement(form, Object.keys(nextErrors)[0])?.focus();
      return false;
    }

    return true;
  }

  function validateCurrentStep(form: HTMLFormElement) {
    return validateFields(form, steps[step].fields);
  }

  function goToStep(index: number, form: HTMLFormElement | null) {
    if (index <= step) {
      setStep(index);
      return;
    }

    if (index > step + 1 || !form || !validateCurrentStep(form)) {
      return;
    }

    setStep(index);
  }

  function goToNextStep(event: FormEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (!form || !validateCurrentStep(form)) {
      return;
    }

    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const allFields = steps.flatMap((item) => item.fields);

    if (!validateFields(form, allFields) || isSubmitting) {
      return;
    }

    setFormError("");
    setIsSubmitting(true);

    const payload = {
      adminFocus: fieldValue(form, "adminFocus"),
      businessName: fieldValue(form, "businessName"),
      email: fieldValue(form, "email"),
      enquiryVolume: fieldValue(form, "enquiryVolume"),
      industry: fieldValue(form, "industry"),
      location: fieldValue(form, "location"),
      name: fieldValue(form, "name"),
      notes: fieldValue(form, "notes"),
      phone: fieldValue(form, "phone"),
      serviceArea: fieldValue(form, "serviceArea"),
    };

    const response = await fetch("/api/waitlist", {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => null)) as
      | { error?: string; ok?: boolean }
      | null;

    setIsSubmitting(false);

    if (!response.ok || !result?.ok) {
      setFormError(result?.error ?? "Kyro could not save this waitlist request.");
      return;
    }

    setIsSubmitted(true);
  }

  if (isSubmitted) {
    return (
      <section className="form-card auth-form-card auth-create-form waitlist-success">
        <div className="auth-stepper" aria-label="Waitlist progress">
          {["Details", "Fit", "Saved"].map((title, index) => (
            <span className="auth-step complete" key={title}>
              <span className="auth-step-index">{index + 1}</span>
              <span className="auth-step-title">{title}</span>
            </span>
          ))}
        </div>

        <div className="auth-verification-card waitlist-success-card">
          <p className="eyebrow">Waitlist saved</p>
          <h2>You are on the early access list.</h2>
          <p>
            Kyro will use these details to prioritise the next small batch of
            sole traders and service businesses for onboarding.
          </p>
        </div>
      </section>
    );
  }

  return (
    <form
      className="form-card auth-form-card auth-create-form waitlist-form"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="auth-stepper" aria-label="Waitlist progress">
        {steps.map((item, index) => (
          <button
            className={`auth-step ${index === step ? "active" : ""} ${
              index < step ? "complete" : ""
            }`}
            key={item.title}
            onClick={(event) => goToStep(index, event.currentTarget.form)}
            type="button"
          >
            <span className="auth-step-index">{index + 1}</span>
            <span className="auth-step-title">{item.title}</span>
          </button>
        ))}
      </div>

      <div className="auth-onboarding-heading">
        <p className="eyebrow">{steps[step].eyebrow}</p>
        <h2>{steps[step].title}</h2>
        <p>{steps[step].copy}</p>
      </div>

      {formError ? <p className="form-alert error compact">{formError}</p> : null}

      <section className="auth-form-section" hidden={step !== 0}>
        <div className="auth-form-grid">
          <label>
            Your first and last name
            <input
              aria-describedby={fieldErrors.name ? "waitlist-name-error" : undefined}
              aria-invalid={Boolean(fieldErrors.name)}
              autoComplete="name"
              name="name"
              onChange={() => clearFieldError("name")}
              required
              type="text"
            />
            {fieldErrors.name ? (
              <span className="auth-field-error" id="waitlist-name-error">
                {fieldErrors.name}
              </span>
            ) : null}
          </label>

          <label>
            Email
            <input
              aria-describedby={fieldErrors.email ? "waitlist-email-error" : undefined}
              aria-invalid={Boolean(fieldErrors.email)}
              autoComplete="email"
              name="email"
              onChange={() => clearFieldError("email")}
              required
              type="email"
            />
            {fieldErrors.email ? (
              <span className="auth-field-error" id="waitlist-email-error">
                {fieldErrors.email}
              </span>
            ) : null}
          </label>

          <label>
            Mobile number
            <input autoComplete="tel" name="phone" type="tel" />
          </label>

          <label>
            Business name
            <input
              aria-describedby={
                fieldErrors.businessName ? "waitlist-business-error" : undefined
              }
              aria-invalid={Boolean(fieldErrors.businessName)}
              autoComplete="organization"
              name="businessName"
              onChange={() => clearFieldError("businessName")}
              required
              type="text"
            />
            {fieldErrors.businessName ? (
              <span className="auth-field-error" id="waitlist-business-error">
                {fieldErrors.businessName}
              </span>
            ) : null}
          </label>

          <label className="auth-span-2">
            Trade / industry
            <input
              aria-describedby={
                fieldErrors.industry ? "waitlist-industry-error" : undefined
              }
              aria-invalid={Boolean(fieldErrors.industry)}
              name="industry"
              onChange={() => clearFieldError("industry")}
              placeholder="Plumbing, electrical, landscaping, photography..."
              required
              type="text"
            />
            {fieldErrors.industry ? (
              <span className="auth-field-error" id="waitlist-industry-error">
                {fieldErrors.industry}
              </span>
            ) : null}
          </label>
        </div>
      </section>

      <section className="auth-form-section" hidden={step !== 1}>
        <div className="auth-form-grid">
          <label>
            Location
            <input
              aria-describedby={
                fieldErrors.location ? "waitlist-location-error" : undefined
              }
              aria-invalid={Boolean(fieldErrors.location)}
              name="location"
              onChange={() => clearFieldError("location")}
              placeholder="Suburb, city, or region"
              required
              type="text"
            />
            {fieldErrors.location ? (
              <span className="auth-field-error" id="waitlist-location-error">
                {fieldErrors.location}
              </span>
            ) : null}
          </label>

          <label>
            Enquiry volume
            <select defaultValue="" name="enquiryVolume">
              <option value="" disabled>
                Choose one
              </option>
              <option value="0-10">0-10 per month</option>
              <option value="11-30">11-30 per month</option>
              <option value="31-75">31-75 per month</option>
              <option value="75+">75+ per month</option>
            </select>
          </label>

          <label className="auth-span-2">
            Service area
            <input
              name="serviceArea"
              placeholder="Optional: Brisbane southside, Gold Coast, mobile across Perth..."
              type="text"
            />
          </label>

          <label className="auth-span-2">
            What should Kyro help with?
            <textarea
              aria-describedby={
                fieldErrors.adminFocus ? "waitlist-admin-error" : undefined
              }
              aria-invalid={Boolean(fieldErrors.adminFocus)}
              name="adminFocus"
              onChange={() => clearFieldError("adminFocus")}
              placeholder="Missed calls, quote follow-up, replying to enquiries, chasing customers..."
              required
              rows={5}
            />
            {fieldErrors.adminFocus ? (
              <span className="auth-field-error" id="waitlist-admin-error">
                {fieldErrors.adminFocus}
              </span>
            ) : null}
          </label>

          <label className="auth-span-2">
            Anything else?
            <textarea
              name="notes"
              placeholder="Optional: current tools, phone setup, or what would make this useful."
              rows={4}
            />
          </label>
        </div>
      </section>

      <div className="auth-step-actions">
        {step > 0 ? (
          <button
            className="secondary-button"
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
            type="button"
          >
            Back
          </button>
        ) : (
          <span />
        )}

        {step < steps.length - 1 ? (
          <button className="primary-button" onClick={goToNextStep} type="button">
            Next
          </button>
        ) : (
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Joining..." : "Join waitlist"}
          </button>
        )}
      </div>
    </form>
  );
}
