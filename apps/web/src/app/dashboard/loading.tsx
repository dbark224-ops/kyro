import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function LogLoading() {
  return (
    <AppFrame active="Log">
      <PageSkeleton eyebrow="Loading" rows={8} title="Log" />
    </AppFrame>
  );
}
