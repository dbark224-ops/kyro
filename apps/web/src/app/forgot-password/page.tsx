import Link from "next/link";
import { requestPasswordResetAction } from "../auth/actions";
import { BrandMark } from "../components/brand-mark";

export const dynamic = "force-dynamic";

type ForgotPasswordPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;

  return (
    <main className="auth-shell">
      <section className="auth-panel auth-centered">
        <div className="brand-lockup centered">
          <BrandMark />
        </div>
        <div className="auth-copy centered">
          <h1>Reset your password.</h1>
          <p>Enter the email address attached to your Kyro account.</p>
        </div>
        {params?.error ? (
          <p className="form-alert error">{params.error}</p>
        ) : null}
        {params?.message ? (
          <p className="form-alert">{params.message}</p>
        ) : null}
        <form
          action={requestPasswordResetAction}
          className="form-card auth-form-card"
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <button className="primary-button" type="submit">
            Send reset link
          </button>
        </form>
        <p className="auth-link-row">
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
