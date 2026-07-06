import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuthSession } from "@/features/auth/auth-context";
import {
  mobileAssistantQueryOptions,
  mobileAssistantVapiSessionQueryOptions,
  mobileCalendarQueryOptions,
  mobileCrmContactQueryOptions,
  mobileCrmQueryOptions,
  mobileDashboardQueryOptions,
  mobileFilePreviewQueryOptions,
  mobileFilesQueryOptions,
  mobileInboxConversationQueryOptions,
  mobileInboxQueryOptions,
  mobileSettingsQueryOptions
} from "@/lib/mobile-query";

const WARMUP_COOLDOWN_MS = 75 * 1000;
const WARMUP_STAGGER_MS = 180;
const FILE_PREVIEW_WARMUP_LIMIT = 3;
const DETAIL_WARMUP_LIMIT = 4;

type IdleTask = {
  cancel: () => void;
};

export function MobileDataWarmup() {
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const lastWarmupAtRef = useRef(0);
  const lastWarmupUserRef = useRef<string | null>(null);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    if (status !== "signed-in" || !session?.access_token) {
      return undefined;
    }

    if (lastWarmupUserRef.current !== session.user.id) {
      lastWarmupAtRef.current = 0;
      lastWarmupUserRef.current = session.user.id;
    }

    let idleTask: IdleTask | null = null;

    function clearTimers() {
      for (const timer of timersRef.current) {
        clearTimeout(timer);
      }

      timersRef.current = [];
    }

    function scheduleWarmup() {
      const now = Date.now();

      if (now - lastWarmupAtRef.current < WARMUP_COOLDOWN_MS) {
        return;
      }

      lastWarmupAtRef.current = now;
      idleTask?.cancel();
      clearTimers();

      idleTask = runWhenIdle(() => {
        const jobs = [
          () => warmDashboardAndLikelyDetails(),
          () => queryClient.prefetchQuery(mobileInboxQueryOptions(session)),
          () => queryClient.prefetchQuery(mobileCrmQueryOptions(session)),
          () => queryClient.prefetchQuery(mobileCalendarQueryOptions(session)),
          () => queryClient.prefetchQuery(mobileAssistantQueryOptions(session)),
          () => queryClient.prefetchQuery(mobileAssistantVapiSessionQueryOptions(session)),
          () => warmListDetails(),
          () => queryClient.prefetchQuery(mobileSettingsQueryOptions(session)),
          () => warmFilesAndPreviews()
        ];

        jobs.forEach((job, index) => {
          const timer = setTimeout(() => {
            void Promise.resolve(job()).catch(() => undefined);
          }, index * WARMUP_STAGGER_MS);

          timersRef.current.push(timer);
        });
      });
    }

    async function warmFilesAndPreviews() {
      const files = await queryClient.fetchQuery(mobileFilesQueryOptions(session));
      const previewableImages = files.files
        .filter((file) => file.kind === "image" && file.canPreviewInline)
        .slice(0, FILE_PREVIEW_WARMUP_LIMIT);

      await Promise.all(
        previewableImages.map((file) =>
          queryClient.prefetchQuery(
            mobileFilePreviewQueryOptions(session, file.id)
          )
        )
      );
    }

    async function warmDashboardAndLikelyDetails() {
      const dashboard = await queryClient.fetchQuery(
        mobileDashboardQueryOptions(session)
      );
      const commandCenter = dashboard.commandCenter;

      if (!commandCenter) {
        return;
      }

      const queueItems = commandCenter.workQueue.slice(0, DETAIL_WARMUP_LIMIT);
      const contacts = [
        ...commandCenter.topContacts,
        ...commandCenter.suppliers
      ].slice(0, DETAIL_WARMUP_LIMIT);

      await Promise.allSettled([
        ...queueItems.map((item) =>
          queryClient.prefetchQuery(
            mobileInboxConversationQueryOptions(session, item.id)
          )
        ),
        ...contacts.map((contact) =>
          queryClient.prefetchQuery(
            mobileCrmContactQueryOptions(session, contact.id)
          )
        )
      ]);
    }

    async function warmListDetails() {
      const [inbox, crm] = await Promise.all([
        queryClient.fetchQuery(mobileInboxQueryOptions(session)),
        queryClient.fetchQuery(mobileCrmQueryOptions(session))
      ]);

      await Promise.allSettled([
        ...inbox.items.slice(0, DETAIL_WARMUP_LIMIT).map((item) =>
          queryClient.prefetchQuery(
            mobileInboxConversationQueryOptions(session, item.id)
          )
        ),
        ...crm.contacts.slice(0, DETAIL_WARMUP_LIMIT).map((contact) =>
          queryClient.prefetchQuery(
            mobileCrmContactQueryOptions(session, contact.id)
          )
        )
      ]);
    }

    function handleAppState(nextState: AppStateStatus) {
      if (nextState === "active") {
        scheduleWarmup();
      }
    }

    scheduleWarmup();
    const subscription = AppState.addEventListener("change", handleAppState);

    return () => {
      idleTask?.cancel();
      clearTimers();
      subscription.remove();
    };
  }, [queryClient, session, status]);

  return null;
}

function runWhenIdle(callback: () => void): IdleTask {
  const idleGlobal = globalThis as typeof globalThis & {
    cancelIdleCallback?: (handle: number) => void;
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout?: number }
    ) => number;
  };

  if (idleGlobal.requestIdleCallback && idleGlobal.cancelIdleCallback) {
    const handle = idleGlobal.requestIdleCallback(callback, { timeout: 750 });

    return {
      cancel: () => idleGlobal.cancelIdleCallback?.(handle)
    };
  }

  const timer = setTimeout(callback, 16);

  return {
    cancel: () => clearTimeout(timer)
  };
}
