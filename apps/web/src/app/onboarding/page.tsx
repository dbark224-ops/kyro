import { BrandMark } from "../components/brand-mark";
import { OnboardingBusinessBasicsFields } from "./business-basics-fields";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import { getPrimaryWorkspace } from "../../lib/workspace/bootstrap";
import { bootstrapWorkspaceAction } from "./actions";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const workspace = await getPrimaryWorkspace(supabase);

  if (workspace) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="brand-lockup">
            <BrandMark />
          </div>
          <h1>{workspace.name}</h1>
          <p className="form-copy">This account already has a bootstrapped workspace.</p>
          <Link className="primary-button link-button" href="/dashboard">
            Open dashboard
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-lockup">
          <BrandMark />
        </div>

        <div className="auth-copy">
          <p className="eyebrow">Workspace setup</p>
          <h1>Create your business workspace.</h1>
          <p className="form-copy">
            Add the core business details Kyro needs to prepare your CRM,
            assistant context, documents, and billing defaults. After this,
            Stripe will securely save a card for your two-week free trial.
          </p>
        </div>

        {params?.error ? <p className="form-alert error">{params.error}</p> : null}

        <form className="form-card auth-form-card auth-create-form single" action={bootstrapWorkspaceAction}>
          <OnboardingBusinessBasicsFields />
          <button className="primary-button" type="submit">
            Continue to card setup
          </button>
        </form>
      </section>
    </main>
  );
}
