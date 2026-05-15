import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function DeveloperLoading() {
  return (
    <AppFrame active="Developer">
      <PageSkeleton eyebrow="Loading" rows={2} title="Developer" />
    </AppFrame>
  );
}
