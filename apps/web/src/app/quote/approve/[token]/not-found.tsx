export default function QuoteApprovalNotFound() {
  return (
    <main className="public-approval-shell">
      <section className="public-approval-frame public-approval-frame-narrow">
        <header className="public-approval-header">
          <div>
            <p className="eyebrow">Kyro</p>
            <h1>Quote link not found</h1>
            <p>
              This approval link may have expired, been replaced, or been copied
              incorrectly. Please ask the business to send a fresh quote link.
            </p>
          </div>
        </header>
      </section>
    </main>
  );
}
