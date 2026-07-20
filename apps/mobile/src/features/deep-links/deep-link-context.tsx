import {
  router,
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
} from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Linking } from "react-native";

import { useAuthSession } from "@/features/auth/auth-context";
import { useAppLock } from "@/features/security/app-lock-context";

import {
  parseKyroDeepLink,
  type KyroDeepLinkDestination,
} from "./deep-links";

type DeepLinkContextValue = {
  consumePendingDestination: (key: string) => void;
  pendingDestination: KyroDeepLinkDestination | null;
};

const DeepLinkContext = createContext<DeepLinkContextValue | null>(null);
const duplicateWindowMs = 2500;

export function DeepLinkProvider({ children }: { children: ReactNode }) {
  const [pendingDestination, setPendingDestination] =
    useState<KyroDeepLinkDestination | null>(null);
  const lastQueuedRef = useRef<{ key: string; queuedAt: number } | null>(null);

  const queueUrl = useCallback((url: string) => {
    const destination = parseKyroDeepLink(url);

    if (!destination) {
      return;
    }

    const now = Date.now();
    const lastQueued = lastQueuedRef.current;

    if (
      lastQueued?.key === destination.key &&
      now - lastQueued.queuedAt < duplicateWindowMs
    ) {
      return;
    }

    lastQueuedRef.current = { key: destination.key, queuedAt: now };
    setPendingDestination(destination);
  }, []);

  useEffect(() => {
    let mounted = true;

    void Linking.getInitialURL().then((url) => {
      if (mounted && url) {
        queueUrl(url);
      }
    });

    const subscription = Linking.addEventListener("url", (event) => {
      queueUrl(event.url);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [queueUrl]);

  const consumePendingDestination = useCallback((key: string) => {
    setPendingDestination((current) => (current?.key === key ? null : current));
  }, []);

  const value = useMemo<DeepLinkContextValue>(
    () => ({
      consumePendingDestination,
      pendingDestination,
    }),
    [consumePendingDestination, pendingDestination],
  );

  return (
    <DeepLinkContext.Provider value={value}>
      {children}
    </DeepLinkContext.Provider>
  );
}

export function DeepLinkNavigator() {
  const { status } = useAuthSession();
  const { isLocked, isReady, setupPromptVisible } = useAppLock();
  const { consumePendingDestination, pendingDestination } = useDeepLinks();
  const navigationState = useRootNavigationState();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{
    conversationId?: string | string[];
    openError?: string | string[];
  }>();

  useEffect(() => {
    if (!navigationState?.key || !pendingDestination) {
      return;
    }

    if (status === "loading") {
      return;
    }

    if (status !== "signed-in") {
      if (pathname !== "/sign-in") {
        router.replace("/sign-in");
      }

      return;
    }

    if (!isReady || isLocked || setupPromptVisible) {
      return;
    }

    if (pendingDestination.kind === "inbox-conversation") {
      const currentConversationId =
        typeof params.conversationId === "string"
          ? params.conversationId
          : null;

      if (
        pathname === "/inbox" &&
        currentConversationId === pendingDestination.conversationId
      ) {
        consumePendingDestination(pendingDestination.key);
        return;
      }

      router.replace({
        pathname: "/inbox",
        params: { conversationId: pendingDestination.conversationId },
      });
      consumePendingDestination(pendingDestination.key);
      return;
    }

    router.replace({
      pathname: "/inbox",
      params: { openError: pendingDestination.openError },
    });
    consumePendingDestination(pendingDestination.key);
  }, [
    consumePendingDestination,
    isLocked,
    isReady,
    navigationState?.key,
    params.conversationId,
    pathname,
    pendingDestination,
    setupPromptVisible,
    status,
  ]);

  return null;
}

function useDeepLinks() {
  const value = useContext(DeepLinkContext);

  if (!value) {
    throw new Error("useDeepLinks must be used inside DeepLinkProvider.");
  }

  return value;
}
