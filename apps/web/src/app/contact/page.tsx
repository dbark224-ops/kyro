import { MarketingPageShell } from "../components/marketing-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact | Kyro",
  description: "Contact Kyro about trial access and AI assistant setup.",
};

export default function ContactPage() {
  return (
    <MarketingPageShell
      copy="Send a few details and Kyro can follow up about trial access, setup, and the workflow you want handled."
      eyebrow="Contact"
      title="Contact Kyro"
    >
      <section className="marketing-section marketing-contact-layout">
        <div className="marketing-contact-card">
          <p className="marketing-eyebrow">Support</p>
          <h2>Need help with Kyro?</h2>
          <p>
            For app review, account access, support, billing, or setup
            questions, contact Kyro directly.
          </p>
          <dl className="marketing-contact-details">
            <div>
              <dt>Email</dt>
              <dd>
                <a href="mailto:hello@workflowautomation.au">
                  hello@workflowautomation.au
                </a>
              </dd>
            </div>
            <div>
              <dt>Australia</dt>
              <dd>
                <a href="tel:+61474783952">0474783952</a>
              </dd>
            </div>
            <div>
              <dt>International</dt>
              <dd>
                <a href="tel:+15755712705">+15755712705</a>
              </dd>
            </div>
          </dl>
        </div>

        <form action="#" className="marketing-contact-form">
          <label>
            Name
            <input autoComplete="name" name="name" required type="text" />
          </label>
          <label>
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Business
            <input
              autoComplete="organization"
              name="business"
              type="text"
            />
          </label>
          <label>
            What should Kyro help with?
            <textarea name="message" required rows={6} />
          </label>
          <button className="marketing-button" type="submit">
            Send enquiry
          </button>
        </form>
      </section>
    </MarketingPageShell>
  );
}
