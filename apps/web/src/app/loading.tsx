import { AppFrame } from "./components/app-frame";
import { PageSkeleton } from "./components/page-skeleton";

export default function WorkspaceLoading() {
  return (
    <AppFrame active="Assistant">
      <PageSkeleton eyebrow="Workspace" rows={5} title="Kyro" />
    </AppFrame>
  );
}
