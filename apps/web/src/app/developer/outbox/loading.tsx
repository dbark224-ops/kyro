import { AppFrame } from "../../components/app-frame";
import { PageSkeleton } from "../../components/page-skeleton";

export default function OutboxOperationsLoading() {
  return (
    <AppFrame active="Developer">
      <PageSkeleton eyebrow="Developer" rows={4} title="Outbox operations" />
    </AppFrame>
  );
}
