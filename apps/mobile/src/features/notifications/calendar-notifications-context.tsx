import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
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
import { AppState, Platform, type AppStateStatus } from "react-native";

import { useAuthSession } from "@/features/auth/auth-context";
import {
  addDays,
  eventsForDay,
  formatDateParam,
  formatEventTime,
  startOfDay,
} from "@/lib/calendar-utils";
import type { MobileCalendarEvent } from "@/lib/mobile-api-types";
import { mobileCalendarQueryOptions } from "@/lib/mobile-query";

export type CalendarNotificationLeadTime = "15m" | "1h" | "2h" | "24h";
export type CalendarNotificationTone = "quiet" | "loud";
export type CalendarMorningDigestTime = "07:00" | "08:00" | "09:00";

export type CalendarNotificationPreferences = {
  eventRemindersEnabled: boolean;
  leadTime: CalendarNotificationLeadTime;
  morningDigestEnabled: boolean;
  morningDigestTime: CalendarMorningDigestTime;
  tone: CalendarNotificationTone;
};

export type CalendarNotificationPermissionStatus =
  | "denied"
  | "granted"
  | "provisional"
  | "undetermined"
  | "unknown";

type CalendarNotificationsContextValue = {
  calendarLoading: boolean;
  lastError: string | null;
  lastScheduledAt: string | null;
  permissionStatus: CalendarNotificationPermissionStatus;
  preferences: CalendarNotificationPreferences;
  preferencesLoaded: boolean;
  refreshPermissionStatus: () => Promise<CalendarNotificationPermissionStatus>;
  scheduledCount: number;
  updatePreferences: (
    patch: Partial<CalendarNotificationPreferences>,
  ) => Promise<void>;
};

const CALENDAR_NOTIFICATION_STORAGE_KEY =
  "kyro.calendarNotifications.preferences.v1";
const CALENDAR_NOTIFICATION_DATA_KIND = "kyro-calendar-notification";
const CALENDAR_NOTIFICATION_LOOKAHEAD_DAYS = 45;
const MAX_LOCAL_NOTIFICATIONS = 60;
const MAX_DIGEST_DAYS = 14;
const LOUD_CHANNEL_ID = "kyro-calendar-loud";
const QUIET_CHANNEL_ID = "kyro-calendar-quiet";

export const calendarNotificationLeadTimeOptions: Array<{
  label: string;
  value: CalendarNotificationLeadTime;
}> = [
  { label: "15 min", value: "15m" },
  { label: "1 hr", value: "1h" },
  { label: "2 hr", value: "2h" },
  { label: "24 hr", value: "24h" },
];

export const calendarNotificationToneOptions: Array<{
  label: string;
  value: CalendarNotificationTone;
}> = [
  { label: "Quiet", value: "quiet" },
  { label: "Loud", value: "loud" },
];

export const calendarMorningDigestTimeOptions: Array<{
  label: string;
  value: CalendarMorningDigestTime;
}> = [
  { label: "7:00 am", value: "07:00" },
  { label: "8:00 am", value: "08:00" },
  { label: "9:00 am", value: "09:00" },
];

export const defaultCalendarNotificationPreferences: CalendarNotificationPreferences =
  {
    eventRemindersEnabled: false,
    leadTime: "1h",
    morningDigestEnabled: false,
    morningDigestTime: "07:00",
    tone: "quiet",
  };

