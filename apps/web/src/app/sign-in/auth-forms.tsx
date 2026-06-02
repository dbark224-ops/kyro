"use client";

import { useEffect, useState, type FormEvent } from "react";

const REMEMBERED_EMAIL_KEY = "kyro.rememberedEmail";

type ServerAction = (formData: FormData) => void | Promise<void>;

type PasswordFieldProps = {
  autoComplete: string;
  minLength?: number;
  name?: string;
};

function PasswordField({
  autoComplete,
  minLength,
  name = "password",
}: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <label>
      Password
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
    const rememberedEmail = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);

    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberEmail(true);
    }
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
  return (
    <form className="form-card auth-form-card" action={action}>
      <input name="failurePath" type="hidden" value="/create-account" />
      <label>
        Name
        <input name="name" type="text" autoComplete="name" />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <PasswordField autoComplete="new-password" minLength={8} />
      <button className="primary-button" type="submit">
        Create account
      </button>
    </form>
  );
}
