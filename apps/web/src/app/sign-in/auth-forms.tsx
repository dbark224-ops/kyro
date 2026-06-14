"use client";

import { useEffect, useState, type FormEvent } from "react";
import { OPERATING_COUNTRY_OPTIONS } from "../../lib/workspace/operating-countries";

const REMEMBERED_EMAIL_KEY = "kyro.rememberedEmail";

type ServerAction = (formData: FormData) => void | Promise<void>;

type PasswordFieldProps = {
  autoComplete: string;
  label?: string;
  minLength?: number;
  name?: string;
};

function PasswordField({
  autoComplete,
  label = "Password",
  minLength,
  name = "password",
}: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

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

export function CreateAccountForm({ action }: { action: ServerAction }) {
  const [step, setStep] = useState(0);

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
      title: "Add card for free trial",
      copy: "Your first two weeks are free. Stripe will securely save your card so billing can start only after the trial.",
      fields: ["trialAcknowledged"],
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

  function validateCurrentStep(form: HTMLFormElement) {
    const password = fieldElement(form, "password");
    const confirmPassword = fieldElement(form, "confirmPassword");
    const email = fieldElement(form, "email");
    const confirmEmail = fieldElement(form, "confirmEmail");

    if (password && confirmPassword) {
      confirmPassword.setCustomValidity(
        password.value && confirmPassword.value && password.value !== confirmPassword.value
          ? "Passwords must match."
          : "",
      );
    }

    if (email && confirmEmail) {
      confirmEmail.setCustomValidity(
        email.value &&
          confirmEmail.value &&
          email.value.trim().toLowerCase() !==
            confirmEmail.value.trim().toLowerCase()
          ? "Email addresses must match."
          : "",
      );
    }

    for (const fieldName of steps[step].fields) {
      const field = fieldElement(form, fieldName);

      if (field && !field.reportValidity()) {
        return false;
      }
    }

    return true;
  }

  function goToNextStep(event: FormEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;

    if (!form || !validateCurrentStep(form)) {
      return;
    }

    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function goToStep(index: number, form: HTMLFormElement | null) {
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

    setStep(index);
  }

  return (
    <form className="form-card auth-form-card auth-create-form" action={action}>
      <input name="failurePath" type="hidden" value="/create-account" />

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
            <span>{item.title}</span>
          </button>
        ))}
      </div>

      <div className="auth-onboarding-heading">
        <p className="eyebrow">{steps[step].eyebrow}</p>
        <h2>{steps[step].title}</h2>
        <p>{steps[step].copy}</p>
      </div>

      <section className="auth-form-section" hidden={step !== 0}>
        <div className="auth-form-grid">
          <label>
            Your first and last name
            <input name="name" type="text" autoComplete="name" required />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Confirm email
            <input
              name="confirmEmail"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <PasswordField autoComplete="new-password" minLength={8} />
          <PasswordField
            autoComplete="new-password"
            label="Confirm password"
            minLength={8}
            name="confirmPassword"
          />
          <label className="auth-span-2">
            Mobile number
            <input name="mobileNumber" type="tel" autoComplete="tel" required />
          </label>
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
            />
          </label>
          <label>
            Trade / industry
            <input
              name="industry"
              type="text"
              placeholder="Plumbing, electrical, landscaping..."
              required
            />
          </label>
          <label>
            Operating country
            <select name="country" required defaultValue="">
              <option value="" disabled>
                Select operating country
              </option>
              {OPERATING_COUNTRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <input
              name="businessLocation"
              type="text"
              placeholder="Suburb, city, or operating region"
              required
            />
          </label>
          <label>
            Postcode / ZIP
            <input
              name="postcode"
              type="text"
              autoComplete="postal-code"
              required
            />
          </label>
          <label>
            Service area
            <input
              name="serviceArea"
              type="text"
              placeholder="Optional: Brisbane southside, Metro Phoenix..."
            />
          </label>
        </div>
      </section>

      <section className="auth-form-section" hidden={step !== 2}>
        <div className="auth-trial-grid">
          <div className="auth-trial-card">
            <p className="eyebrow">Two-week trial</p>
            <h3>Start without being billed today.</h3>
            <p>
              Kyro will meter usage during your first 14 days, but that trial
              usage will not be charged. Billing starts after the trial ends.
            </p>
          </div>
          <div className="auth-secure-payment-card">
            <p className="eyebrow">Payment method</p>
            <h3>Add a credit or debit card after this step.</h3>
            <p>
              Kyro will open a Stripe-hosted card setup screen. Kyro never
              stores raw card details.
            </p>
          </div>
        </div>

        <label className="auth-payment-check">
          <input name="trialAcknowledged" type="checkbox" required value="yes" />
          <span>
            I understand the first two weeks are free, and usage after the trial
            is billed to the saved payment method once billing is connected.
          </span>
        </label>
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
          <button className="primary-button" type="button" onClick={goToNextStep}>
            Continue
          </button>
        ) : (
          <button className="primary-button" type="submit">
            Continue to card setup
          </button>
        )}
      </div>
    </form>
  );
}
