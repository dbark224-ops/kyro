import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function VapiVoiceLoading() {
  return (
    <AppFrame active="Vapi Voice">
      <PageSkeleton eyebrow="Loading" rows={6} title="Vapi Voice" />
    </AppFrame>
  );
}
