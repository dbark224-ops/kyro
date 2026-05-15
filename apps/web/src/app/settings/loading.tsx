import { AppFrame } from "../components/app-frame";
import { PageSkeleton } from "../components/page-skeleton";

export default function SettingsLoading() {
  return (
    <AppFrame active="Settings">
      <PageSkeleton eyebrow="Loading" rows={3} title="Settings" />
    </AppFrame>
  );
}
