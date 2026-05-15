import { AppFrame } from "../../components/app-frame";
import { PageSkeleton } from "../../components/page-skeleton";

export default function QuoteDraftLoading() {
  return (
    <AppFrame active="Documents">
      <PageSkeleton detail eyebrow="Loading" title="Quote draft" />
    </AppFrame>
  );
}
