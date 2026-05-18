import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function VoiceLoading() {
  return (
    <AppFrame active="Voice">
      <PageSkeleton eyebrow="Loading" title="Voice" />
    </AppFrame>
  );
}
