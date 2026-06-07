import { MarketingPageShell } from "../components/marketing-shell";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing | Kyro",
  description:
    "Kyro pricing is metered usage with a two-week free trial and typical early users expected around $100 - $150 per month AUD.",
};

const pricingCards = [
  {
    description:
      "Use Kyro with real enquiries, replies, quote drafts, and customer memory before paying.",
    name: "Trial",
    price: "Two weeks free",
  },
  {
    description:
      "After the trial, billing follows actual AI, SMS, voice, document, and storage usage.",
    name: "Usage",
    price: "Metered usage",
  },
  {
    description:
      "Most solo operators and small service businesses should expect around this monthly range.",
    name: "Typical monthly cost",
    price: (
      <>
        <span className="marketing-price-range">$100 - $150</span>
        <span className="marketing-price-term">per month AUD</span>
      </>
    ),
  },
];

export default function PricingPage() {
  return (
    <MarketingPageShell
      copy="Start with two weeks free. After that, Kyro is billed on metered usage, so light users are not forced into heavy fixed plans."
      eyebrow="Pricing"
      title="No plans. Just usage."
    >
      <section className="marketing-section">
        <div className="marketing-pricing-grid">
          {pricingCards.map((card) => (
            <article className="marketing-price-card" key={card.name}>
              <p className="marketing-eyebrow">{card.name}</p>
              <h2>{card.price}</h2>
              <p>{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section marketing-split-band">
        <div>
          <p className="marketing-eyebrow">Billing posture</p>
          <h2>Your assistant&apos;s usage should be visible before it becomes an invoice.</h2>
        </div>
        <p>
          Kyro treats provider cost, customer-facing charge, model routing, and
          usage events as first-class records, so the business owner can see
          what the assistant is doing and what it costs.
        </p>
      </section>

      <section className="marketing-final-cta compact">
        <p className="marketing-eyebrow">Two-week trial</p>
        <h2>Try the assistant with real customer work before the meter starts.</h2>
        <Link className="marketing-button" href="/sign-in">
          Start two-week trial
        </Link>
      </section>
    </MarketingPageShell>
  );
}
