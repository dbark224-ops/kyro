import { BrandMark } from "../components/brand-mark";
import { signInAction, signUpAction } from "../auth/actions";
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
            <div>
              <p className="brand-name">Kyro</p>
              <p className="brand-subtitle">Setup required</p>
            </div>
          </div>
          <h1>Supabase env vars are missing.</h1>
          <p className="form-copy">Add the values from `.env.example`, then restart the dev server.</p>
          <Link className="secondary-button link-button" href="/">
            Back
          </Link>
        </section>
      </main>
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel wide">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <p className="brand-name">Kyro</p>
            <p className="brand-subtitle">Account access</p>
          </div>
        </div>

        <div className="auth-copy">
          <p className="eyebrow">Web-first billing, native-ready backend</p>
          <h1>Sign in to your Kyro workspace.</h1>
        </div>

        {params?.error ? <p className="form-alert error">{params.error}</p> : null}
        {params?.message ? <p className="form-alert">{params.message}</p> : null}

        <div className="auth-grid">
          <form className="form-card" action={signInAction}>
            <h2>Sign in</h2>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="primary-button" type="submit">
              Sign in
            </button>
          </form>

          <form className="form-card" action={signUpAction}>
            <h2>Create account</h2>
            <label>
              Name
              <input name="name" type="text" autoComplete="name" />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="new-password" required minLength={8} />
            </label>
            <button className="secondary-button" type="submit">
              Create account
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
