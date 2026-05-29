import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function DocumentsLoading() {
  return (
    <AppFrame active="Files">
      <PageSkeleton eyebrow="Loading" title="Files" />
    </AppFrame>
  );
}
