import { AppFrame } from "../../components/app-frame";
import { PageSkeleton } from "../../components/page-skeleton";

export default function ContactProfileLoading() {
  return (
    <AppFrame active="Contacts">
      <PageSkeleton detail eyebrow="Loading" title="Contact profile" />
    </AppFrame>
  );
}
