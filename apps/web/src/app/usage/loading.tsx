import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function UsageLoading() {
  return (
    <AppFrame active="Settings">
      <PageSkeleton eyebrow="Metering" rows={6} title="Settings" />
    </AppFrame>
  );
}
