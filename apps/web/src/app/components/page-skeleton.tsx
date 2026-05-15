type PageSkeletonProps = {
  eyebrow: string;
  title: string;
  rows?: number;
  detail?: boolean;
};

export function PageSkeleton({ detail = false, eyebrow, rows = 5, title }: PageSkeletonProps) {
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </header>

      <section className="metric-grid" aria-label="Loading metrics">
        {["cyan", "purple", "pink"].map((color) => (
          <article className={`metric-card ${color}`} key={color}>
            <span className="skeleton-line short" />
            <span className="skeleton-number" />
            <span className="skeleton-line" />
          </article>
        ))}
      </section>

      {detail ? (
        <section className="review-grid large-left">
          <article className="panel">
            <span className="skeleton-line medium" />
            <div className="skeleton-form">
              {Array.from({ length: 7 }, (_, index) => (
                <span className="skeleton-input" key={index} />
              ))}
            </div>
          </article>
          <aside className="side-stack">
            <article className="panel">
              <span className="skeleton-line medium" />
              <span className="skeleton-line" />
              <span className="skeleton-line" />
              <span className="skeleton-line short" />
            </article>
            <article className="panel">
              <span className="skeleton-line medium" />
              <span className="skeleton-line" />
              <span className="skeleton-line" />
            </article>
          </aside>
        </section>
      ) : (
        <section className="panel page-panel">
          <span className="skeleton-line medium" />
          <div className="skeleton-list">
            {Array.from({ length: rows }, (_, index) => (
              <div className="skeleton-row" key={index}>
                <div>
                  <span className="skeleton-line medium" />
                  <span className="skeleton-line" />
                </div>
                <div>
                  <span className="skeleton-pill" />
                  <span className="skeleton-line short" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
