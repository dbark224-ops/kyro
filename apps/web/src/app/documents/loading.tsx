import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function DocumentsLoading() {
  return (
    <AppFrame active="Documents">
      <PageSkeleton eyebrow="Loading" title="Documents" />
    </AppFrame>
  );
}
