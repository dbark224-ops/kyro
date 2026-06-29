import { MarketingPageShell } from "../components/marketing-shell";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Product | Kyro",
  description:
    "Explore Kyro's AI agent workflow for inbox, voice, SMS, contacts, quotes, documents, customer history, and usage visibility.",
};

const productSections = [
  {
    items: [
      "Triage inbound email, SMS, forms, and overflow call events for a busy service business",
      "Separate real customer work from newsletters, receipts, spam, and personal mail",
      "Turn the right enquiries into replies, tasks, quote drafts, calls, or follow-ups",
    ],
    title: "Agent inbox",
  },
  {
    items: [
      "Ask Kyro to email a customer, prepare a call, chase a reply, or update a job",
      "Use deterministic app cards instead of free-form model-made UI",
      "Keep customer memories, thread summaries, and workspace knowledge available over time",
    ],
    title: "Action-taking assistant",
  },
  {
    items: [
      "Create quote drafts from job context and reusable templates",
      "Render customer PDFs, approval links, invoices, revisions, and send-ready documents",
      "Store generated files privately and connect approved output to cloud drives later",
    ],
    title: "Quotes and documents",
  },
  {
    items: [
      "Make or prepare follow-up calls, outbound messages, delivery attempts, and provider status",
      "Send or prepare SMS and email replies with approval rules for the workspace",
      "Keep usage and audit trails attached to assistant-prepared business actions",
    ],
    title: "Voice, SMS, email",
  },
];

export default function ProductPage() {
  return (
    <MarketingPageShell
      copy="Kyro gives a sole trader an AI agent that reads inbound work, remembers customer context, emails customers, prepares calls, drafts quotes, and keeps everything in one simple place."
      eyebrow="Product"
      title="An AI personal assistant that can take action."
    >
      <section className="marketing-section">
        <div className="marketing-feature-grid two-column">
          {productSections.map((section) => (
            <article className="marketing-feature-card" key={section.title}>
              <h2>{section.title}</h2>
              <ul className="marketing-check-list">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-final-cta compact">
        <p className="marketing-eyebrow">Early access</p>
        <h2>Join the waitlist before self-serve onboarding opens.</h2>
        <Link className="marketing-button" href="/waitlist">
          Join waitlist
        </Link>
      </section>
    </MarketingPageShell>
  );
}
