import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function LeadsLoading() {
  return (
    <AppFrame active="CRM">
      <PageSkeleton eyebrow="Loading" title="CRM" />
    </AppFrame>
  );
}
