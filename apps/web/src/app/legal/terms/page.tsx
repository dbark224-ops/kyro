import { MarketingPageShell } from "../../components/marketing-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms | Kyro",
  description: "Draft Kyro terms page for legal review.",
};

export default function TermsPage() {
  return (
    <MarketingPageShell
      copy="This page is a scaffold for the production terms of service. It should be reviewed by counsel before public launch."
      eyebrow="Legal"
      title="Terms of Service"
    >
      <section className="marketing-section marketing-legal-copy">
        <h2>Draft posture</h2>
        <p>
          Kyro should define account responsibilities, acceptable use,
          workspace administration, payment and usage obligations, AI-generated
          output handling, communications compliance, data ownership,
          availability limits, termination, and dispute terms.
        </p>
        <p>
          Production terms should also distinguish between Kyro assistant
          suggestions and user-approved business actions, especially for
          customer communications, quotes, SMS, calls, and document output.
        </p>
      </section>
    </MarketingPageShell>
  );
}
