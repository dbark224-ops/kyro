"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  DASHBOARD_TOUR_START_EVENT,
  DASHBOARD_TOUR_STORAGE_KEY,
} from "../components/tutorial-events";

type TourStep = {
  body: string;
  spotlightPadding?: number;
  target: string;
  title: string;
};

type SpotlightRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

const tourSteps: TourStep[] = [
  {
    body: "Move between Dashboard, Assistant, Inbox, CRM, Files, Payments, Activity, Reports, and Settings from here.",
    target: "[data-tour='side-panel']",
    title: "Side panel",
  },
  {
    body: "Search across contacts, messages, files, reports, and workspace context without leaving the page.",
    target: "[data-tour='global-search']",
    title: "Search Kyro",
  },
  {
    body: "These four cards show the numbers that need attention. You can change the dashboard layout later.",
    target: "[data-tour='dashboard-metrics']",
    title: "Daily counters",
  },
  {
    body: "Your active enquiries and follow-ups sit here so urgent items stay visible.",
    target: "[data-tour='work-queue']",
    title: "Work queue",
  },
  {
    body: "Ask Kyro quick questions from the dashboard. Open full when you want the dedicated assistant workspace.",
    target: "[data-tour='dashboard-assistant']",
    title: "Mini assistant",
  },
  {
    body: "Calls, SMS, emails, and background actions land here as a running audit trail.",
    target: "[data-tour='system-activity']",
    title: "System activity",
  },
  {
    body: "Payments, top contacts, suppliers, and other widgets can be swapped as Kyro grows with the business.",
    target: "[data-tour='dashboard-bottom-widgets']",
    title: "Workspace widgets",
  },
  {
    body: "Use this control to pick which widgets appear in each row.",
    spotlightPadding: 4,
    target: "[data-tour='dashboard-customise']",
    title: "Customise",
  },
];

function rectForStep(step: TourStep): SpotlightRect | null {
  const element = document.querySelector(step.target);

  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

function cardPosition(rect: SpotlightRect | null) {
  const cardWidth = Math.min(380, window.innerWidth - 32);

  if (!rect) {
    return {
      left: Math.max(16, (window.innerWidth - cardWidth) / 2),
      top: Math.max(16, window.innerHeight / 2 - 130),
    };
  }

  const below = rect.top + rect.height + 18;
  const above = rect.top - 260;
  const top = below + 250 < window.innerHeight ? below : Math.max(16, above);
  const centeredLeft = rect.left + rect.width / 2 - cardWidth / 2;
  const left = Math.min(
    Math.max(16, centeredLeft),
    Math.max(16, window.innerWidth - cardWidth - 16),
  );

  return { left, top };
}

function hasManualTourRequest() {
  const params = new URLSearchParams(window.location.search);
  const requestedByUrl = params.get("tour") === "1";
  let requestedByStorage = false;

  try {
    requestedByStorage =
      window.sessionStorage.getItem(DASHBOARD_TOUR_STORAGE_KEY) === "1";
  } catch {
    requestedByStorage = false;
  }

  return requestedByUrl || requestedByStorage;
}

function clearManualTourRequest() {
  try {
    window.sessionStorage.removeItem(DASHBOARD_TOUR_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in hardened browser modes.
  }

  const url = new URL(window.location.href);

  if (url.searchParams.has("tour")) {
    url.searchParams.delete("tour");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }
}

export function DashboardTour() {
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);

  const step = tourSteps[stepIndex];

  const startTour = useCallback(() => {
    clearManualTourRequest();
    setLoading(false);
    setStepIndex(0);
    setSpotlight(null);
    setVisible(true);
  }, []);

  const updateSpotlight = useCallback(() => {
    if (!visible || !step) {
      return;
    }

    setSpotlight(rectForStep(step));
  }, [step, visible]);

  useEffect(() => {
    let cancelled = false;

    async function loadTutorialState() {
      if (hasManualTourRequest()) {
        if (!cancelled) {
          startTour();
        }
        return;
      }

      try {
        const response = await fetch("/api/onboarding/tutorial", {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          completed?: boolean;
          shouldShow?: boolean;
        };
        const shouldShow = data.shouldShow ?? !data.completed;

        if (!cancelled && shouldShow) {
          startTour();
        }
      } catch {
        // If the check fails, avoid blocking the dashboard with a tutorial error.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadTutorialState();

    return () => {
      cancelled = true;
    };
  }, [startTour]);

  useEffect(() => {
    const handleStartTour = () => startTour();

    window.addEventListener(DASHBOARD_TOUR_START_EVENT, handleStartTour);

    return () => {
      window.removeEventListener(DASHBOARD_TOUR_START_EVENT, handleStartTour);
    };
  }, [startTour]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(updateSpotlight);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [updateSpotlight]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handleChange = () => updateSpotlight();

    window.addEventListener("resize", handleChange);
    window.addEventListener("scroll", handleChange, true);

    return () => {
      window.removeEventListener("resize", handleChange);
      window.removeEventListener("scroll", handleChange, true);
    };
  }, [updateSpotlight, visible]);

  const finish = async () => {
    setVisible(false);
    await fetch("/api/onboarding/tutorial", {
      body: JSON.stringify({ completed: true }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => undefined);
  };

  if (loading || !visible || !step) {
    return null;
  }

  const position = cardPosition(spotlight);
  const isLast = stepIndex === tourSteps.length - 1;
  const spotlightPadding = step.spotlightPadding ?? 8;

  return (
    <div className="dashboard-tour-layer" role="dialog" aria-modal="true">
      {spotlight ? (
        <div
          aria-hidden="true"
          className="dashboard-tour-spotlight"
          style={{
            height: spotlight.height + spotlightPadding * 2,
            left: spotlight.left - spotlightPadding,
            top: spotlight.top - spotlightPadding,
            width: spotlight.width + spotlightPadding * 2,
          }}
        />
      ) : (
        <div aria-hidden="true" className="dashboard-tour-backdrop" />
      )}
      <section
        className="dashboard-tour-card"
        style={{
          left: position.left,
          top: position.top,
        }}
      >
        <div className="dashboard-tour-step">
          Step {stepIndex + 1} of {tourSteps.length}
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="dashboard-tour-progress" aria-hidden="true">
          {tourSteps.map((item, index) => (
            <span
              className={index === stepIndex ? "active" : ""}
              key={item.title}
            />
          ))}
        </div>
        <div className="dashboard-tour-actions">
          <button className="secondary-button compact" onClick={finish} type="button">
            Skip
          </button>
          <div>
            <button
              className="secondary-button compact"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              type="button"
            >
              Back
            </button>
            <button
              className="primary-button compact"
              onClick={() => {
                if (isLast) {
                  void finish();
                  return;
                }

                setStepIndex((current) =>
                  Math.min(tourSteps.length - 1, current + 1),
                );
              }}
              type="button"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
