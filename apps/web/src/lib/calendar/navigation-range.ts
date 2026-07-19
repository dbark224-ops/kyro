import {
  addDaysToDateKey,
  addMonthsToDateKey,
  rangeForCalendarViewDateKey,
  startOfWeekDateKey,
  type DateKeyRange,
} from "../timezone";
import type { CalendarWeekLayout } from "./settings";

export const CALENDAR_NAVIGATION_PRELOAD_MONTHS_BACK = 2;
export const CALENDAR_NAVIGATION_PRELOAD_MONTHS_FORWARD = 3;

export function calendarWeekVisibleRange(
  anchorDateKey: string,
  input: {
    weekDaysBefore: number;
    weekLayout: CalendarWeekLayout;
  },
): DateKeyRange {
  const daysBefore = Math.max(0, Math.min(6, Math.round(input.weekDaysBefore)));
  const from =
    input.weekLayout === "rolling"
      ? addDaysToDateKey(anchorDateKey, -daysBefore)
      : startOfWeekDateKey(anchorDateKey);

  return {
    from,
    to: addDaysToDateKey(from, 7),
  };
}

export function calendarNavigationPreloadRange(
  anchorDateKey: string,
): DateKeyRange {
  const ranges = Array.from(
    {
      length:
        CALENDAR_NAVIGATION_PRELOAD_MONTHS_BACK +
        CALENDAR_NAVIGATION_PRELOAD_MONTHS_FORWARD +
        1,
    },
    (_, index) =>
      rangeForCalendarViewDateKey(
        addMonthsToDateKey(
          anchorDateKey,
          index - CALENDAR_NAVIGATION_PRELOAD_MONTHS_BACK,
        ),
        "month",
      ),
  );

  return {
    from: ranges.reduce(
      (earliest, range) => (range.from < earliest ? range.from : earliest),
      ranges[0]?.from ?? anchorDateKey,
    ),
    to: ranges.reduce(
      (latest, range) => (range.to > latest ? range.to : latest),
      ranges[0]?.to ?? anchorDateKey,
    ),
  };
}

export function dateKeyRangeContainsRange(
  outer: DateKeyRange,
  inner: DateKeyRange,
) {
  return inner.from >= outer.from && inner.to <= outer.to;
}
