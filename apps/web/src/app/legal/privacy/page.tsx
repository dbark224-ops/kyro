import { MarketingPageShell } from "../../components/marketing-shell";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Kyro",
  description:
    "Privacy policy for Kyro, an AI assistant for sole traders and small service businesses.",
};

const updatedAt = "May 31, 2026";

export default function PrivacyPage() {
  return (
    <MarketingPageShell
      copy={`Last updated ${updatedAt}. This policy explains how Kyro handles business, customer, usage, and app data.`}
      eyebrow="Legal"
      title="Privacy Policy"
    >
      <section className="marketing-section marketing-legal-copy">
        <h2>Who This Policy Covers</h2>
        <p>
          This Privacy Policy applies to Kyro, available at kyroassistant.com,
          and to Kyro web and mobile apps. Kyro provides AI assistant software
          for sole traders and small service businesses.
        </p>
        <p>
          For privacy questions, contact us through the{" "}
          <Link href="/contact">contact page</Link>.
        </p>

        <h2>Information We Collect</h2>
        <p>
          Kyro may collect account information, workspace and business details,
          customer contact details, job notes, addresses, enquiries, messages,
          call records, quote and document data, uploaded files, app activity,
          device and log data, usage events, billing records, and integration
          metadata.
        </p>
        <p>
          Kyro also processes AI interaction data, including prompts,
          instructions, generated drafts, summaries, model routing decisions,
          and usage required to operate the assistant.
        </p>

        <h2>How We Use Information</h2>
        <p>
          We use information to provide the Kyro service, operate the AI
          assistant, manage customer enquiries, prepare emails, SMS, calls,
          quotes, tasks, and follow-ups, maintain customer history, provide
          support, improve reliability, prevent abuse, and calculate usage-based
          billing.
        </p>

        <h2>AI Providers And Service Providers</h2>
        <p>
          Kyro may share data with service providers that help run the product,
          including hosting, database, authentication, storage, analytics,
          payments, communications, voice, email, SMS, and AI model providers.
          These providers process data so Kyro can deliver the service.
        </p>

        <h2>Data Security</h2>
        <p>
          Kyro is designed with workspace-scoped access, server-side
          permissions, private file storage, audit logs, and approval gates for
          sensitive assistant actions. No online service can guarantee absolute
          security, but we use reasonable technical and organisational measures
          to protect data.
        </p>

        <h2>Retention And Deletion</h2>
        <p>
          We keep data while it is needed to operate Kyro, meet legal or billing
          obligations, resolve disputes, maintain audit records, and support
          customers. Users may request deletion of account or workspace data
          through the contact page, subject to legal, security, and billing
          retention requirements.
        </p>

        <h2>Your Choices</h2>
        <p>
          You can request access, correction, export, or deletion of your data
          by contacting Kyro. Some data may need to be retained where required
          for security, accounting, legal compliance, or legitimate business
          records.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this Privacy Policy as Kyro changes. The latest version
          will be posted on this page with the updated date above.
        </p>
      </section>
    </MarketingPageShell>
  );
}
