import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function ReportsLoading() {
  return (
    <AppFrame active="Reports">
      <PageSkeleton eyebrow="Loading" rows={5} title="Reports" />
    </AppFrame>
  );
}
