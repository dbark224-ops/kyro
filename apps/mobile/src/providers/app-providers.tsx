import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { VapiCallProvider } from "@/features/assistant/vapi-call-context";
import { AppearanceProvider } from "@/features/appearance/appearance-context";
import { AuthProvider } from "@/features/auth/auth-context";
import {
  AppLockGate,
  AppLockProvider,
} from "@/features/security/app-lock-context";
import { mobileQueryGcTime } from "@/lib/mobile-query";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: mobileQueryGcTime,
            refetchOnReconnect: true,
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 1000 * 60,
          },
        },
      }),
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppearanceProvider>
          <AuthProvider>
            <AppLockProvider>
              <VapiCallProvider>
                <AppLockGate>{children}</AppLockGate>
              </VapiCallProvider>
            </AppLockProvider>
          </AuthProvider>
        </AppearanceProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
