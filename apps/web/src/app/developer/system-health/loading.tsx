import { AppDetailSkeleton } from "../../components/loading-states";

export default function SystemHealthLoading() {
  return (
    <AppDetailSkeleton
      active="Developer"
      eyebrow="Developer"
      rows={3}
      title="System health"
    />
  );
}
