"use client";

import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Click a time to create an event; drag down to say how long it runs.
 *
 * Clicking already opened the creator at the right time, but the duration was
 * always the workspace default, so setting a two-hour visit meant opening the
 * form and editing the end time. Dragging is how every calendar app expresses
 * "this long", and the gesture is already in everyone's fingers.
 *
 * Pointer events rather than mouse events, so this works with a finger and a
 * stylus. Pointer capture means the drag keeps tracking when it leaves the
 * column, which it will -- people overshoot.
 */
export type TimelineDragGeometry = {
  height: number;
  top: number;
};

export type TimelineDragCreate = {
  day: Date;
  endMinutes: number;
  startMinutes: number;
};

export type TimelineDragPreview = {
  day: Date;
  endMinutes: number;
  heightPercent: number;
  startMinutes: number;
  topPercent: number;
};

/**
 * How long the new event runs.
 *
 * A click expresses a time, not a length, so it keeps the workspace default. A
 * drag is the user saying how long, so it wins -- but only once it covers at
 * least one snap step, otherwise a press that wobbled by a pixel would create
 * a zero-length event instead of a normal one.
 */
export function timelineCreateDurationMinutes({
  defaultDurationMinutes,
  endMinutes,
  snapMinutes,
  startMinutes,
}: {
  defaultDurationMinutes: number;
  endMinutes: number;
  snapMinutes: number;
  startMinutes: number;
}) {
  const dragged = endMinutes - startMinutes;

  return dragged >= snapMinutes ? dragged : defaultDurationMinutes;
}

type DragState = {
  currentMinutes: number;
  day: Date;
  geometry: TimelineDragGeometry;
  moved: boolean;
  startMinutes: number;
};

export function useTimelineDragCreate({
  minutesFromPointer,
  onCreate,
  percentForMinutes,
  snapMinutes,
}: {
  /** Pointer position -> minutes past midnight, already snapped and clamped. */
  minutesFromPointer: (clientY: number, geometry: TimelineDragGeometry) => number;
  onCreate: (range: TimelineDragCreate) => void;
  percentForMinutes: (minutes: number) => number;
  snapMinutes: number;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Kept in a ref as well so pointerup reads the committed value rather than a
  // stale closure from the render that installed the handler.
  const dragRef = useRef<DragState | null>(null);

  const update = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onPointerDown = useCallback(
    (day: Date, event: ReactPointerEvent<HTMLElement>) => {
      // Only a primary press on empty timeline. A press that starts on an
      // event card belongs to that card.
      if (event.button !== 0) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (target?.closest("button")) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const geometry = { height: rect.height, top: rect.top };
      const startMinutes = minutesFromPointer(event.clientY, geometry);

      event.currentTarget.setPointerCapture(event.pointerId);
      update({
        currentMinutes: startMinutes,
        day,
        geometry,
        moved: false,
        startMinutes,
      });
    },
    [minutesFromPointer, update],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = dragRef.current;

      if (!current) {
        return;
      }

      const currentMinutes = minutesFromPointer(event.clientY, current.geometry);

      if (currentMinutes === current.currentMinutes) {
        return;
      }

      update({
        ...current,
        currentMinutes,
        // One snap step of travel separates a drag from a click with a shaky
        // hand, and keeps a plain click on the default duration.
        moved:
          current.moved ||
          Math.abs(currentMinutes - current.startMinutes) >= snapMinutes,
      });
    },
    [minutesFromPointer, snapMinutes, update],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = dragRef.current;

      update(null);

      if (!current) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      // Dragging upward is still a duration, just expressed backwards.
      const from = Math.min(current.startMinutes, current.currentMinutes);
      const to = Math.max(current.startMinutes, current.currentMinutes);

      onCreate({
        day: current.day,
        endMinutes: current.moved ? to : from,
        startMinutes: from,
      });
    },
    [onCreate, update],
  );

  const onPointerCancel = useCallback(() => {
    update(null);
  }, [update]);

  const preview: TimelineDragPreview | null =
    drag && drag.moved
      ? (() => {
          const from = Math.min(drag.startMinutes, drag.currentMinutes);
          const to = Math.max(drag.startMinutes, drag.currentMinutes);
          const topPercent = percentForMinutes(from);

          return {
            day: drag.day,
            endMinutes: to,
            heightPercent: Math.max(0, percentForMinutes(to) - topPercent),
            startMinutes: from,
            topPercent,
          };
        })()
      : null;

  return {
    isDragging: Boolean(drag?.moved),
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    preview,
  };
}
