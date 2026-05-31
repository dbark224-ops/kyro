import { MarketingPageShell } from "../../components/marketing-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy | Kyro",
  description: "Draft Kyro privacy page for legal review.",
};

export default function PrivacyPage() {
  return (
    <MarketingPageShell
      copy="This page is a scaffold for the production privacy policy. It should be reviewed by counsel before public launch."
      eyebrow="Legal"
      title="Privacy Policy"
    >
      <section className="marketing-section marketing-legal-copy">
        <h2>Draft posture</h2>
        <p>
          Kyro is designed to store workspace business data, customer
          communications, contact records, generated documents, uploaded files,
          AI interaction history, usage events, and integration metadata needed
          to operate the service.
        </p>
        <p>
          Production policy language should cover data collection, processing,
          subprocessors, AI-provider usage, retention, deletion, user rights,
          international transfers, security controls, and contact details.
        </p>
      </section>
    </MarketingPageShell>
  );
}
