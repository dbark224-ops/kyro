import { MarketingFooter, MarketingHeader } from "./components/marketing-shell";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Kyro | AI agent for service businesses",
  description:
    "Kyro is an AI agent and personal business assistant for sole traders and small service teams that need enquiries, replies, quotes, follow-up, voice, SMS, and customer history in one place.",
};

const heroFlow = [
  "Catch the enquiry",
  "Understand the job",
  "Reply or call for you",
  "Chase the next step",
];

const operatingLoop = [
  {
    copy: "Emails, forms, SMS, and missed-call events land in one assistant-led queue.",
    label: "Catch",
  },
  {
    copy: "Kyro reads the customer, job, urgency, missing details, and next best step.",
    label: "Understand",
  },
  {
    copy: "Kyro can send emails, prepare SMS, draft quotes, create tasks, and place follow-up calls.",
    label: "Act",
  },
  {
    copy: "Sensitive actions stay approval-gated, and every message, call, quote, and AI run stays logged.",
    label: "Prove",
  },
];

const featureCards = [
  {
    copy: "Kyro sorts enquiries by urgency, missing info, ready-to-quote, and follow-up due, then moves the right work forward.",
    signal: "Agent inbox",
    title: "A queue that acts",
  },
  {
    copy: "Ask Kyro to email a customer, prepare a reply, chase a quote, update a job, or explain what needs doing.",
    signal: "Personal assistant",
    title: "Ask it to do the admin",
  },
  {
    copy: "Turn job context into quote drafts, PDFs, approval links, invoices, revisions, and files ready to send.",
    signal: "Quote helper",
    title: "Paperwork without app-hopping",
  },
  {
    copy: "Email, SMS, phone events, voice notes, and outbound calls feed the same assistant memory.",
    signal: "Channels",
    title: "One agent across calls and comms",
  },
  {
    copy: "Contacts, leads, tasks, appointments, notes, addresses, job history, and follow-up outcomes stay connected.",
    signal: "Business memory",
    title: "The assistant remembers",
  },
  {
    copy: "Sent emails, phone calls, quote drafts, approvals, model routing, and usage events stay visible.",
    signal: "Control",
    title: "Agent actions stay accountable",
  },
];

const audienceRows = [
  "Sole traders",
  "Trades",
  "Home services",
  "Photographers",
  "Consultants",
  "Small service teams",
];

const statementTiles = [
  { copy: "Answers enquiries.", label: "Email" },
  { copy: "Makes follow-up calls.", label: "Phone" },
  { copy: "Drafts and sends quotes.", label: "Quote" },
  { copy: "Chases next steps.", label: "Follow up" },
];

export default function MarketingHomePage() {
  return (
    <main className="marketing-page">
      <section className="marketing-hero">
        <div className="marketing-hero-visual" aria-hidden="true">
          <div className="marketing-hero-field" />
          <div className="marketing-hero-matrix" />
          <div className="marketing-aurora marketing-aurora-one" />
          <div className="marketing-aurora marketing-aurora-two" />
          <div className="marketing-aurora marketing-aurora-three" />
          <div className="marketing-hero-core" />
        </div>
        <div className="marketing-hero-scrim" />
        <MarketingHeader variant="hero" />

        <div className="marketing-hero-copy">
          <div className="marketing-hero-kicker">
            <span>AI agent for sole traders & service teams</span>
          </div>
          <h1>Kyro</h1>
          <p>
            Your always-on personal assistant for enquiries, emails, phone
            calls, quotes, customer memory, and next steps.
          </p>
          <div className="marketing-cta-row">
            <Link className="marketing-button" href="/sign-in">
              Start two-week trial
            </Link>
            <Link className="marketing-button secondary" href="/product">
              See product
            </Link>
          </div>
          <div className="marketing-hero-flow" aria-label="Kyro work flow">
            {heroFlow.map((step, index) => (
              <span key={step}>
                <strong>{String(index + 1).padStart(2, "0")}</strong>
                {step}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-statement">
        <div className="marketing-statement-copy">
          <h2>A personal assistant that lives in your phone and inbox.</h2>
          <p>
            Kyro does the customer admin: it can email, prepare SMS, draft
            quotes, create tasks, make follow-up calls, and ask before risky
            actions go out.
          </p>
        </div>
        <div className="marketing-statement-tiles">
          {statementTiles.map((tile) => (
            <article key={tile.label}>
              <span>{tile.label}</span>
              <strong>{tile.copy}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">Operating loop</p>
          <h2>From missed enquiry to action taken.</h2>
        </div>
        <div className="marketing-loop-grid">
          {operatingLoop.map((item) => (
            <article className="marketing-loop-card" key={item.label}>
              <span>{item.label}</span>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">Product surface</p>
          <h2>One AI assistant that can actually do the admin.</h2>
        </div>
        <div className="marketing-feature-grid">
          {featureCards.map((feature) => (
            <article className="marketing-feature-card" key={feature.title}>
              <span>{feature.signal}</span>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section marketing-split-band">
        <div>
          <p className="marketing-eyebrow">Built for the field</p>
          <h2>Made for operators who cannot sit inside software all day.</h2>
        </div>
        <div className="marketing-audience-list">
          {audienceRows.map((row) => (
            <p key={row}>{row}</p>
          ))}
        </div>
      </section>

      <section className="marketing-section marketing-proof-strip">
        <span>Approval-gated agent actions</span>
        <span>Customer memory</span>
        <span>Sends email and SMS</span>
        <span>Makes phone calls</span>
        <span>Quote drafting and sending</span>
        <span>Usage ledger</span>
      </section>

      <section className="marketing-final-cta">
        <p className="marketing-eyebrow">AI assistant workspace</p>
        <h2>Give every enquiry somewhere intelligent to land.</h2>
        <Link className="marketing-button" href="/sign-in">
          Start two-week trial
        </Link>
      </section>

      <MarketingFooter />
    </main>
  );
}
