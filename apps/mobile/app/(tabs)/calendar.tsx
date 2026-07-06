import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  RefreshCw,
  UserRound,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DataState } from "@/components/DataState";
import { SkeletonLine, SkeletonRow } from "@/components/LoadingSkeleton";
import { Screen } from "@/components/Screen";
import { SectionCard, SectionHeader, StatusPill } from "@/components/ui";
import { useAuthSession } from "@/features/auth/auth-context";
import {
  addDays,
  addMonths,
  calendarViewLabels,
  eventContactLabel,
  eventsForDay,
  eventsInRange,
  formatDateParam,
  formatEventTime,
  rangeForCalendarView,
  rangeLabel,
  startOfMonth,
  startOfWeek,
  type MobileCalendarView,
} from "@/lib/calendar-utils";
import { mobileCalendarQueryOptions } from "@/lib/mobile-query";
import type { MobileCalendarEvent } from "@/lib/mobile-api-types";
import { colors, radii, typography } from "@/theme";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarScreen() {
  const { session, status } = useAuthSession();
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<MobileCalendarView>("day");
  const queryRange = useMemo(() => {
    const from = startOfWeek(startOfMonth(anchor));
    const to = addDays(startOfWeek(addMonths(anchor, 2)), 7);

    return { from: from.toISOString(), to: to.toISOString() };
  }, [anchor]);
  const calendar = useQuery({
    ...mobileCalendarQueryOptions(session, queryRange),
    enabled: status === "signed-in",
  });
  const events = calendar.data?.events ?? [];
  const visibleEvents = useMemo(
    () =>
      eventsInRange(events, rangeForCalendarView(anchor, view)).sort(
        (left, right) =>
          new Date(left.startsAt ?? left.createdAt).getTime() -
          new Date(right.startsAt ?? right.createdAt).getTime(),
      ),
    [anchor, events, view],
  );
  const todayEvents = useMemo(
    () => eventsForDay(events, new Date()),
    [events],
  );
  const upcomingCount = events.filter((event) => {
    if (!event.startsAt) {
      return false;
    }

    return new Date(event.startsAt).getTime() >= Date.now();
  }).length;

  return (
    <Screen
      compactHeaderEmphasis
      compactHeaderLabel={calendar.data?.workspace.name ?? "Workspace"}
      metrics={[
        {
          label: "Today",
          tone: "cyan",
          value: String(todayEvents.length),
        },
        {
          label: "Upcoming",
          tone: "pink",
          value: String(upcomingCount),
        },
        {
          label: "Visible",
          tone: "purple",
          value: String(visibleEvents.length),
        },
      ]}
      showTopBar={false}
      title="Calendar"
      titleScale="compact"
    >
      <View style={styles.toolbar}>
        <SegmentedControl
          onChange={setView}
          options={(["day", "week", "month"] as const).map((key) => ({
            key,
            label: calendarViewLabels[key],
          }))}
          value={view}
        />
        <Pressable
          accessibilityLabel="Refresh calendar"
          accessibilityRole="button"
          onPress={() => calendar.refetch()}
          style={({ pressed }) => [
            styles.iconButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <RefreshCw color={colors.cyan} size={17} />
        </Pressable>
      </View>

      <SectionCard style={styles.rangeCard}>
        <View style={styles.rangeHeader}>
          <Pressable
            accessibilityLabel="Previous calendar range"
            accessibilityRole="button"
            onPress={() => setAnchor((current) => shiftAnchor(current, view, -1))}
            style={({ pressed }) => [
              styles.iconButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <ChevronLeft color={colors.text} size={18} />
          </Pressable>
          <View style={styles.rangeTitleBlock}>
            <Text style={styles.rangeTitle}>{rangeLabel(anchor, view)}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAnchor(new Date())}
            >
              <Text style={styles.todayLink}>Today</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityLabel="Next calendar range"
            accessibilityRole="button"
            onPress={() => setAnchor((current) => shiftAnchor(current, view, 1))}
            style={({ pressed }) => [
              styles.iconButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <ChevronRight color={colors.text} size={18} />
          </Pressable>
        </View>
      </SectionCard>

      {calendar.isLoading ? <CalendarLoadingState /> : null}
      {!calendar.isLoading && calendar.error ? (
        <DataState
          error={calendar.error}
          loading={false}
          title="Loading calendar"
        />
      ) : null}

      {calendar.data && view === "month" ? (
        <MonthGrid anchor={anchor} events={events} onSelectDate={setAnchor} />
      ) : null}

      {calendar.data ? (
        <SectionCard style={styles.agendaCard}>
          <SectionHeader
            action={<Text style={styles.meta}>{calendarViewLabels[view]}</Text>}
            eyebrow="Agenda"
            title={visibleEvents.length ? "Scheduled work" : "No calendar items"}
          />
          {visibleEvents.length ? (
            <View style={styles.eventList}>
              {visibleEvents.map((event) => (
                <CalendarEventCard event={event} key={event.id} />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>
              Site visits, jobs, and reminders will appear here when Kyro saves
              them to the calendar.
            </Text>
          )}
        </SectionCard>
      ) : null}
    </Screen>
  );
}

function CalendarLoadingState() {
  return (
    <SectionCard style={styles.agendaCard}>
      <SectionHeader eyebrow="Agenda" title="Loading calendar" />
      <SkeletonRow tone="cyan" />
      <SkeletonRow tone="pink" />
      <SkeletonLine width="58%" />
    </SectionCard>
  );
}

function CalendarEventCard({ event }: { event: MobileCalendarEvent }) {
  const openLinkedRecord = () => {
    if (event.conversationId) {
      router.push({
        pathname: "/inbox",
        params: { conversationId: event.conversationId },
      });
      return;
    }

    if (event.contactId) {
      router.push({
        pathname: "/crm",
        params: { contactId: event.contactId },
      });
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={openLinkedRecord}
      style={({ pressed }) => [
        styles.eventCard,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.eventAccent} />
      <View style={styles.eventBody}>
        <View style={styles.eventHeader}>
          <Text numberOfLines={2} style={styles.eventTitle}>
            {event.title}
          </Text>
          <StatusPill label={formatLabel(event.status)} tone="neutral" />
        </View>
        <InfoLine icon="clock" text={formatEventRange(event)} />
        <InfoLine icon="user" text={eventContactLabel(event)} />
        {event.location ? <InfoLine icon="map" text={event.location} /> : null}
      </View>
    </Pressable>
  );
}

function InfoLine({
  icon,
  text,
}: {
  icon: "clock" | "map" | "user";
  text: string;
}) {
  const Icon =
    icon === "clock" ? Clock3 : icon === "map" ? MapPin : UserRound;

  return (
    <View style={styles.infoLine}>
      <Icon color={colors.muted} size={14} />
      <Text numberOfLines={1} style={styles.infoText}>
        {text}
      </Text>
    </View>
  );
}

function MonthGrid({
  anchor,
  events,
  onSelectDate,
}: {
  anchor: Date;
  events: MobileCalendarEvent[];
  onSelectDate: (date: Date) => void;
}) {
  const firstDay = startOfWeek(startOfMonth(anchor));
  const todayKey = formatDateParam(new Date());
  const cells = Array.from({ length: 42 }, (_, index) => addDays(firstDay, index));

  return (
    <SectionCard style={styles.monthCard}>
      <View style={styles.monthGrid}>
        {DAY_NAMES.map((day) => (
          <Text key={day} style={styles.dayName}>
            {day}
          </Text>
        ))}
        {cells.map((day) => {
          const key = formatDateParam(day);
          const dayEvents = eventsForDay(events, day);
          const isMuted = day.getMonth() !== anchor.getMonth();
          const isToday = key === todayKey;

          return (
            <Pressable
              accessibilityRole="button"
              key={key}
              onPress={() => onSelectDate(day)}
              style={[
                styles.monthCell,
                isMuted ? styles.monthCellMuted : null,
                isToday ? styles.monthCellToday : null,
              ]}
            >
              <Text
                style={[
                  styles.monthCellText,
                  isMuted ? styles.monthCellTextMuted : null,
                  isToday ? styles.monthCellTextToday : null,
                ]}
              >
                {day.getDate()}
              </Text>
              {dayEvents.length ? (
                <View style={styles.monthDots}>
                  {dayEvents.slice(0, 3).map((event) => (
                    <View key={event.id} style={styles.monthDot} />
                  ))}
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </SectionCard>
  );
}

function SegmentedControl<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: Array<{ key: T; label: string }>;
  value: T;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable
          accessibilityRole="button"
          key={option.key}
          onPress={() => onChange(option.key)}
          style={[
            styles.segment,
            value === option.key ? styles.segmentActive : null,
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              value === option.key ? styles.segmentTextActive : null,
            ]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function shiftAnchor(date: Date, view: MobileCalendarView, direction: -1 | 1) {
  if (view === "day") {
    return addDays(date, direction);
  }

  if (view === "month") {
    return addMonths(date, direction);
  }

  return addDays(date, direction * 7);
}

function formatEventRange(event: MobileCalendarEvent) {
  if (!event.startsAt) {
    return "Time not set";
  }

  if (!event.endsAt) {
    return formatEventTime(event.startsAt);
  }

  return `${formatEventTime(event.startsAt)} - ${formatEventTime(event.endsAt)}`;
}

function formatLabel(value: string) {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

const styles = StyleSheet.create({
  agendaCard: {
    gap: 12,
  },
  dayName: {
    color: colors.muted,
    flexBasis: "14.28%",
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  emptyText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  eventAccent: {
    backgroundColor: colors.cyan,
    borderRadius: radii.pill,
    alignSelf: "stretch",
    width: 3,
  },
  eventBody: {
    flex: 1,
    gap: 7,
    minWidth: 0,
  },
  eventCard: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  eventHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  eventList: {
    gap: 10,
  },
  eventTitle: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 19,
  },
  iconButton: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  infoLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    minWidth: 0,
  },
  infoText: {
    color: colors.muted,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
  },
  meta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  monthCard: {
    padding: 10,
  },
  monthCell: {
    alignItems: "center",
    aspectRatio: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: "14.28%",
    justifyContent: "center",
    gap: 5,
  },
  monthCellMuted: {
    opacity: 0.38,
  },
  monthCellText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  monthCellTextMuted: {
    color: colors.muted,
  },
  monthCellTextToday: {
    color: colors.background,
  },
  monthCellToday: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  monthDot: {
    backgroundColor: colors.pink,
    borderRadius: radii.pill,
    height: 4,
    width: 4,
  },
  monthDots: {
    flexDirection: "row",
    gap: 3,
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  pressed: {
    opacity: 0.72,
  },
  rangeCard: {
    padding: 10,
  },
  rangeHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  rangeTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  rangeTitleBlock: {
    alignItems: "center",
    flex: 1,
    gap: 2,
  },
  segment: {
    alignItems: "center",
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: 32,
    minWidth: 68,
    paddingHorizontal: 10,
  },
  segmentActive: {
    backgroundColor: colors.surfaceStrong,
  },
  segmented: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3,
  },
  segmentText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  segmentTextActive: {
    color: colors.background,
  },
  todayLink: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
});