const CalendarNotificationsContext =
  createContext<CalendarNotificationsContextValue | null>(null);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    priority: Notifications.AndroidNotificationPriority.HIGH,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function CalendarNotificationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { session, status } = useAuthSession();
  const [preferences, setPreferences] =
    useState<CalendarNotificationPreferences>(
      defaultCalendarNotificationPreferences,
    );
  const preferencesRef = useRef(preferences);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<CalendarNotificationPermissionStatus>("unknown");
  const [lastError, setLastError] = useState<string | null>(null);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [lastScheduledAt, setLastScheduledAt] = useState<string | null>(null);
  const [rangeVersion, setRangeVersion] = useState(0);
  const lastScheduleSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(CALENDAR_NOTIFICATION_STORAGE_KEY)
      .then((stored) => {
        if (!mounted) {
          return;
        }

        setPreferences(normalizeCalendarNotificationPreferences(stored));
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) {
          setPreferencesLoaded(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const refreshPermissionStatus = useCallback(async () => {
    const nextStatus = await readCalendarNotificationPermissionStatus();
    setPermissionStatus(nextStatus);
    return nextStatus;
  }, []);

  useEffect(() => {
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;

        if (data?.kind !== CALENDAR_NOTIFICATION_DATA_KIND) {
          return;
        }

        const eventId = typeof data.eventId === "string" ? data.eventId : null;

        if (eventId) {
          router.push({
            pathname: "/calendar" as never,
            params: { eventId },
          });
          return;
        }

        router.push("/calendar" as never);
      },
    );

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          setRangeVersion((current) => current + 1);
          void refreshPermissionStatus();
        }
      },
    );

    return () => subscription.remove();
  }, [refreshPermissionStatus]);

  const calendarRange = useMemo(() => {
    void rangeVersion;
    const from = startOfDay(new Date());
    const to = addDays(from, CALENDAR_NOTIFICATION_LOOKAHEAD_DAYS);

    return { from: from.toISOString(), to: to.toISOString() };
  }, [rangeVersion]);

  const hasEnabledPreferences =
    preferences.eventRemindersEnabled || preferences.morningDigestEnabled;
  const calendar = useQuery({
    ...mobileCalendarQueryOptions(session, calendarRange),
    enabled:
      status === "signed-in" && preferencesLoaded && hasEnabledPreferences,
  });

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    if (status !== "signed-in" || !hasEnabledPreferences) {
      lastScheduleSignatureRef.current = null;
      void cancelKyroCalendarNotifications()
        .then(() => {
          setScheduledCount(0);
          setLastScheduledAt(null);
        })
        .catch(() => undefined);
      return;
    }

    if (!permissionAllowsNotifications(permissionStatus)) {
      return;
    }

    if (calendar.isLoading || !calendar.data) {
      return;
    }

    if (calendar.error) {
      setLastError("Calendar notifications will retry when calendar loads.");
      return;
    }

    const signature = buildScheduleSignature(
      calendar.data.events,
      preferences,
      session?.user.id,
    );

    if (signature === lastScheduleSignatureRef.current) {
      return;
    }

    lastScheduleSignatureRef.current = signature;
    let cancelled = false;

    void scheduleKyroCalendarNotifications(
      calendar.data.events,
      preferences,
    )
      .then((count) => {
        if (cancelled) {
          return;
        }

        setScheduledCount(count);
        setLastError(null);
        setLastScheduledAt(new Date().toISOString());
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        lastScheduleSignatureRef.current = null;
        setLastError(
          error instanceof Error
            ? error.message
            : "Calendar notifications could not be scheduled.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    calendar.data,
    calendar.error,
    calendar.isLoading,
    hasEnabledPreferences,
    permissionStatus,
    preferences,
    preferencesLoaded,
    session?.user.id,
    status,
  ]);

  const updatePreferences = useCallback(
    async (patch: Partial<CalendarNotificationPreferences>) => {
      let next = normalizeCalendarNotificationPreferences({
        ...preferencesRef.current,
        ...patch,
      });

      if (
        next.eventRemindersEnabled ||
        next.morningDigestEnabled
      ) {
        const allowed = await requestCalendarNotificationPermission();

        if (!allowed) {
          next = {
            ...next,
            eventRemindersEnabled: false,
            morningDigestEnabled: false,
          };
          setLastError(
            "Notification permission is off. Enable notifications for Kyro in device settings, then turn reminders back on.",
          );
        } else {
          setLastError(null);
        }

        await refreshPermissionStatus();
      }

      preferencesRef.current = next;
      setPreferences(next);
      lastScheduleSignatureRef.current = null;
      await AsyncStorage.setItem(
        CALENDAR_NOTIFICATION_STORAGE_KEY,
        JSON.stringify(next),
      );
    },
    [refreshPermissionStatus],
  );

  const value = useMemo<CalendarNotificationsContextValue>(
    () => ({
      calendarLoading: calendar.isLoading,
      lastError,
      lastScheduledAt,
      permissionStatus,
      preferences,
      preferencesLoaded,
      refreshPermissionStatus,
      scheduledCount,
      updatePreferences,
    }),
    [
      calendar.isLoading,
      lastError,
      lastScheduledAt,
      permissionStatus,
      preferences,
      preferencesLoaded,
      refreshPermissionStatus,
      scheduledCount,
      updatePreferences,
    ],
  );

  return (
    <CalendarNotificationsContext.Provider value={value}>
      {children}
    </CalendarNotificationsContext.Provider>
  );
}

