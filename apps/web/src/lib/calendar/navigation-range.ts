import {
  addMonthsToDateKey,
  rangeForCalendarViewDateKey,
  type DateKeyRange,
} from "../timezone";

export const CALENDAR_NAVIGATION_PRELOAD_MONTH_RADIUS = 2;

export function calendarNavigationPreloadRange(
  anchorDateKey: string,
): DateKeyRange {
  const ranges = Array.from(
    { length: CALENDAR_NAVIGATION_PRELOAD_MONTH_RADIUS * 2 + 1 },
    (_, index) =>
      rangeForCalendarViewDateKey(
        addMonthsToDateKey(
          anchorDateKey,
          index - CALENDAR_NAVIGATION_PRELOAD_MONTH_RADIUS,
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
