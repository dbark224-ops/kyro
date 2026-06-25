import Image from "next/image";

export default function WorkspaceLoading() {
  return (
    <main aria-busy="true" className="marketing-page marketing-route-loading">
      <div aria-hidden="true" className="marketing-route-loading-field">
        <span />
        <span />
        <span />
      </div>
      <section className="marketing-route-loading-panel">
        <Image
          alt="Kyro"
          height={500}
          priority
          src="/brand/kyro-logo-dark.png"
          width={1000}
        />
        <p className="marketing-eyebrow">Loading Kyro</p>
      </section>
    </main>
  );
}
