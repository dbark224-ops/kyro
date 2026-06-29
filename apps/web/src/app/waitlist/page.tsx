import { BrandMark } from "../components/brand-mark";
import { WaitlistForm } from "./waitlist-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join the Waitlist | Kyro",
  description:
    "Join the Kyro waitlist for early access to an AI personal assistant for sole traders and service businesses.",
};

export default function WaitlistPage() {
  return (
    <main className="auth-shell">
      <section className="auth-panel wide auth-create-panel waitlist-panel">
        <div className="auth-create-header">
          <BrandMark />
          <h1>Join the Kyro waitlist</h1>
        </div>

        <p className="form-copy">
          Self-serve signup is closed while Kyro opens early access in batches.
          Tell us what kind of admin you want the assistant to handle and we
          will reach out when there is room to onboard you.
        </p>

        <WaitlistForm />
      </section>
    </main>
  );
}
