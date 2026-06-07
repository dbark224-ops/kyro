import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function DashboardLoading() {
  return (
    <AppFrame active="Dashboard">
      <PageSkeleton eyebrow="Loading" rows={8} title="Dashboard" />
    </AppFrame>
  );
}
