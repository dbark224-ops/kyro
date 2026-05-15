import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function InboxLoading() {
  return (
    <AppFrame active="Inbox">
      <PageSkeleton eyebrow="Loading" title="Inbox" />
    </AppFrame>
  );
}
