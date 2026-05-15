import { BrandMark } from "../components/brand-mark";
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
            <div>
              <p className="brand-name">Kyro</p>
              <p className="brand-subtitle">Workspace ready</p>
            </div>
          </div>
          <h1>{workspace.name}</h1>
          <p className="form-copy">This account already has a bootstrapped workspace.</p>
          <Link className="primary-button link-button" href="/">
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
          <div>
            <p className="brand-name">Kyro</p>
            <p className="brand-subtitle">Workspace bootstrap</p>
          </div>
        </div>

        <div className="auth-copy">
          <p className="eyebrow">First tenant</p>
          <h1>Create your business workspace.</h1>
          <p className="form-copy">
            Kyro will seed the business profile, owner membership, outbound policies, entitlements,
            usage budget, and pricing rules.
          </p>
        </div>

        {params?.error ? <p className="form-alert error">{params.error}</p> : null}

        <form className="form-card single" action={bootstrapWorkspaceAction}>
          <label>
            Business name
            <input name="businessName" type="text" autoComplete="organization" required />
          </label>
          <label>
            Industry
            <input name="industry" type="text" placeholder="Plumbing, tiling, landscaping..." />
          </label>
          <label>
            Service area
            <input name="serviceArea" type="text" placeholder="City, region, or remote" />
          </label>
          <button className="primary-button" type="submit">
            Bootstrap workspace
          </button>
        </form>
      </section>
    </main>
  );
}
