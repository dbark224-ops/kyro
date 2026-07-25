"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  DASHBOARD_TOUR_START_EVENT,
  DASHBOARD_TOUR_STORAGE_KEY,
} from "./tutorial-events";

export function TutorialLauncher() {
  const pathname = usePathname();
  const router = useRouter();

  const startTutorial = () => {
    try {
      window.sessionStorage.setItem(DASHBOARD_TOUR_STORAGE_KEY, "1");
    } catch {
      // Session storage can be unavailable in hardened browser modes.
    }

    if (pathname === "/dashboard") {
      window.dispatchEvent(new Event(DASHBOARD_TOUR_START_EVENT));
      return;
    }

    router.push("/dashboard?tour=1");
  };

  return (
    <button
      className="tutorial-launcher-pill"
      onClick={startTutorial}
      type="button"
    >
      Tutorial
    </button>
  );
}
