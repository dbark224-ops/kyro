import Image from "next/image";

import { AppFrame } from "./app-frame";
import { BrandMark } from "./brand-mark";
import { PageSkeleton } from "./page-skeleton";

type AppRouteLoadingProps = {
  active: string;
  label?: string;
};

type AppDetailSkeletonProps = AppRouteLoadingProps & {
  detail?: boolean;
  eyebrow?: string;
  rows?: number;
  title: string;
};

export function MarketingRouteLoading() {
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

// Top-level authenticated navigation: keep the app chrome and show a branded wait state.
export function AppRouteLoading({ active, label }: AppRouteLoadingProps) {
  return (
    <AppFrame active={active}>
      <section aria-busy="true" className="app-route-loading">
        <div className="app-route-loading-card">
          <div className="brand-lockup centered">
            <BrandMark />
          </div>
          <p className="eyebrow">{label ?? `Loading ${active}`}</p>
          <span className="app-route-loading-progress" aria-hidden="true">
            <span />
          </span>
        </div>
      </section>
    </AppFrame>
  );
}

// Detail/internal routes: preserve the destination shape with skeleton content.
export function AppDetailSkeleton({
  active,
  detail = false,
  eyebrow = "Loading",
  rows,
  title,
}: AppDetailSkeletonProps) {
  return (
    <AppFrame active={active}>
      <PageSkeleton detail={detail} eyebrow={eyebrow} rows={rows} title={title} />
    </AppFrame>
  );
}
