import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const marketingNavItems = [
  { href: "/product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function MarketingHeader({
  variant = "default",
}: Readonly<{
  variant?: "default" | "hero";
}>) {
  return (
    <header className={`marketing-header ${variant}`}>
      <Link aria-label="Kyro home" className="marketing-brand" href="/">
        <Image
          alt=""
          aria-hidden="true"
          height={500}
          priority={variant === "hero"}
          src="/brand/kyro-logo-dark.png"
          width={1000}
        />
      </Link>

      <nav aria-label="Marketing navigation" className="marketing-nav">
        {marketingNavItems.map((item) => (
          <Link href={item.href} key={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="marketing-actions">
        <Link className="marketing-button small" href="/waitlist">
          Join waitlist
        </Link>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div>
        <Image
          alt="Kyro"
          className="marketing-footer-logo"
          height={500}
          src="/brand/kyro-logo-dark.png"
          width={1000}
        />
        <p>
          AI agents and personal assistant software for sole traders and small
          service businesses.
        </p>
      </div>

      <nav aria-label="Footer navigation">
        <Link href="/product">Product</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/waitlist">Waitlist</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/terms">Terms</Link>
      </nav>
    </footer>
  );
}

export function MarketingPageShell({
  children,
  copy,
  eyebrow,
  title,
}: Readonly<{
  children: ReactNode;
  copy: string;
  eyebrow: string;
  title: string;
}>) {
  return (
    <main className="marketing-page marketing-subpage">
      <MarketingHeader />
      <section className="marketing-subhero">
        <p className="marketing-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </section>
      {children}
      <MarketingFooter />
    </main>
  );
}
