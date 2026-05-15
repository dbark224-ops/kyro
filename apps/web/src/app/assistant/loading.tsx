import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function AssistantLoading() {
  return (
    <AppFrame active="Assistant">
      <PageSkeleton eyebrow="Loading" title="Assistant" />
    </AppFrame>
  );
}
