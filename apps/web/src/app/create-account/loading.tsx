import { AuthLoadingScreen } from "../components/auth-loading-screen";

export default function CreateAccountLoading() {
  return (
    <AuthLoadingScreen
      copy="Set up the login first. Workspace details come next."
      title="Create your Kyro account."
    />
  );
}
