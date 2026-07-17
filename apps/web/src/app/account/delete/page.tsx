import { MarketingPageShell } from "../../components/marketing-shell";
import type { Metadata } from "next";
import Link from "next/link";
import { AccountDeletionForm } from "./account-deletion-form";

export const metadata: Metadata = {
  title: "Delete Account | Kyro",
  description:
    "Request deletion of a Kyro account and workspace data from the web.",
};

export default function AccountDeletionPage() {
  return (
    <MarketingPageShell
      copy="Use this page to start deletion of your Kyro account and workspace data. If you opened this from the mobile app, use the same email address you use to sign in."
      eyebrow="Account"
      title="Delete your Kyro account"
    >
      <section className="marketing-section account-deletion-grid">
        <div className="account-deletion-card">
          <h2>What this request covers</h2>
          <ul className="marketing-inline-list">
            <li>Your Kyro account access and workspace membership.</li>
            <li>Workspace business profile, settings, assistant memory, and CRM records.</li>
            <li>Customer communications, uploaded files, documents, call data, and usage records where deletion is legally and operationally possible.</li>
          </ul>
        </div>

        <div className="account-deletion-card">
          <h2>What may be retained</h2>
          <p>
            Kyro may retain limited records where required for security,
            fraud prevention, legal compliance, tax, billing, dispute handling,
            or audit obligations. Data that can be removed from active product
            systems will be deleted or anonymised after verification.
          </p>
          <p>
            For general privacy questions, read the{" "}
            <Link href="/legal/privacy">Privacy Policy</Link> or use the{" "}
            <Link href="/contact">contact page</Link>.
          </p>
        </div>

        <AccountDeletionForm />
      </section>
    </MarketingPageShell>
  );
}
