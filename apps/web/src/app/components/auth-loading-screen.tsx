import { BrandMark } from "./brand-mark";

type AuthLoadingScreenProps = {
  copy?: string;
  title: string;
};

export function AuthLoadingScreen({ copy, title }: AuthLoadingScreenProps) {
  return (
    <main className="auth-shell">
      <section aria-busy="true" className="auth-panel auth-centered">
        <div className="brand-lockup centered">
          <BrandMark />
        </div>

        <div className="auth-copy centered">
          <h1>{title}</h1>
          {copy ? <p className="form-copy">{copy}</p> : null}
        </div>

        <div className="form-card auth-form-card">
          <span className="skeleton-line short" />
          <span className="skeleton-input" />
          <span className="skeleton-line short" />
          <span className="skeleton-input" />
          <span className="skeleton-input auth-loading-submit" />
        </div>
      </section>
    </main>
  );
}
