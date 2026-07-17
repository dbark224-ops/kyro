import { MarketingPageShell } from "../../components/marketing-shell";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Kyro",
  description:
    "Privacy policy for Kyro, an AI assistant for sole traders and small service businesses.",
};

const updatedAt = "July 16, 2026";

export default function PrivacyPage() {
  return (
    <MarketingPageShell
      copy={`Last updated ${updatedAt}. This policy explains how Kyro handles account, business, customer, usage, voice, file, integration, and mobile app data.`}
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
          Kyro may collect account information such as name, email address,
          sign-in details, verification status, workspace membership, support
          requests, and account preferences.
        </p>
        <p>
          Kyro may collect workspace and business information, including
          business name, industry, service area, operating hours, public contact
          details, brand settings, assistant instructions, pronunciation
          preferences, and other settings used to run your assistant.
        </p>
        <p>
          Kyro may process customer and job information that you add or connect,
          including customer names, phone numbers, email addresses, addresses,
          enquiry details, job notes, messages, quote drafts, documents,
          payment request details, uploaded files, photos, and customer history.
        </p>
        <p>
          Kyro may process voice, call, email, SMS, and assistant interaction
          data, including call metadata, transcripts, recordings where enabled,
          message content, AI prompts, assistant instructions, generated drafts,
          summaries, tool actions, audit events, and usage records.
        </p>
        <p>
          The mobile app may request access to device permissions only when a
          feature needs them, such as microphone access for voice assistant
          calls, contacts access when you choose to import selected contacts,
          camera or photo library access when you attach images, document
          picker access when you attach files, and Face ID or device biometric
          unlock for local app locking. Kyro does not receive or store your
          biometric identifiers.
        </p>
        <p>
          Kyro may collect technical, analytics, billing, and security data,
          including device and browser information, app activity, API logs,
          error logs, IP address, usage events, payment provider metadata,
          invoice records, and data needed to prevent abuse and keep the
          service reliable.
        </p>

        <h2>How We Use Information</h2>
        <p>
          We use information to provide the Kyro service, operate the AI
          assistant, manage customer enquiries, prepare emails, SMS, calls,
          quotes, tasks, and follow-ups, maintain customer history, provide
          support, improve reliability, prevent abuse, and calculate usage-based
          billing.
        </p>
        <p>
          We may also use information to verify accounts, troubleshoot issues,
          improve product quality, maintain security logs, satisfy legal and
          accounting obligations, and communicate with you about the service.
        </p>

        <h2>AI Providers And Service Providers</h2>
        <p>
          Kyro may share data with service providers that help run the product,
          including hosting, database, authentication, storage, analytics,
          payments, communications, voice, email, SMS, and AI model providers.
          These providers process data so Kyro can deliver the service.
        </p>
        <p>
          Depending on the features you enable, this may include providers for
          Supabase authentication and database services, Vercel hosting, Stripe
          payments, Google or Microsoft email/calendar integrations, Twilio SMS
          or phone infrastructure, Vapi or voice infrastructure, Resend email,
          and AI model providers. We do not sell personal information.
        </p>

        <h2>Connected Accounts And Customer Data</h2>
        <p>
          If you connect third-party accounts, Kyro uses the connection to
          provide the feature you enabled, such as reading relevant emails,
          syncing messages, generating replies, preparing customer follow-ups,
          or creating payment and document workflows. You are responsible for
          making sure you have permission to add customer information to Kyro.
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
          customers. Users may request deletion of account or workspace data on
          the <Link href="/account/delete">account deletion page</Link>, subject
          to legal, security, and billing retention requirements.
        </p>

        <h2>Your Choices</h2>
        <p>
          You can request access, correction, export, or deletion of your data
          through the <Link href="/contact">contact page</Link> or the{" "}
          <Link href="/account/delete">account deletion page</Link>. Some data
          may need to be retained where required for security, accounting, legal
          compliance, or legitimate business records.
        </p>

        <h2>Children</h2>
        <p>
          Kyro is intended for business use and is not directed to children.
          Users must not submit information about children unless it is lawful
          and necessary for their business use of Kyro.
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
