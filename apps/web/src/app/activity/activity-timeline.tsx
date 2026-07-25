"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

export type ActivityTimelineItem = {
  id: string;
  at: string;
  title: string;
  detail: string;
  meta: string;
  searchText?: string;
  tone:
    | "action"
    | "ai"
    | "audit"
    | "event"
    | "failed"
    | "inbound"
    | "outbound"
    | "route"
    | "usage";
};

type ActivitySelectionContextValue = {
  selectedItem: ActivityTimelineItem | null;
  selectItem: (item: ActivityTimelineItem) => void;
  timeZone: string;
};

const ActivitySelectionContext =
  createContext<ActivitySelectionContextValue | null>(null);

function useActivitySelection() {
  const context = useContext(ActivitySelectionContext);

  if (!context) {
    throw new Error("Activity selection components require a provider.");
  }

  return context;
}

function formatActivityDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function ActivitySelectionProvider({
  children,
  initialItem,
  timeZone,
}: {
  children: ReactNode;
  initialItem: ActivityTimelineItem | null;
  timeZone: string;
}) {
  const [selectedItem, setSelectedItem] = useState(initialItem);

  const value = useMemo(
    () => ({ selectedItem, selectItem: setSelectedItem, timeZone }),
    [selectedItem, timeZone],
  );

  return (
    <ActivitySelectionContext.Provider value={value}>
      {children}
    </ActivitySelectionContext.Provider>
  );
}

export function ActivityTimeline({
  emptyCopy,
  items,
}: {
  emptyCopy: string;
  items: ActivityTimelineItem[];
}) {
  const { selectedItem, selectItem, timeZone } = useActivitySelection();

  return (
    <div className="log-feed">
      {items.length > 0 ? (
        items.map((item) => (
          <button
            aria-pressed={selectedItem?.id === item.id}
            className={`log-row log-row-button ${item.tone}${
              selectedItem?.id === item.id ? " selected" : ""
            }`}
            key={item.id}
            onClick={() => selectItem(item)}
            type="button"
          >
            <span className="log-marker" aria-hidden="true" />
            <span className="log-main">
              <span className="log-summary-row">
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </span>
            </span>
            <time dateTime={item.at}>
              {formatActivityDate(item.at, timeZone)}
            </time>
            <span className="pill">{item.meta}</span>
          </button>
        ))
      ) : (
        <p className="empty-copy">{emptyCopy}</p>
      )}
    </div>
  );
}

export function ActivitySelectedDetail() {
  const { selectedItem, timeZone } = useActivitySelection();

  return (
    <article className="panel activity-detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Selected</p>
          <h2>Activity detail</h2>
        </div>
      </div>
      {selectedItem ? (
        <div className="detail-list">
          <div>
            <span>Type</span>
            <strong>{formatLabel(selectedItem.tone)}</strong>
          </div>
          <div>
            <span>When</span>
            <strong>{formatActivityDate(selectedItem.at, timeZone)}</strong>
          </div>
          <div>
            <span>Summary</span>
            <strong>{selectedItem.title}</strong>
          </div>
          <div>
            <span>Detail</span>
            <strong>
              {selectedItem.detail || "No additional detail recorded."}
            </strong>
          </div>
          <div>
            <span>Status / source</span>
            <strong>{selectedItem.meta}</strong>
          </div>
        </div>
      ) : (
        <p className="empty-copy">Nothing has happened yet.</p>
      )}
    </article>
  );
}
