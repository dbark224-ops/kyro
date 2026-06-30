import { BrandMark } from "../components/brand-mark";
import { CreateAccountForm } from "../sign-in/auth-forms";
import { hasSupabaseEnv } from "../../lib/env";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type CreateAccountPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function CreateAccountPage({
  searchParams,
}: CreateAccountPageProps) {
  const params = await searchParams;

  if (!hasSupabaseEnv()) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="brand-lockup">
            <BrandMark />
          </div>
          <h1>Supabase env vars are missing.</h1>
          <p className="form-copy">
            Add the values from `.env.example`, then restart the dev server.
          </p>
          <Link className="secondary-button link-button" href="/">
            Back
          </Link>
        </section>
      </main>
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel wide auth-create-panel">
        <div className="auth-create-header">
          <BrandMark />
          <h1>Create your account</h1>
        </div>

        {params?.error ? (
          <p className="form-alert error">{params.error}</p>
        ) : null}
        {params?.message ? (
          <p className="form-alert">{params.message}</p>
        ) : null}

        <CreateAccountForm />

        <p className="auth-link-row">
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
