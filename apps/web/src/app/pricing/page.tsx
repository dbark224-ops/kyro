import { MarketingPageShell } from "../components/marketing-shell";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing | Kyro",
  description:
    "Kyro pricing is metered usage with early access handled through the waitlist and typical early users expected around $150 - $200 per month AUD.",
};

const pricingCards = [
  {
    description:
      "Join the waitlist now. Early access customers will be invited into onboarding as capacity opens.",
    name: "Early access",
    price: "Waitlist first",
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
        <span className="marketing-price-range">$150 - $200</span>
        <span className="marketing-price-term">per month AUD</span>
      </>
    ),
  },
];

export default function PricingPage() {
  return (
    <MarketingPageShell
      copy="Kyro is opening through a waitlist first. When onboarding opens, billing will be based on metered usage, so light users are not forced into heavy fixed plans."
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
          Kyro treats customer-facing usage charges, model routing, and usage
          events as first-class records, so the business owner can see what the
          assistant is doing and what it costs.
        </p>
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
