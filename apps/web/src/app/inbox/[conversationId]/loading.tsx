import { AppFrame } from "../../components/app-frame";
import { PageSkeleton } from "../../components/page-skeleton";

export default function ConversationReviewLoading() {
  return (
    <AppFrame active="Inbox">
      <PageSkeleton detail eyebrow="Loading" title="Inquiry review" />
    </AppFrame>
  );
}
