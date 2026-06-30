import Image from "next/image";

export const metadata = {
  title: "Email verified | Kyro",
};

export default function EmailVerifiedPage() {
  return (
    <main className="auth-verified-page">
      <section className="auth-verified-panel" aria-labelledby="verified-title">
        <Image
          alt="Kyro"
          height={500}
          priority
          src="/brand/kyro-email-logo.png"
          width={1000}
        />
        <p className="eyebrow">Email verified</p>
        <h1 id="verified-title">You are all set.</h1>
        <p>Return to Kyro to keep setting up your workspace.</p>
      </section>
    </main>
  );
}
