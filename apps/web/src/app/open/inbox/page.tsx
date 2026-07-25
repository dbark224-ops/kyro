"use client";

import Image from "next/image";
import { useCallback, useEffect } from "react";
import styles from "./page.module.css";

const APP_OPEN_DELAY_MS = 1_400;

function inboxTargets() {
  const query = new URLSearchParams(window.location.search);
  const conversationId = query.get("conversationId")?.trim();
  const suffix = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : "";

  return {
    app: `kyro://inbox${suffix}`,
    web: `/inbox${suffix}`,
  };
}

export default function OpenInboxPage() {
  const openApp = useCallback(() => {
    const targets = inboxTargets();
    window.location.assign(targets.app);
  }, []);

  const openWeb = useCallback(() => {
    window.location.assign(inboxTargets().web);
  }, []);

  useEffect(() => {
    const targets = inboxTargets();

    const fallbackTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.location.replace(targets.web);
      }
    }, APP_OPEN_DELAY_MS);

    const stopFallbackWhenAppOpens = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(fallbackTimer);
      }
    };

    document.addEventListener("visibilitychange", stopFallbackWhenAppOpens);
    window.location.assign(targets.app);

    return () => {
      window.clearTimeout(fallbackTimer);
      document.removeEventListener(
        "visibilitychange",
        stopFallbackWhenAppOpens,
      );
    };
  }, []);

  return (
    <main className={styles.page}>
      <section aria-live="polite" className={styles.panel}>
        <Image
          alt="Kyro"
          className={styles.logo}
          height={72}
          priority
          src="/kyro-icon.png"
          width={72}
        />
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Kyro inquiry</p>
          <h1>Opening Kyro</h1>
          <p>
            Kyro is opening this inquiry in the mobile app. If the app is not
            installed, the web inbox will open instead.
          </p>
        </div>
        <span aria-hidden="true" className={styles.progress}>
          <span />
        </span>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={openApp} type="button">
            Open Kyro app
          </button>
          <button className={styles.secondary} onClick={openWeb} type="button">
            Continue in browser
          </button>
        </div>
      </section>
    </main>
  );
}
