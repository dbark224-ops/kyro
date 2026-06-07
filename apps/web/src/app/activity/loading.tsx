import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function ActivityLoading() {
  return (
    <AppFrame active="Activity">
      <PageSkeleton eyebrow="Loading" rows={10} title="Activity" />
    </AppFrame>
  );
}
