import { BrandMark } from "../components/brand-mark";
import { signInAction } from "../auth/actions";
import { SignInForm } from "./auth-forms";
import { hasSupabaseEnv } from "../../lib/env";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
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
      <section className="auth-panel auth-centered">
        <div className="brand-lockup centered">
          <BrandMark />
        </div>

        <div className="auth-copy centered">
          <h1>Sign in to your Kyro workspace.</h1>
        </div>

        {params?.error ? (
          <p className="form-alert error">{params.error}</p>
        ) : null}
        {params?.message ? (
          <p className="form-alert">{params.message}</p>
        ) : null}

        <SignInForm action={signInAction} />

        <p className="auth-link-row">
          New to Kyro? <Link href="/create-account">Create account</Link>
        </p>
      </section>
    </main>
  );
}