export function useCalendarNotifications() {
  const context = useContext(CalendarNotificationsContext);

  if (!context) {
    throw new Error(
      "useCalendarNotifications must be used inside CalendarNotificationsProvider",
    );
  }

  return context;
}

export function calendarNotificationPermissionLabel(
  status: CalendarNotificationPermissionStatus,
) {
  if (status === "granted") {
    return "Allowed";
  }

  if (status === "provisional") {
    return "Quietly allowed";
  }

  if (status === "denied") {
    return "Blocked";
  }

  if (status === "undetermined") {
    return "Not requested";
  }

  return "Checking";
}

function normalizeCalendarNotificationPreferences(
  input:
    | Partial<CalendarNotificationPreferences>
    | string
    | null
    | undefined,
): CalendarNotificationPreferences {
  let parsed: Partial<CalendarNotificationPreferences> | null = null;

  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as Partial<CalendarNotificationPreferences>;
    } catch {
      parsed = null;
    }
  } else {
    parsed = input ?? null;
  }

  return {
    eventRemindersEnabled: Boolean(parsed?.eventRemindersEnabled),
    leadTime: isCalendarNotificationLeadTime(parsed?.leadTime)
      ? parsed.leadTime
      : defaultCalendarNotificationPreferences.leadTime,
    morningDigestEnabled: Boolean(parsed?.morningDigestEnabled),
    morningDigestTime: isCalendarMorningDigestTime(parsed?.morningDigestTime)
      ? parsed.morningDigestTime
      : defaultCalendarNotificationPreferences.morningDigestTime,
    tone: parsed?.tone === "loud" ? "loud" : "quiet",
  };
}

function isCalendarNotificationLeadTime(
  value: unknown,
): value is CalendarNotificationLeadTime {
  return value === "15m" || value === "1h" || value === "2h" || value === "24h";
}

function isCalendarMorningDigestTime(
  value: unknown,
): value is CalendarMorningDigestTime {
  return value === "07:00" || value === "08:00" || value === "09:00";
}

async function readCalendarNotificationPermissionStatus(): Promise<CalendarNotificationPermissionStatus> {
  try {
    const status = await Notifications.getPermissionsAsync();

    return permissionStatusFromResponse(status);
  } catch {
    return "unknown";
  }
}

async function requestCalendarNotificationPermission() {
  const current = await readCalendarNotificationPermissionStatus();

  if (permissionAllowsNotifications(current)) {
    return true;
  }

  try {
    const next = await Notifications.requestPermissionsAsync({
      android: {},
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });

    return permissionAllowsNotifications(permissionStatusFromResponse(next));
  } catch {
    return false;
  }
}

function permissionStatusFromResponse(
  response: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>,
): CalendarNotificationPermissionStatus {
  if (response.granted) {
    return "granted";
  }

  if (
    response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return "provisional";
  }

  if (String(response.status).toLowerCase() === "denied") {
    return "denied";
  }

  if (String(response.status).toLowerCase() === "undetermined") {
    return "undetermined";
  }

  return "unknown";
}

function permissionAllowsNotifications(
  status: CalendarNotificationPermissionStatus,
) {
  return status === "granted" || status === "provisional";
}

