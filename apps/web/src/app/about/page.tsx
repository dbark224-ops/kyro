import { MarketingPageShell } from "../components/marketing-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About | Kyro",
  description:
    "Kyro is an AI assistant and operations hub for service businesses that need help keeping up with calls, messages, quotes, payments, and follow-up.",
};

const aboutSections = [
  {
    copy: "Kyro is built for small service businesses where the person doing the work is often the same person answering calls, writing quotes, chasing messages, and trying not to lose jobs in the gaps.",
    title: "Why it exists",
  },
  {
    copy: "The product is designed to keep the human in control. Kyro surfaces new enquiries, prepares replies, records call activity, organises customer context, and helps the business act faster without pretending the AI should replace the operator.",
    title: "How it works",
  },
  {
    copy: "Kyro is being shaped around real trades, local service operators, and admin-heavy owner-led businesses. The focus is practical: fewer missed opportunities, clearer records, and faster follow-up.",
    title: "Who it serves",
  },
];

export default function AboutPage() {
  return (
    <MarketingPageShell
      copy="Kyro helps service businesses stay responsive when work, calls, messages, quotes, and payments are all competing for attention."
      eyebrow="About"
      title="About Kyro"
    >
      <section className="marketing-section">
        <div className="marketing-feature-grid">
          {aboutSections.map((section) => (
            <article className="marketing-feature-card" key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </MarketingPageShell>
  );
}
