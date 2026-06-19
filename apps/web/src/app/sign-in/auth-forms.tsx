"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { OPERATING_COUNTRY_OPTIONS } from "../../lib/workspace/operating-countries";

const PHONE_COUNTRY_OPTIONS = [
  { label: "AU", dialCode: "+61", country: "Australia" },
  { label: "NZ", dialCode: "+64", country: "New Zealand" },
  { label: "UK", dialCode: "+44", country: "United Kingdom" },
  { label: "US", dialCode: "+1", country: "USA" },
  { label: "CA", dialCode: "+1", country: "Canada" },
] as const;

const REMEMBERED_EMAIL_KEY = "kyro.rememberedEmail";

type ServerAction = (formData: FormData) => void | Promise<void>;

type BillingSetupState = {
  clientSecret: string;
  publishableKey: string;
  redirectAfterSetup: string;
  requiresEmailVerification: boolean;
  setupIntentId: string;
  trialEndsAt: string;
  workspaceId: string;
};

type PasswordFieldProps = {
  autoComplete: string;
  error?: string;
  label?: string;
  minLength?: number;
  name?: string;
  onValueChange?: () => void;
};

function FieldHelp({ text }: { text: string }) {
  return (
    <span className="auth-field-help" tabIndex={0}>
      i
      <span className="auth-field-help-text">{text}</span>
    </span>
  );
}