async function scheduleKyroCalendarNotifications(
  events: MobileCalendarEvent[],
  preferences: CalendarNotificationPreferences,
) {
  await configureCalendarNotificationChannels();
  await cancelKyroCalendarNotifications();

  let scheduled = 0;

  if (preferences.eventRemindersEnabled) {
    const reminderEvents = upcomingCalendarEvents(events);

    for (const event of reminderEvents) {
      if (scheduled >= MAX_LOCAL_NOTIFICATIONS) {
        break;
      }

      const reminderDate = reminderDateForEvent(event, preferences.leadTime);

      if (!reminderDate) {
        continue;
      }

      await Notifications.scheduleNotificationAsync({
        content: notificationContentForEventReminder(event, preferences),
        identifier: `kyro-calendar-reminder-${event.id}-${preferences.leadTime}`,
        trigger: {
          channelId: channelIdForTone(preferences.tone),
          date: reminderDate,
          type: Notifications.SchedulableTriggerInputTypes.DATE,
        },
      });
      scheduled += 1;
    }
  }

  if (preferences.morningDigestEnabled) {
    const digestDays = calendarDigestDays(preferences.morningDigestTime);

    for (const day of digestDays) {
      if (scheduled >= MAX_LOCAL_NOTIFICATIONS) {
        break;
      }

      await Notifications.scheduleNotificationAsync({
        content: notificationContentForMorningDigest(
          day,
          eventsForDay(events, day),
          preferences,
        ),
        identifier: `kyro-calendar-digest-${formatDateParam(day)}`,
        trigger: {
          channelId: channelIdForTone(preferences.tone),
          date: day,
          type: Notifications.SchedulableTriggerInputTypes.DATE,
        },
      });
      scheduled += 1;
    }
  }

  return scheduled;
}

async function configureCalendarNotificationChannels() {
  if (Platform.OS !== "android") {
    return;
  }

  await Promise.all([
    Notifications.setNotificationChannelAsync(QUIET_CHANNEL_ID, {
      enableVibrate: false,
      importance: Notifications.AndroidImportance.DEFAULT,
      name: "Kyro calendar quiet",
      sound: null,
    }),
    Notifications.setNotificationChannelAsync(LOUD_CHANNEL_ID, {
      enableVibrate: true,
      importance: Notifications.AndroidImportance.HIGH,
      name: "Kyro calendar loud",
      sound: "default",
      vibrationPattern: [0, 240, 140, 240],
    }),
  ]);
}

async function cancelKyroCalendarNotifications() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const cancellable = scheduled.filter(
    (notification) =>
      notification.content.data?.kind === CALENDAR_NOTIFICATION_DATA_KIND ||
      notification.identifier.startsWith("kyro-calendar-"),
  );

  await Promise.all(
    cancellable.map((notification) =>
      Notifications.cancelScheduledNotificationAsync(notification.identifier),
    ),
  );
}

function notificationContentForEventReminder(
  event: MobileCalendarEvent,
  preferences: CalendarNotificationPreferences,
): Notifications.NotificationContentInput {
  const contact = event.contact?.name ?? event.contact?.company ?? null;
  const time = formatEventTime(event.startsAt);
  const location = event.location ? ` · ${event.location}` : "";

  return {
    body: `${leadTimeLabel(preferences.leadTime)} before · ${time}${location}`,
    color: "#51e5ff",
    data: {
      eventId: event.id,
      kind: CALENDAR_NOTIFICATION_DATA_KIND,
      notificationType: "event_reminder",
    },
    interruptionLevel: preferences.tone === "loud" ? "active" : "passive",
    priority:
      preferences.tone === "loud"
        ? Notifications.AndroidNotificationPriority.HIGH
        : Notifications.AndroidNotificationPriority.DEFAULT,
    sound: preferences.tone === "loud" ? "default" : false,
    subtitle: contact ?? undefined,
    title: event.title || "Upcoming Kyro calendar item",
  };
}

