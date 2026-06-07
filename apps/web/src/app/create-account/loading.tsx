import { AuthLoadingScreen } from "../components/auth-loading-screen";

export default function CreateAccountLoading() {
  return (
    <AuthLoadingScreen
      copy="Preparing the account and workspace setup."
      title="Create your Kyro account."
    />
  );
}
