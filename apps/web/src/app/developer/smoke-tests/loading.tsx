import { AppFrame } from "../../components/app-frame";
import { PageSkeleton } from "../../components/page-skeleton";

export default function SmokeTestsLoading() {
  return (
    <AppFrame active="Developer">
      <PageSkeleton eyebrow="Developer" rows={3} title="Smoke test checklist" />
    </AppFrame>
  );
}