function notificationContentForMorningDigest(
  day: Date,
  events: MobileCalendarEvent[],
  preferences: CalendarNotificationPreferences,
): Notifications.NotificationContentInput {
  const sorted = upcomingCalendarEvents(events, day).slice(0, 4);
  const count = events.filter((event) => isActiveCalendarEvent(event)).length;
  const body = sorted.length
    ? `${count} ${count === 1 ? "event" : "events"} today: ${sorted
        .map((event) => `${formatEventTime(event.startsAt)} ${event.title}`)
        .join("; ")}${count > sorted.length ? `; +${count - sorted.length} more` : ""}`
    : "No Kyro calendar items booked today.";

  return {
    body,
    color: "#51e5ff",
    data: {
      eventDate: formatDateParam(day),
      kind: CALENDAR_NOTIFICATION_DATA_KIND,
      notificationType: "morning_digest",
    },
    interruptionLevel: preferences.tone === "loud" ? "active" : "passive",
    priority:
      preferences.tone === "loud"
        ? Notifications.AndroidNotificationPriority.HIGH
        : Notifications.AndroidNotificationPriority.DEFAULT,
    sound: preferences.tone === "loud" ? "default" : false,
    title: "Today's Kyro calendar",
  };
}

function upcomingCalendarEvents(events: MobileCalendarEvent[], from = new Date()) {
  const fromTime = from.getTime();

  return events
    .filter((event) => {
      if (!isActiveCalendarEvent(event) || !event.startsAt) {
        return false;
      }

      const startsAt = new Date(event.startsAt).getTime();
      return Number.isFinite(startsAt) && startsAt >= fromTime;
    })
    .sort(
      (left, right) =>
        new Date(left.startsAt ?? left.createdAt).getTime() -
        new Date(right.startsAt ?? right.createdAt).getTime(),
    );
}

function isActiveCalendarEvent(event: MobileCalendarEvent) {
  return event.status !== "cancelled" && event.status !== "completed";
}

function reminderDateForEvent(
  event: MobileCalendarEvent,
  leadTime: CalendarNotificationLeadTime,
) {
  if (!event.startsAt) {
    return null;
  }

  const startsAt = new Date(event.startsAt).getTime();

  if (!Number.isFinite(startsAt)) {
    return null;
  }

  const reminderAt = startsAt - leadTimeMinutes(leadTime) * 60 * 1000;

  if (reminderAt <= Date.now() + 30 * 1000) {
    return null;
  }

  return new Date(reminderAt);
}

function calendarDigestDays(time: CalendarMorningDigestTime) {
  const [hour, minute] = time.split(":").map(Number);
  const firstDay = startOfDay(new Date());
  const days: Date[] = [];

  for (let index = 0; index < MAX_DIGEST_DAYS; index += 1) {
    const day = addDays(firstDay, index);
    day.setHours(hour, minute, 0, 0);

    if (day.getTime() > Date.now() + 30 * 1000) {
      days.push(day);
    }
  }

  return days;
}

function buildScheduleSignature(
  events: MobileCalendarEvent[],
  preferences: CalendarNotificationPreferences,
  userId?: string | null,
) {
  return JSON.stringify({
    events: events
      .map((event) => ({
        id: event.id,
        startsAt: event.startsAt,
        status: event.status,
        title: event.title,
        updatedAt: event.updatedAt,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    preferences,
    userId,
  });
}

function leadTimeMinutes(leadTime: CalendarNotificationLeadTime) {
  if (leadTime === "15m") {
    return 15;
  }

  if (leadTime === "2h") {
    return 120;
  }

  if (leadTime === "24h") {
    return 24 * 60;
  }

  return 60;
}

function leadTimeLabel(leadTime: CalendarNotificationLeadTime) {
  return (
    calendarNotificationLeadTimeOptions.find(
      (option) => option.value === leadTime,
    )?.label ?? "1 hr"
  );
}

function channelIdForTone(tone: CalendarNotificationTone) {
  return tone === "loud" ? LOUD_CHANNEL_ID : QUIET_CHANNEL_ID;
}
