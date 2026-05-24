export default function QuoteApprovalLoading() {
  return (
    <main className="public-approval-shell">
      <section className="public-approval-frame">
        <header className="public-approval-header">
          <div>
            <p className="eyebrow">Kyro</p>
            <h1>Loading quote review</h1>
            <p>Preparing the customer approval page...</p>
          </div>
          <div className="public-approval-status">
            <span>Quote status</span>
            <strong>Loading</strong>
            <span>Please wait</span>
          </div>
        </header>
        <section className="public-approval-grid">
          <article className="public-quote-preview public-quote-preview-loading">
            <div className="skeleton-line medium" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-list">
              <div className="skeleton-row" />
              <div className="skeleton-row" />
              <div className="skeleton-row" />
            </div>
          </article>
          <aside className="public-approval-actions">
            <div className="public-approval-card">
              <p className="eyebrow">Decision</p>
              <h2>Loading quote...</h2>
              <p>Kyro is checking this secure approval link.</p>
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}
