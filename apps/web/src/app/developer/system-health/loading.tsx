import { AppFrame } from "../../components/app-frame";
import { PageSkeleton } from "../../components/page-skeleton";

export default function SystemHealthLoading() {
  return (
    <AppFrame active="Developer">
      <PageSkeleton eyebrow="Developer" rows={3} title="System health" />
    </AppFrame>
  );
}
