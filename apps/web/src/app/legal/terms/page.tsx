import { MarketingPageShell } from "../../components/marketing-shell";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | Kyro",
  description:
    "Terms of service for Kyro, an AI assistant for sole traders and small service businesses.",
};

const updatedAt = "May 31, 2026";

export default function TermsPage() {
  return (
    <MarketingPageShell
      copy={`Last updated ${updatedAt}. These terms explain the basic rules for using Kyro.`}
      eyebrow="Legal"
      title="Terms of Service"
    >
      <section className="marketing-section marketing-legal-copy">
        <h2>Using Kyro</h2>
        <p>
          Kyro provides AI assistant software for sole traders and small service
          businesses. By using Kyro, you agree to use the service lawfully,
          provide accurate account information, keep your login details secure,
          and remain responsible for activity in your workspace.
        </p>

        <h2>AI Assistant Actions</h2>
        <p>
          Kyro can help draft emails, SMS, quote documents, tasks, summaries,
          follow-ups, and call workflows. You are responsible for reviewing
          assistant outputs and approving any business action before it is sent
          or relied on, unless you have configured Kyro to take that action
          automatically.
        </p>
        <p>
          AI-generated content may be incomplete, incorrect, or unsuitable for a
          specific job. You should check important customer communications,
          prices, quote terms, legal statements, and business decisions.
        </p>

        <h2>Customer Communications</h2>
        <p>
          You are responsible for making sure any emails, SMS, calls, quotes,
          invoices, and customer messages sent through Kyro comply with the laws
          and permissions that apply to your business.
        </p>

        <h2>Billing And Trials</h2>
        <p>
          Kyro may offer a two-week trial. After the trial, Kyro may charge
          based on metered usage, including AI, voice, SMS, document, storage,
          and other service usage. Billing details, rates, and payment timing
          may be shown in the product or invoice records.
        </p>

        <h2>Acceptable Use</h2>
        <p>
          You must not use Kyro for unlawful, abusive, deceptive, harmful, or
          spam-like activity. You must not attempt to bypass security controls,
          access another workspace, misuse integrations, or use Kyro to send
          communications that you are not authorised to send.
        </p>

        <h2>Data And Content</h2>
        <p>
          You retain responsibility for the business data and customer content
          you add to Kyro. Kyro may process that content to provide the service,
          operate the AI assistant, generate outputs, maintain audit logs,
          provide support, and calculate usage.
        </p>

        <h2>Availability</h2>
        <p>
          Kyro is provided on an as-available basis. We aim to provide a useful
          and reliable service, but we do not guarantee uninterrupted operation,
          error-free AI output, or compatibility with every provider or
          integration.
        </p>

        <h2>Changes And Termination</h2>
        <p>
          We may update Kyro or these terms as the product evolves. We may
          suspend or terminate access if a workspace creates risk, violates
          these terms, fails to pay, or uses the service in a way that could
          harm Kyro, customers, providers, or other users.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms can be sent through the{" "}
          <Link href="/contact">contact page</Link>.
        </p>
      </section>
    </MarketingPageShell>
  );
}
