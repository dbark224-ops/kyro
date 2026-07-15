import Link from "next/link";
import { redirect } from "next/navigation";
import { updateRecoveredPasswordAction } from "../auth/actions";
import { BrandMark } from "../components/brand-mark";
import { createServerSupabaseClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/forgot-password?error=That%20reset%20link%20has%20expired.%20Request%20a%20new%20one.",
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel auth-centered">
        <div className="brand-lockup centered">
          <BrandMark />
        </div>
        <div className="auth-copy centered">
          <h1>Choose a new password.</h1>
        </div>
        {params?.error ? (
          <p className="form-alert error">{params.error}</p>
        ) : null}
        <form
          action={updateRecoveredPasswordAction}
          className="form-card auth-form-card"
        >
          <label>
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm password
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <button className="primary-button" type="submit">
            Update password
          </button>
        </form>
        <p className="auth-link-row">
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