function PasswordField({
  autoComplete,
  error,
  label = "Password",
  minLength,
  name = "password",
  onValueChange,
}: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const errorId = `${name}-error`;

  return (
    <label>
      {label}
      <span className="auth-password-wrap">
        <input
          name={name}
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={onValueChange}
        />
        <button
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="auth-password-toggle"
          type="button"
          onClick={() => setShowPassword((current) => !current)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            {showPassword ? (
              <>
                <path d="m3 3 18 18" />
                <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                <path d="M9.5 5.6A10.6 10.6 0 0 1 12 5c5 0 8.5 4.5 9.6 6.3a1.4 1.4 0 0 1 0 1.4 18 18 0 0 1-3 3.6" />
                <path d="M6.7 6.7a18 18 0 0 0-4.3 4.6 1.4 1.4 0 0 0 0 1.4C3.5 14.5 7 19 12 19a10.8 10.8 0 0 0 4.1-.8" />
              </>
            ) : (
              <>
                <path d="M2.4 11.3C3.5 9.5 7 5 12 5s8.5 4.5 9.6 6.3a1.4 1.4 0 0 1 0 1.4C20.5 14.5 17 19 12 19s-8.5-4.5-9.6-6.3a1.4 1.4 0 0 1 0-1.4Z" />
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              </>
            )}
          </svg>
        </button>
      </span>
      {error ? (
        <span className="auth-field-error" id={errorId}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function SignInForm({ action }: { action: ServerAction }) {
  const [email, setEmail] = useState("");
  const [rememberEmail, setRememberEmail] = useState(false);

  useEffect(() => {
    const loadTimeout = window.setTimeout(() => {
      const rememberedEmail = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);

      if (rememberedEmail) {
        setEmail(rememberedEmail);
        setRememberEmail(true);
      }
    }, 0);

    return () => window.clearTimeout(loadTimeout);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const submittedEmail = String(formData.get("email") ?? "").trim();

    if (rememberEmail && submittedEmail) {
      window.localStorage.setItem(REMEMBERED_EMAIL_KEY, submittedEmail);
      return;
    }

    window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  }

  return (
    <form
      className="form-card auth-form-card"
      action={action}
      onSubmit={handleSubmit}
    >
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <PasswordField autoComplete="current-password" />
      <label className="auth-remember-row">
        <input
          name="rememberUser"
          type="checkbox"
          checked={rememberEmail}
          onChange={(event) => setRememberEmail(event.target.checked)}
        />
        <span>Remember this email</span>
      </label>
      <button className="primary-button" type="submit">
        Sign in
      </button>
    </form>
  );
}

function InlineCardSetup({
  setup,
  onError,
}: {
  onError: (message: string) => void;
  setup: BillingSetupState;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSaving, setIsSaving] = useState(false);

  async function handleSaveCard() {
    if (!stripe || !elements || isSaving) {
      return;
    }

    setIsSaving(true);
    onError("");

    const result = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${setup.redirectAfterSetup}`,
      },
      redirect: "if_required",
    });

    if (result.error) {
      setIsSaving(false);
      onError(result.error.message ?? "Stripe could not save that card.");
      return;
    }

    const setupIntentId = result.setupIntent?.id ?? setup.setupIntentId;
    const response = await fetch("/api/auth/create-account/complete-card", {
      body: JSON.stringify({
        setupIntentId,
        workspaceId: setup.workspaceId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setIsSaving(false);
      onError(payload?.error ?? "Kyro could not finish card setup.");
      return;
    }

    window.location.assign(setup.redirectAfterSetup);
  }

  return (
    <div className="auth-inline-payment">
      <div className="auth-trial-summary">
        <p className="eyebrow">Two-week free trial</p>
        <h3>No charge today.</h3>
        <p>
          Your first 14 days are free. Trial usage is not billed, usage is
          post-charged after the trial, and you can cancel any time before
          billing starts. Kyro will send a reminder and call before your trial
          finishes.
        </p>
      </div>
      <p className="auth-stripe-note">Powered by Stripe</p>
      <PaymentElement />
      <button
        className="primary-button"
        disabled={!stripe || !elements || isSaving}
        type="button"
        onClick={handleSaveCard}
      >
        {isSaving ? "Saving card..." : "Save card and finish"}
      </button>
    </div>
  );
}

export function CreateAccountForm() {
  const [step, setStep] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [billingSetup, setBillingSetup] = useState<BillingSetupState | null>(
    null,
  );
  const stripePromise = useMemo(
    () =>
      billingSetup?.publishableKey
        ? loadStripe(billingSetup.publishableKey)
        : null,
    [billingSetup?.publishableKey],
  );

  const steps = [
    {
      eyebrow: "Step 1",
      title: "Create your login",
      copy: "This is the person who owns the first Kyro workspace.",
      fields: [
        "name",
        "email",
        "confirmEmail",
        "password",
        "confirmPassword",
        "mobileCountry",
        "mobileNumber",
      ],
    },
    {
      eyebrow: "Step 2",
      title: "Business basics",
      copy: "Kyro uses this to set the right country, currency, phone defaults, and workspace context.",
      fields: [
        "businessName",
        "industry",
        "country",
        "businessLocation",
        "postcode",
      ],
    },
    {
      eyebrow: "Step 3",
      title: "Add your payment method",
      copy: billingSetup
        ? ""
        : "Creating your workspace and loading the secure card form.",
      fields: [],
    },
  ];

  function fieldElement(form: HTMLFormElement, name: string) {
    const field = form.elements.namedItem(name);
    return field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
      ? field
      : null;
  }

  const fieldLabels: Record<string, string> = {
    businessLocation: "Location",
    businessName: "Business name",
    confirmEmail: "Confirm email",
    confirmPassword: "Confirm password",
    country: "Operating country",
    email: "Email",
    industry: "Trade / industry",
    mobileCountry: "Phone country",
    mobileNumber: "Mobile number",
    name: "Your first and last name",
    password: "Password",
    postcode: "Postcode / ZIP",
    trialAcknowledged: "Trial acknowledgement",
  };

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

  function fieldValue(form: HTMLFormElement, name: string) {
    const field = fieldElement(form, name);
    return field ? field.value.trim() : "";
  }

  function validateFields(form: HTMLFormElement, fieldNames: string[]) {
    const nextErrors: Record<string, string> = {};
    const email = fieldValue(form, "email");
    const confirmEmail = fieldValue(form, "confirmEmail");
    const password = fieldValue(form, "password");
    const confirmPassword = fieldValue(form, "confirmPassword");

    for (const fieldName of fieldNames) {
      const field = fieldElement(form, fieldName);

      if (!field) {
        continue;
      }

      if (field instanceof HTMLInputElement && field.type === "checkbox") {
        if (!field.checked) {
          nextErrors[fieldName] = "Confirm this before continuing.";
        }
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

    if (
      fieldNames.includes("confirmEmail") &&
      email &&
      confirmEmail &&
      email.toLowerCase() !== confirmEmail.toLowerCase()
    ) {
      nextErrors.confirmEmail = "Email addresses must match.";
    }

    if (fieldNames.includes("password") && password && password.length < 8) {
      nextErrors.password = "Password must be at least 8 characters.";
    }

    if (
      fieldNames.includes("confirmPassword") &&
      password &&
      confirmPassword &&
      password !== confirmPassword
    ) {
      nextErrors.confirmPassword = "Passwords must match.";
    }

    setFieldErrors((current) => {
      const cleared = { ...current };
      for (const fieldName of fieldNames) {
        delete cleared[fieldName];
      }
      return { ...cleared, ...nextErrors };
    });

    if (Object.keys(nextErrors).length > 0) {
      const firstInvalid = fieldElement(form, Object.keys(nextErrors)[0]);
      firstInvalid?.focus();
      return false;
    }

    return true;
  }

  function validateCurrentStep(form: HTMLFormElement) {
    return validateFields(form, steps[step].fields);
  }

  async function createWorkspaceAndLoadBilling(form: HTMLFormElement) {
    if (
      !validateFields(form, [...steps[0].fields, ...steps[1].fields]) ||
      isSubmitting
    ) {
      return false;
    }

    setIsSubmitting(true);
    setFormError("");
    setFormMessage("");

    const response = await fetch("/api/auth/create-account", {
      body: JSON.stringify(formPayload(form)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as
      | (BillingSetupState & { error?: string; ok?: boolean })
      | null;

    if (!response.ok || !payload?.clientSecret || !payload.publishableKey) {
      setIsSubmitting(false);
      setFormError(payload?.error ?? "Kyro could not create the account.");
      return false;
    }

    setBillingSetup({
      clientSecret: payload.clientSecret,
      publishableKey: payload.publishableKey,
      redirectAfterSetup: payload.redirectAfterSetup,
      requiresEmailVerification: payload.requiresEmailVerification,
      setupIntentId: payload.setupIntentId,
      trialEndsAt: payload.trialEndsAt,
      workspaceId: payload.workspaceId,
    });
    setIsSubmitting(false);
    setFormMessage("");
    return true;
  }

  async function goToNextStep(event: FormEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (!form || !validateCurrentStep(form)) {
      return;
    }

    if (step === 1 && !billingSetup) {
      const ready = await createWorkspaceAndLoadBilling(form);

      if (!ready) {
        return;
      }
    }

    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function goToStep(index: number, form: HTMLFormElement | null) {
    if (index <= step) {
      setStep(index);
      return;
    }

    if (index > step + 1) {
      return;
    }

    if (!form || !validateCurrentStep(form)) {
      return;
    }

    if (index === 2 && !billingSetup) {
      const ready = await createWorkspaceAndLoadBilling(form);

      if (!ready) {
        return;
      }
    }

    setStep(index);
  }

  function formPayload(form: HTMLFormElement) {
    const formData = new FormData(form);

    const entries = [
      "businessLocation",
      "businessName",
      "confirmEmail",
      "confirmPassword",
      "country",
      "email",
      "industry",
      "mobileCountry",
      "mobileNumber",
      "name",
      "password",
      "postcode",
      "serviceArea",
    ].map((key) => [key, String(formData.get(key) ?? "").trim()]);

    return Object.fromEntries([...entries, ["trialAcknowledged", "yes"]]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <form
      className="form-card auth-form-card auth-create-form"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="auth-stepper" aria-label="Create account progress">
        {steps.map((item, index) => (
          <button
            key={item.title}
            className={`auth-step ${index === step ? "active" : ""} ${
              index < step ? "complete" : ""
            }`}
            type="button"
            onClick={(event) => goToStep(index, event.currentTarget.form)}
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
      {formMessage ? <p className="form-alert compact">{formMessage}</p> : null}

      <section className="auth-form-section" hidden={step !== 0}>
        <div className="auth-form-grid">
          <label>
            Your first and last name
            <input
              name="name"
              type="text"
              autoComplete="name"
              required
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
              onChange={() => clearFieldError("name")}
            />
            {fieldErrors.name ? (
              <span className="auth-field-error" id="name-error">
                {fieldErrors.name}
              </span>
            ) : null}
          </label>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              onChange={() => clearFieldError("email")}
            />
            {fieldErrors.email ? (
              <span className="auth-field-error" id="email-error">
                {fieldErrors.email}
              </span>
            ) : null}
          </label>
          <label>
            Confirm email
            <input
              name="confirmEmail"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(fieldErrors.confirmEmail)}
              aria-describedby={
                fieldErrors.confirmEmail ? "confirmEmail-error" : undefined
              }
              onChange={() => clearFieldError("confirmEmail")}
            />
            {fieldErrors.confirmEmail ? (
              <span className="auth-field-error" id="confirmEmail-error">
                {fieldErrors.confirmEmail}
              </span>
            ) : null}
          </label>
          <PasswordField
            autoComplete="new-password"
            error={fieldErrors.password}
            minLength={8}
            onValueChange={() => clearFieldError("password")}
          />
          <PasswordField
            autoComplete="new-password"
            error={fieldErrors.confirmPassword}
            label="Confirm password"
            minLength={8}
            name="confirmPassword"
            onValueChange={() => clearFieldError("confirmPassword")}
          />
          <div className="auth-phone-field">
            <span className="auth-field-label">Mobile number</span>
            <div className="auth-phone-row">
              <label className="auth-phone-country">
                <span className="sr-only">Phone country</span>
                <select
                  name="mobileCountry"
                  required
                  defaultValue="Australia"
                  aria-invalid={Boolean(fieldErrors.mobileCountry)}
                  aria-describedby={
                    fieldErrors.mobileCountry ? "mobileCountry-error" : undefined
                  }
                  onChange={() => clearFieldError("mobileCountry")}
                >
                  {PHONE_COUNTRY_OPTIONS.map((option) => (
                    <option key={option.country} value={option.country}>
                      {option.label} {option.dialCode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="auth-phone-number">
                <span className="sr-only">Mobile number</span>
                <input
                  name="mobileNumber"
                  type="tel"
                  autoComplete="tel"
                  required
                  aria-invalid={Boolean(fieldErrors.mobileNumber)}
                  aria-describedby={
                    fieldErrors.mobileNumber ? "mobileNumber-error" : undefined
                  }
                  onChange={() => clearFieldError("mobileNumber")}
                />
              </label>
            </div>
            {fieldErrors.mobileCountry ? (
              <span className="auth-field-error" id="mobileCountry-error">
                {fieldErrors.mobileCountry}
              </span>
            ) : null}
            {fieldErrors.mobileNumber ? (
              <span className="auth-field-error" id="mobileNumber-error">
                {fieldErrors.mobileNumber}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="auth-form-section" hidden={step !== 1}>
        <div className="auth-form-grid">
          <label>
            Business name
            <input
              name="businessName"
              type="text"
              autoComplete="organization"
              required
              aria-invalid={Boolean(fieldErrors.businessName)}
              aria-describedby={
                fieldErrors.businessName ? "businessName-error" : undefined
              }
              onChange={() => clearFieldError("businessName")}
            />
            {fieldErrors.businessName ? (
              <span className="auth-field-error" id="businessName-error">
                {fieldErrors.businessName}
              </span>
            ) : null}
          </label>
          <label>
            <span className="auth-label-line">
              Trade / industry
              <FieldHelp text="Use the plain trade or service category customers would recognise, such as plumbing, electrical, landscaping, cleaning, or contracting." />
            </span>
            <input
              name="industry"
              type="text"
              placeholder="Plumbing, electrical, landscaping..."
              required
              aria-invalid={Boolean(fieldErrors.industry)}
              aria-describedby={fieldErrors.industry ? "industry-error" : undefined}
              onChange={() => clearFieldError("industry")}
            />
            {fieldErrors.industry ? (
              <span className="auth-field-error" id="industry-error">
                {fieldErrors.industry}
              </span>
            ) : null}
          </label>
          <label>
            Operating country
            <select
              name="country"
              required
              defaultValue=""
              aria-invalid={Boolean(fieldErrors.country)}
              aria-describedby={fieldErrors.country ? "country-error" : undefined}
              onChange={() => clearFieldError("country")}
            >
              <option value="" disabled>
                Select operating country
              </option>
              {OPERATING_COUNTRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {fieldErrors.country ? (
              <span className="auth-field-error" id="country-error">
                {fieldErrors.country}
              </span>
            ) : null}
          </label>
          <label>
            <span className="auth-label-line">
              Location
              <FieldHelp text="Enter the main suburb, city, or region the business operates from. Kyro uses this to understand local context and nearby work." />
            </span>
            <input
              name="businessLocation"
              type="text"
              placeholder="Suburb, city, or operating region"
              required
              aria-invalid={Boolean(fieldErrors.businessLocation)}
              aria-describedby={
                fieldErrors.businessLocation
                  ? "businessLocation-error"
                  : undefined
              }
              onChange={() => clearFieldError("businessLocation")}
            />
            {fieldErrors.businessLocation ? (
              <span className="auth-field-error" id="businessLocation-error">
                {fieldErrors.businessLocation}
              </span>
            ) : null}
          </label>
          <label>
            Postcode / ZIP
            <input
              name="postcode"
              type="text"
              autoComplete="postal-code"
              required
              aria-invalid={Boolean(fieldErrors.postcode)}
              aria-describedby={fieldErrors.postcode ? "postcode-error" : undefined}
              onChange={() => clearFieldError("postcode")}
            />
            {fieldErrors.postcode ? (
              <span className="auth-field-error" id="postcode-error">
                {fieldErrors.postcode}
              </span>
            ) : null}
          </label>
          <label>
            <span className="auth-label-line">
              Service area
              <FieldHelp text="Optional. Add the suburbs, regions, postcodes, or travel radius you normally service so Kyro can understand which enquiries are practical." />
            </span>
            <input
              name="serviceArea"
              type="text"
              placeholder="Optional: Brisbane southside, Metro Phoenix..."
            />
          </label>
        </div>
        {isSubmitting ? (
          <div className="auth-payment-loading" role="status" aria-live="polite">
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : null}
      </section>

      <section className="auth-form-section" hidden={step !== 2}>
        {billingSetup && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              appearance: {
                theme: "night",
                variables: {
                  borderRadius: "8px",
                  colorDanger: "#ff5aa8",
                  colorPrimary: "#57dffc",
                  colorText: "#f8fbff",
                },
              },
              clientSecret: billingSetup.clientSecret,
            }}
          >
            <InlineCardSetup setup={billingSetup} onError={setFormError} />
          </Elements>
        ) : step === 2 ? (
          <div
            className="auth-payment-placeholder auth-payment-placeholder-bare"
            role="status"
            aria-live="polite"
          >
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : null}
      </section>

      <div className="auth-step-actions">
        {step > 0 ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
          >
            Back
          </button>
        ) : (
          <span />
        )}

        {step < steps.length - 1 ? (
          <button
            className="primary-button"
            disabled={isSubmitting}
            type="button"
            onClick={goToNextStep}
          >
            {isSubmitting
              ? "Loading card form..."
              : step === 1
                ? "Continue to card setup"
                : "Continue"}
          </button>
        ) : (
          <span />
        )}
      </div>
    </form>
  );
}
