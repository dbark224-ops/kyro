import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  Save,
  Trash2,
  UserRound,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

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
import { kyroApiFetch } from "@/lib/kyro-api";
import {
  mobileCalendarQueryOptions,
  mobileQueryKeys,
} from "@/lib/mobile-query";
import type {
  MobileCalendarEvent,
  MobileCalendarEventMutationInput,
  MobileCalendarEventMutationResponse,
} from "@/lib/mobile-api-types";
import { colors, radii, typography } from "@/theme";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EVENT_TYPES = [
  "quote_visit",
  "job",
  "follow_up",
  "site_visit",
  "internal",
  "other",
] as const;
const EVENT_STATUSES = [
  "scheduled",
  "suggested",
  "completed",
  "cancelled",
] as const;

type CalendarEditorState = {
  event: MobileCalendarEvent | null;
  mode: "create" | "edit";
} | null;

export default function CalendarScreen() {
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<MobileCalendarView>("day");
  const [editor, setEditor] = useState<CalendarEditorState>(null);
  const queryRange = useMemo(() => {
    const from = startOfWeek(startOfMonth(anchor));
    const to = addDays(startOfWeek(addMonths(anchor, 2)), 7);

    return { from: from.toISOString(), to: to.toISOString() };
  }, [anchor]);
  const calendar = useQuery({
    ...mobileCalendarQueryOptions(session, queryRange),
    enabled: status === "signed-in",
  });
  const invalidateCalendar = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["mobile-calendar", session?.user.id],
      }),
      queryClient.invalidateQueries({
        queryKey: mobileQueryKeys.dashboard(session?.user.id),
      }),
    ]);
  const saveEventMutation = useMutation({
    mutationFn: ({
      eventId,
      input,
      mode,
    }: {
      eventId?: string;
      input: MobileCalendarEventMutationInput;
      mode: "create" | "edit";
    }) =>
      kyroApiFetch<MobileCalendarEventMutationResponse>(
        "/api/mobile/calendar",
        {
          body: mode === "edit" ? { ...input, eventId } : input,
          method: mode === "edit" ? "PATCH" : "POST",
          session,
        },
      ),
    onSuccess: async (payload) => {
      if (payload.event?.startsAt) {
        setAnchor(new Date(payload.event.startsAt));
      }

      setEditor(null);
      await invalidateCalendar();
    },
  });
  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) =>
      kyroApiFetch<MobileCalendarEventMutationResponse>(
        "/api/mobile/calendar",
        {
          body: { eventId },
          method: "DELETE",
          session,
        },
      ),
    onSuccess: async () => {
      setEditor(null);
      await invalidateCalendar();
    },
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
  const agendaEvents = useMemo(
    () =>
      (view === "month" ? eventsForDay(events, anchor) : visibleEvents).sort(
        (left, right) =>
          new Date(left.startsAt ?? left.createdAt).getTime() -
          new Date(right.startsAt ?? right.createdAt).getTime(),
      ),
    [anchor, events, view, visibleEvents],
  );
  const todayEvents = useMemo(() => eventsForDay(events, new Date()), [events]);
  const upcomingCount = events.filter((event) => {
    if (!event.startsAt) {
      return false;
    }

    return new Date(event.startsAt).getTime() >= Date.now();
  }).length;

  if (editor) {
    return (
      <Screen
        compactHeaderEmphasis
        compactHeaderLabel={calendar.data?.workspace.name ?? "Workspace"}
        showTopBar={false}
        title={editor.mode === "create" ? "Add event" : "Event"}
        titleScale="compact"
      >
        <Pressable
          accessibilityLabel="Back to calendar"
          accessibilityRole="button"
          onPress={() => setEditor(null)}
          style={({ pressed }) => [
            styles.backLink,
            pressed ? styles.pressed : null,
          ]}
        >
          <ChevronLeft color={colors.text} size={17} />
          <Text style={styles.backLinkText}>Calendar</Text>
        </Pressable>
        <CalendarEventEditor
          anchor={anchor}
          busy={saveEventMutation.isPending || deleteEventMutation.isPending}
          error={
            saveEventMutation.error instanceof Error
              ? saveEventMutation.error.message
              : deleteEventMutation.error instanceof Error
                ? deleteEventMutation.error.message
                : null
          }
          state={editor}
          onDelete={(eventId) => deleteEventMutation.mutate(eventId)}
          onSave={(input, eventId) =>
            saveEventMutation.mutate({
              eventId,
              input,
              mode: editor.mode,
            })
          }
        />
      </Screen>
    );
  }

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
          accessibilityLabel="Add calendar event"
          accessibilityRole="button"
          onPress={() => setEditor({ event: null, mode: "create" })}
          style={({ pressed }) => [
            styles.addButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <Plus color={colors.background} size={15} />
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      <SectionCard style={styles.rangeCard}>
        <View style={styles.rangeHeader}>
          <Pressable
            accessibilityLabel="Previous calendar range"
            accessibilityRole="button"
            onPress={() =>
              setAnchor((current) => shiftAnchor(current, view, -1))
            }
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
            onPress={() =>
              setAnchor((current) => shiftAnchor(current, view, 1))
            }
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
            action={
              <Text style={styles.meta}>{agendaLabel(anchor, view)}</Text>
            }
            eyebrow="Agenda"
            title={agendaEvents.length ? "Scheduled work" : "No calendar items"}
          />
          {agendaEvents.length ? (
            view === "week" ? (
              <WeekAgenda
                events={agendaEvents}
                onSelectEvent={(event) => setEditor({ event, mode: "edit" })}
              />
            ) : (
              <View style={styles.eventList}>
                {agendaEvents.map((event) => (
                  <CalendarEventCard
                    event={event}
                    key={event.id}
                    onPress={() => setEditor({ event, mode: "edit" })}
                  />
                ))}
              </View>
            )
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

function WeekAgenda({
  events,
  onSelectEvent,
}: {
  events: MobileCalendarEvent[];
  onSelectEvent: (event: MobileCalendarEvent) => void;
}) {
  const groups = groupEventsByDay(events);

  return (
    <View style={styles.agendaGroups}>
      {groups.map((group) => (
        <View key={group.key} style={styles.agendaGroup}>
          <Text style={styles.agendaDateHeader}>{group.label}</Text>
          <View style={styles.eventList}>
            {group.events.map((event) => (
              <CalendarEventCard
                event={event}
                key={event.id}
                onPress={() => onSelectEvent(event)}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
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

function CalendarEventCard({
  event,
  onPress,
}: {
  event: MobileCalendarEvent;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
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

type CalendarFormState = {
  appointmentType: string;
  description: string;
  endDate: string;
  endTime: string;
  location: string;
  startDate: string;
  startTime: string;
  status: string;
  title: string;
};

function CalendarEventEditor({
  anchor,
  busy,
  error,
  onDelete,
  onSave,
  state,
}: {
  anchor: Date;
  busy: boolean;
  error: string | null;
  onDelete: (eventId: string) => void;
  onSave: (input: MobileCalendarEventMutationInput, eventId?: string) => void;
  state: NonNullable<CalendarEditorState>;
}) {
  const [form, setForm] = useState(() => formFromEditorState(state, anchor));
  const [localError, setLocalError] = useState<string | null>(null);
  const event = state.event;
  const linkedContact = event?.contact;
  const linkedLead = event?.lead;

  useEffect(() => {
    setForm(formFromEditorState(state, anchor));
    setLocalError(null);
  }, [anchor, state]);

  const updateForm = (field: keyof CalendarFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setLocalError(null);
  };

  const saveEvent = () => {
    const title = form.title.trim();

    if (!title) {
      setLocalError("Add an event title first.");
      return;
    }

    const start = isoFromDateAndTime(form.startDate, form.startTime, "start");
    const end = isoFromDateAndTime(form.endDate, form.endTime, "end");

    if (start.error || end.error) {
      setLocalError(start.error ?? end.error);
      return;
    }

    if (
      start.value &&
      end.value &&
      Date.parse(end.value) <= Date.parse(start.value)
    ) {
      setLocalError("The end time needs to be after the start time.");
      return;
    }

    onSave(
      {
        appointmentType: form.appointmentType,
        contactId: event?.contactId ?? null,
        conversationId: event?.conversationId ?? null,
        description: nullableFormText(form.description),
        endsAt: end.value,
        leadId: event?.leadId ?? null,
        location: nullableFormText(form.location),
        startsAt: start.value,
        status: form.status,
        title,
      },
      event?.id,
    );
  };

  const confirmDelete = () => {
    if (!event) {
      return;
    }

    Alert.alert("Delete event", "Remove this event from Kyro calendar?", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => onDelete(event.id),
        style: "destructive",
        text: "Delete",
      },
    ]);
  };

  const openLinkedInquiry = () => {
    if (event?.conversationId) {
      router.push({
        pathname: "/inbox",
        params: { conversationId: event.conversationId },
      });
    }
  };

  const openLinkedContact = () => {
    if (event?.contactId) {
      router.push({
        pathname: "/crm",
        params: { contactId: event.contactId },
      });
    }
  };

  return (
    <View style={styles.editorStack}>
      <SectionCard style={styles.editorCard}>
        <View style={styles.editorHeader}>
          <View style={styles.editorIcon}>
            <CalendarDays color={colors.cyan} size={18} />
          </View>
          <View style={styles.editorTitleBlock}>
            <Text style={styles.editorEyebrow}>Calendar event</Text>
            <Text style={styles.editorTitle}>
              {state.mode === "create" ? "New calendar item" : event?.title}
            </Text>
          </View>
          {event ? (
            <StatusPill label={formatLabel(event.status)} tone="neutral" />
          ) : null}
        </View>

        <FieldLabel label="Title">
          <TextInput
            autoCapitalize="sentences"
            editable={!busy}
            onChangeText={(value) => updateForm("title", value)}
            placeholder="Quote visit, job, call back..."
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={form.title}
          />
        </FieldLabel>

        <FieldLabel label="Type">
          <OptionGroup
            disabled={busy}
            onChange={(value) => updateForm("appointmentType", value)}
            options={EVENT_TYPES.map((type) => ({
              key: type,
              label: formatLabel(type),
            }))}
            value={form.appointmentType}
          />
        </FieldLabel>

        <FieldLabel label="Status">
          <OptionGroup
            disabled={busy}
            onChange={(value) => updateForm("status", value)}
            options={EVENT_STATUSES.map((status) => ({
              key: status,
              label: formatLabel(status),
            }))}
            value={form.status}
          />
        </FieldLabel>

        <View style={styles.dateGrid}>
          <FieldLabel label="Start date">
            <TextInput
              editable={!busy}
              keyboardType="numbers-and-punctuation"
              onChangeText={(value) => updateForm("startDate", value)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={form.startDate}
            />
          </FieldLabel>
          <FieldLabel label="Start time">
            <TextInput
              editable={!busy}
              keyboardType="numbers-and-punctuation"
              onChangeText={(value) => updateForm("startTime", value)}
              placeholder="HH:MM"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={form.startTime}
            />
          </FieldLabel>
          <FieldLabel label="End date">
            <TextInput
              editable={!busy}
              keyboardType="numbers-and-punctuation"
              onChangeText={(value) => updateForm("endDate", value)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={form.endDate}
            />
          </FieldLabel>
          <FieldLabel label="End time">
            <TextInput
              editable={!busy}
              keyboardType="numbers-and-punctuation"
              onChangeText={(value) => updateForm("endTime", value)}
              placeholder="HH:MM"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={form.endTime}
            />
          </FieldLabel>
        </View>

        <FieldLabel label="Address">
          <CalendarAddressInput
            disabled={busy}
            onChange={(value) => updateForm("location", value)}
            value={form.location}
          />
        </FieldLabel>

        <FieldLabel label="Notes">
          <TextInput
            editable={!busy}
            multiline
            onChangeText={(value) => updateForm("description", value)}
            placeholder="Access notes, customer preference, quote details..."
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.textArea]}
            textAlignVertical="top"
            value={form.description}
          />
        </FieldLabel>

        {localError || error ? (
          <Text style={styles.errorText}>{localError ?? error}</Text>
        ) : null}

        <View style={styles.editorActions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={saveEvent}
            style={({ pressed }) => [
              styles.saveButton,
              busy ? styles.disabled : null,
              pressed && !busy ? styles.pressed : null,
            ]}
          >
            <Save color={colors.background} size={15} />
            <Text style={styles.saveButtonText}>
              {state.mode === "create" ? "Create event" : "Save event"}
            </Text>
          </Pressable>
          {event ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={confirmDelete}
              style={({ pressed }) => [
                styles.deleteButton,
                busy ? styles.disabled : null,
                pressed && !busy ? styles.pressed : null,
              ]}
            >
              <Trash2 color={colors.pink} size={15} />
              <Text style={styles.deleteButtonText}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      </SectionCard>

      {event ? (
        <SectionCard style={styles.detailCard}>
          <SectionHeader
            eyebrow="Linked records"
            title={
              linkedContact || linkedLead
                ? eventContactLabel(event)
                : "No linked customer"
            }
          />
          <View style={styles.detailGrid}>
            <DetailLine label="Contact" value={linkedContact?.name} />
            <DetailLine label="Email" value={linkedContact?.email} />
            <DetailLine label="Phone" value={linkedContact?.phone} />
            <DetailLine label="Lead" value={linkedLead?.title} />
          </View>
          <View style={styles.secondaryActions}>
            {event.conversationId ? (
              <Pressable
                accessibilityRole="button"
                onPress={openLinkedInquiry}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Open inquiry</Text>
                <ChevronRight color={colors.cyan} size={15} />
              </Pressable>
            ) : null}
            {event.contactId ? (
              <Pressable
                accessibilityRole="button"
                onPress={openLinkedContact}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Open contact</Text>
                <ChevronRight color={colors.cyan} size={15} />
              </Pressable>
            ) : null}
          </View>
        </SectionCard>
      ) : null}

      <SectionCard style={styles.syncCard}>
        <Text style={styles.syncTitle}>Calendar sync</Text>
        <Text style={styles.syncText}>
          {event
            ? syncDescription(event)
            : "New events write back to Google or Outlook when a connected calendar is available."}
        </Text>
      </SectionCard>
    </View>
  );
}

function FieldLabel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function OptionGroup({
  disabled,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  options: Array<{ key: string; label: string }>;
  value: string;
}) {
  return (
    <View style={styles.optionGroup}>
      {options.map((option) => {
        const active = value === option.key;

        return (
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            key={option.key}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [
              styles.optionPill,
              active ? styles.optionPillActive : null,
              pressed && !disabled ? styles.pressed : null,
            ]}
          >
            <Text
              style={[
                styles.optionText,
                active ? styles.optionTextActive : null,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type MobileAddressSuggestion = {
  description: string;
  mainText: string;
  placeId: string;
  secondaryText: string | null;
};

type MobileStructuredAddress = {
  formattedAddress: string | null;
  validationMessage: string | null;
};

function CalendarAddressInput({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const { session } = useAuthSession();
  const [suggestions, setSuggestions] = useState<MobileAddressSuggestion[]>([]);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectingPlaceId, setSelectingPlaceId] = useState<string | null>(null);
  const selectedFormattedAddress = useRef<string | null>(null);
  const sessionToken = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const query = value.trim();

  useEffect(() => {
    if (
      disabled ||
      !session ||
      query.length < 3 ||
      selectedFormattedAddress.current === query
    ) {
      setBusy(false);
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setLookupMessage(null);

    const timer = setTimeout(() => {
      kyroApiFetch<{
        data: MobileAddressSuggestion[];
        unavailable?: boolean;
      }>("/api/mobile/addresses/autocomplete", {
        query: {
          q: query,
          sessionToken: sessionToken.current,
          type: "address",
        },
        session,
      })
        .then((payload) => {
          if (cancelled) {
            return;
          }

          setSuggestions(payload.data ?? []);
          setLookupMessage(
            payload.unavailable ? "Address lookup is unavailable." : null,
          );
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
            setLookupMessage("Address lookup is unavailable.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setBusy(false);
          }
        });
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [disabled, query, session]);

  const selectSuggestion = (suggestion: MobileAddressSuggestion) => {
    if (!session) {
      onChange(suggestion.description);
      setSuggestions([]);
      return;
    }

    setSelectingPlaceId(suggestion.placeId);
    setLookupMessage(null);

    kyroApiFetch<{
      data: MobileStructuredAddress | null;
      unavailable?: boolean;
    }>("/api/mobile/addresses/place", {
      query: {
        placeId: suggestion.placeId,
        sessionToken: sessionToken.current,
      },
      session,
    })
      .then((payload) => {
        const nextValue =
          payload.data?.formattedAddress || suggestion.description;

        selectedFormattedAddress.current = nextValue;
        onChange(nextValue);
        setSuggestions([]);
        setLookupMessage(payload.data?.validationMessage ?? null);
        sessionToken.current = `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;
      })
      .catch(() => {
        onChange(suggestion.description);
        setSuggestions([]);
        setLookupMessage("Address details are unavailable.");
      })
      .finally(() => setSelectingPlaceId(null));
  };

  return (
    <View style={styles.addressBox}>
      <TextInput
        autoCapitalize="words"
        editable={!disabled}
        multiline
        onChangeText={(text) => {
          selectedFormattedAddress.current = null;
          onChange(text);
          setLookupMessage(null);
        }}
        placeholder="Start typing the event address..."
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.addressInput]}
        textAlignVertical="top"
        value={value}
      />
      {suggestions.length ? (
        <View style={styles.suggestionMenu}>
          {suggestions.slice(0, 5).map((suggestion) => (
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(selectingPlaceId)}
              key={suggestion.placeId || suggestion.description}
              onPress={() => selectSuggestion(suggestion)}
              style={styles.suggestionRow}
            >
              <View style={styles.suggestionTextBlock}>
                <Text numberOfLines={1} style={styles.suggestionTitle}>
                  {suggestion.mainText || suggestion.description}
                </Text>
                {suggestion.secondaryText ? (
                  <Text numberOfLines={1} style={styles.suggestionMeta}>
                    {suggestion.secondaryText}
                  </Text>
                ) : null}
              </View>
              <ChevronRight color={colors.cyan} size={15} />
            </Pressable>
          ))}
          <Text style={styles.googleAttribution}>Powered by Google</Text>
        </View>
      ) : null}
      {busy ? (
        <Text style={styles.lookupMeta}>Searching addresses...</Text>
      ) : null}
      {selectingPlaceId ? (
        <Text style={styles.lookupMeta}>Verifying address...</Text>
      ) : null}
      {lookupMessage ? (
        <Text style={styles.lookupMeta}>{lookupMessage}</Text>
      ) : null}
    </View>
  );
}

function DetailLine({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.detailValue}>
        {value?.trim() || "-"}
      </Text>
    </View>
  );
}

function InfoLine({
  icon,
  text,
}: {
  icon: "clock" | "map" | "user";
  text: string;
}) {
  const Icon = icon === "clock" ? Clock3 : icon === "map" ? MapPin : UserRound;

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
  const cells = monthCells(anchor);
  const todayKey = formatDateParam(new Date());
  const selectedKey = formatDateParam(anchor);
  const rows = chunkWeeks(cells);

  return (
    <SectionCard style={styles.monthCard}>
      <View style={styles.monthGrid}>
        <View style={styles.monthWeekRow}>
          {DAY_NAMES.map((day) => (
            <Text key={day} style={styles.dayName}>
              {day}
            </Text>
          ))}
        </View>
        {rows.map((week) => (
          <View key={formatDateParam(week[0])} style={styles.monthWeekRow}>
            {week.map((day) => {
              const key = formatDateParam(day);
              const dayEvents = eventsForDay(events, day);
              const isMuted = day.getMonth() !== anchor.getMonth();
              const isToday = key === todayKey;
              const isSelected = key === selectedKey;

              return (
                <Pressable
                  accessibilityRole="button"
                  key={key}
                  onPress={() => onSelectDate(day)}
                  style={[
                    styles.monthCell,
                    isMuted ? styles.monthCellMuted : null,
                    isSelected ? styles.monthCellSelected : null,
                    isToday ? styles.monthCellToday : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.monthCellText,
                      isMuted ? styles.monthCellTextMuted : null,
                      isSelected ? styles.monthCellTextSelected : null,
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
        ))}
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

function formFromEditorState(
  state: NonNullable<CalendarEditorState>,
  anchor: Date,
): CalendarFormState {
  if (state.event) {
    const start = state.event.startsAt ? new Date(state.event.startsAt) : null;
    const end = state.event.endsAt ? new Date(state.event.endsAt) : null;

    return {
      appointmentType: normalizeOption(
        state.event.appointmentType,
        EVENT_TYPES,
        "other",
      ),
      description: state.event.description ?? "",
      endDate: dateInputValue(end ?? start ?? defaultEventTimes(anchor).end),
      endTime: timeInputValue(end ?? defaultEventTimes(anchor).end),
      location: state.event.location ?? "",
      startDate: dateInputValue(start ?? defaultEventTimes(anchor).start),
      startTime: timeInputValue(start ?? defaultEventTimes(anchor).start),
      status: normalizeOption(state.event.status, EVENT_STATUSES, "scheduled"),
      title: state.event.title ?? "",
    };
  }

  const defaults = defaultEventTimes(anchor);

  return {
    appointmentType: "quote_visit",
    description: "",
    endDate: dateInputValue(defaults.end),
    endTime: timeInputValue(defaults.end),
    location: "",
    startDate: dateInputValue(defaults.start),
    startTime: timeInputValue(defaults.start),
    status: "scheduled",
    title: "",
  };
}

function defaultEventTimes(anchor: Date) {
  const start = new Date(anchor);
  const now = new Date();

  if (formatDateParam(anchor) === formatDateParam(now)) {
    start.setHours(now.getHours() + 1, 0, 0, 0);
  } else {
    start.setHours(9, 0, 0, 0);
  }

  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return { end, start };
}

function normalizeOption<T extends readonly string[]>(
  value: string,
  options: T,
  fallback: T[number],
) {
  return options.includes(value) ? value : fallback;
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function timeInputValue(date: Date) {
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");

  return `${hour}:${minute}`;
}

function isoFromDateAndTime(
  dateValue: string,
  timeValue: string,
  label: string,
) {
  const date = dateValue.trim();
  const time = timeValue.trim();

  if (!date && !time) {
    return { error: null, value: null };
  }

  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);

  if (!dateMatch || !timeMatch) {
    return {
      error: `Use YYYY-MM-DD and HH:MM for the ${label} time.`,
      value: null,
    };
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return {
      error: `Use a valid ${label} date and time.`,
      value: null,
    };
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return {
      error: `Use a valid ${label} date and time.`,
      value: null,
    };
  }

  return { error: null, value: parsed.toISOString() };
}

function nullableFormText(value: string) {
  const trimmed = value.trim();

  return trimmed ? trimmed : null;
}

function syncDescription(event: MobileCalendarEvent) {
  if (event.externalSyncStatus === "synced") {
    return `Synced to ${formatLabel(event.externalCalendarProvider ?? "external calendar")}.`;
  }

  if (event.externalSyncStatus === "failed") {
    return "Kyro saved this event, but external calendar sync needs attention.";
  }

  if (event.externalCalendarProvider) {
    return `Kyro calendar event linked to ${formatLabel(event.externalCalendarProvider)}.`;
  }

  return "Kyro calendar event.";
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

function agendaLabel(anchor: Date, view: MobileCalendarView) {
  if (view === "month") {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
    }).format(anchor);
  }

  return calendarViewLabels[view];
}

function groupEventsByDay(events: MobileCalendarEvent[]) {
  const groups = new Map<
    string,
    { events: MobileCalendarEvent[]; key: string; label: string }
  >();

  for (const event of events) {
    const date = new Date(event.startsAt ?? event.createdAt);
    const key = Number.isNaN(date.getTime())
      ? "unscheduled"
      : formatDateParam(date);
    const label = Number.isNaN(date.getTime())
      ? "Time not set"
      : new Intl.DateTimeFormat(undefined, {
          day: "numeric",
          month: "short",
          weekday: "long",
        }).format(date);

    if (!groups.has(key)) {
      groups.set(key, { events: [], key, label });
    }

    groups.get(key)?.events.push(event);
  }

  return [...groups.values()];
}

function monthCells(anchor: Date) {
  const firstDay = startOfWeek(startOfMonth(anchor));
  const lastDayOfMonth = addDays(addMonths(startOfMonth(anchor), 1), -1);
  const lastGridDay = addDays(startOfWeek(lastDayOfMonth), 6);
  const totalDays =
    Math.round(
      (lastGridDay.getTime() - firstDay.getTime()) / (24 * 60 * 60 * 1000),
    ) + 1;

  return Array.from({ length: totalDays }, (_, index) =>
    addDays(firstDay, index),
  );
}

function chunkWeeks(days: Date[]) {
  const rows: Date[][] = [];

  for (let index = 0; index < days.length; index += 7) {
    rows.push(days.slice(index, index + 7));
  }

  return rows;
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: 6,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 13,
  },
  addButtonText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  addressBox: {
    gap: 7,
  },
  addressInput: {
    minHeight: 66,
  },
  agendaCard: {
    gap: 12,
  },
  agendaDateHeader: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  agendaGroup: {
    gap: 8,
  },
  agendaGroups: {
    gap: 14,
  },
  backLink: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    minHeight: 34,
  },
  backLinkText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  dateGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  dayName: {
    color: colors.muted,
    flex: 1,
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
  deleteButton: {
    alignItems: "center",
    borderColor: "rgba(236, 54, 141, 0.45)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  deleteButtonText: {
    color: colors.pink,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  detailCard: {
    gap: 12,
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  detailLabel: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  detailLine: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 4,
    padding: 10,
    width: "48%",
  },
  detailValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  disabled: {
    opacity: 0.5,
  },
  editorActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  editorCard: {
    gap: 14,
  },
  editorEyebrow: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  editorHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  editorIcon: {
    alignItems: "center",
    backgroundColor: "rgba(81, 229, 255, 0.11)",
    borderColor: "rgba(81, 229, 255, 0.42)",
    borderRadius: radii.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  editorStack: {
    gap: 12,
  },
  editorTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 21,
  },
  editorTitleBlock: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  errorText: {
    color: colors.pink,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
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
  field: {
    flex: 1,
    gap: 7,
    minWidth: 132,
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  googleAttribution: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingTop: 2,
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
  input: {
    backgroundColor: colors.background,
    borderColor: colors.line,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
    minHeight: 42,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  lookupMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "800",
  },
  meta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  monthCard: {
    padding: 8,
  },
  monthCell: {
    alignItems: "center",
    aspectRatio: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    borderWidth: 1,
    flex: 1,
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingTop: 8,
  },
  monthCellMuted: {
    opacity: 0.38,
  },
  monthCellSelected: {
    borderColor: colors.pink,
  },
  monthCellText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  monthCellTextSelected: {
    color: colors.pink,
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
    gap: 4,
  },
  monthWeekRow: {
    flexDirection: "row",
    gap: 4,
  },
  optionGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionPill: {
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionPillActive: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.surfaceStrong,
  },
  optionText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
  },
  optionTextActive: {
    color: colors.background,
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
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    flexDirection: "row",
    flexGrow: 1,
    gap: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 15,
  },
  saveButtonText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  secondaryActions: {
    gap: 8,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
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
  suggestionMenu: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    padding: 6,
  },
  suggestionMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
  },
  suggestionRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  suggestionTextBlock: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  suggestionTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  syncCard: {
    gap: 5,
  },
  syncText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  syncTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  textArea: {
    minHeight: 92,
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
