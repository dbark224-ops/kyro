import { MarketingPageShell } from "../components/marketing-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About | Kyro",
  description:
    "Placeholder about page for Kyro's business story, founder note, and company details.",
};

const aboutPlaceholders = [
  {
    copy: "Placeholder for the Kyro business story: why it exists, who it serves, and what problem the company is built around.",
    title: "Business story",
  },
  {
    copy: "Placeholder for founder background, product philosophy, and the reason Kyro is focused on sole traders and service businesses.",
    title: "Founder note",
  },
  {
    copy: "Placeholder for company details such as location, launch stage, operating values, partnerships, and future roadmap.",
    title: "Company details",
  },
];

export default function AboutPage() {
  return (
    <MarketingPageShell
      copy="Placeholder content for the business behind Kyro. Replace this with the company story before launch."
      eyebrow="About"
      title="About Kyro"
    >
      <section className="marketing-section">
        <div className="marketing-feature-grid">
          {aboutPlaceholders.map((section) => (
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
