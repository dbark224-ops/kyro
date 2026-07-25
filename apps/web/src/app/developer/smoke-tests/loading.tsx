import { AppDetailSkeleton } from "../../components/loading-states";

export default function SmokeTestsLoading() {
  return (
    <AppDetailSkeleton
      active="Developer"
      eyebrow="Developer"
      rows={3}
      title="Smoke test checklist"
    />
  );
}
