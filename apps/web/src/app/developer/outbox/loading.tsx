import { AppDetailSkeleton } from "../../components/loading-states";

export default function OutboxOperationsLoading() {
  return (
    <AppDetailSkeleton
      active="Developer"
      eyebrow="Developer"
      rows={4}
      title="Outbox operations"
    />
  );
}
