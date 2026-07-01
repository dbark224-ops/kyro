import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  CalendarDays,
  FileText,
  GripVertical,
  RotateCcw,
  X
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState
} from "react-native";

import { DataState } from "@/components/DataState";
import {
  SkeletonLine,
  SkeletonPill,
  SkeletonRow
} from "@/components/LoadingSkeleton";
import { Screen } from "@/components/Screen";
import { SectionCard, SectionHeader, StatusPill } from "@/components/ui";
import { useAuthSession } from "@/features/auth/auth-context";
import { mobileDashboardQueryOptions } from "@/lib/mobile-query";
import type {
  MobileDashboardActivityItem,
  MobileDashboardCommandCenter,
  MobileDashboardContactSummary,
  MobileDashboardWorkQueueItem
} from "@/lib/mobile-api-types";
import { colors, radii, typography } from "@/theme";

type DashboardMetricKey =
  | "needsReply"
  | "readyToQuote"
  | "quoteApprovedOrBooked"
  | "followUpDue"
  | "readyToSend"
  | "awaitingCustomer"
  | "missingInfo"
  | "contactsIndexed";

type DashboardWidgetKey =
  | "work_queue"
  | "activity"
  | "documents"
  | "calendar"
  | "payments"
  | "top_contacts"
  | "suppliers";

type DashboardTimeframe = "today" | "week" | "month" | "year";

type DashboardLayoutConfig = {
  activeMetrics: DashboardMetricKey[];
  activeWidgets: DashboardWidgetKey[];
  defaultTimeframe: DashboardTimeframe;
  metricOrder: DashboardMetricKey[];
  widgetOrder: DashboardWidgetKey[];
};

type Tone = "amber" | "cyan" | "pink" | "purple" | "success";

const DASHBOARD_LAYOUT_STORAGE_KEY = "kyro.mobile.dashboard.layout.v1";
const DEFAULT_DASHBOARD_TIMEFRAME: DashboardTimeframe = "today";
const DEFAULT_METRIC_ORDER: DashboardMetricKey[] = [
  "needsReply",
  "readyToQuote",
  "quoteApprovedOrBooked",
  "followUpDue",
  "readyToSend",
  "awaitingCustomer",
  "missingInfo",
  "contactsIndexed"
];
const DEFAULT_WIDGET_ORDER: DashboardWidgetKey[] = [
  "work_queue",
  "activity",
  "documents",
  "payments",
  "top_contacts",
  "suppliers",
  "calendar"
];
const DEFAULT_LAYOUT: DashboardLayoutConfig = {
  activeMetrics: DEFAULT_METRIC_ORDER.slice(0, 4),
  activeWidgets: DEFAULT_WIDGET_ORDER.filter((key) => key !== "calendar"),
  defaultTimeframe: DEFAULT_DASHBOARD_TIMEFRAME,
  metricOrder: DEFAULT_METRIC_ORDER,
  widgetOrder: DEFAULT_WIDGET_ORDER
};
const CUSTOMIZE_ROW_REORDER_HEIGHT = 48;

const timeframeLabels: Record<DashboardTimeframe, string> = {
  month: "Month",
  today: "Today",
  week: "Week",
  year: "Year"
};

const metricDefinitions: Record<
  DashboardMetricKey,
  {
    description: string;
    label: string;
    tone: Tone;
    value: (data: MobileDashboardCommandCenter) => number;
  }
> = {
  awaitingCustomer: {
    description: "Waiting on customer input",
    label: "Awaiting customer",
    tone: "purple",
    value: (data) => data.stats.awaitingCustomer
  },
  contactsIndexed: {
    description: "Profiles indexed",
    label: "Contacts indexed",
    tone: "purple",
    value: (data) => data.stats.contactsIndexed
  },
  followUpDue: {
    description: "Internal reminders ready",
    label: "Follow-up due",
    tone: "amber",
    value: (data) => data.stats.followUpDue
  },
  missingInfo: {
    description: "Need more detail",
    label: "Missing info",
    tone: "pink",
    value: (data) => data.stats.missingInfo
  },
  needsReply: {
    description: "Conversations need reply",
    label: "Needs reply",
    tone: "pink",
    value: (data) => data.stats.needsReply
  },
  quoteApprovedOrBooked: {
    description: "Approved or booked",
    label: "Approved / booked",
    tone: "success",
    value: (data) => data.stats.quoteApprovedOrBooked
  },
  readyToQuote: {
    description: "Ready for quoting",
    label: "Ready to quote",
    tone: "cyan",
    value: (data) => data.stats.readyToQuote
  },
  readyToSend: {
    description: "Drafts ready to send",
    label: "Ready to send",
    tone: "cyan",
    value: (data) => data.stats.readyToSend
  }
};

const widgetDefinitions: Record<
  DashboardWidgetKey,
  { description: string; title: string }
> = {
  activity: {
    description: "Recent messages and system movement.",
    title: "System activity"
  },
  calendar: {
    description: "Calendar placeholder for upcoming scheduling.",
    title: "Calendar"
  },
  documents: {
    description: "Recent generated files and outputs.",
    title: "Document generation"
  },
  payments: {
    description: "Usage, quote readiness, and collections placeholder.",
    title: "Payments"
  },
  suppliers: {
    description: "Frequently used supplier contacts.",
    title: "Suppliers"
  },
  top_contacts: {
    description: "Most active customers and contacts.",
    title: "Top contacts"
  },
  work_queue: {
    description: "Priority conversations and next actions.",
    title: "Work queue"
  }
};

export default function DashboardScreen() {
  const { session, status } = useAuthSession();
  const [timeframe, setTimeframe] = useState<DashboardTimeframe>(
    DEFAULT_DASHBOARD_TIMEFRAME
  );
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isCustomizeDragLocked, setIsCustomizeDragLocked] = useState(false);
  const [layout, setLayout] = useState<DashboardLayoutConfig>(DEFAULT_LAYOUT);
  const dashboard = useQuery({
    ...mobileDashboardQueryOptions(session),
    enabled: status === "signed-in"
  });
  const commandCenter = dashboard.data?.commandCenter;
  const isDashboardLoading =
    status === "loading" || (status === "signed-in" && dashboard.isLoading);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY)
      .then((value) => {
        if (!value || !isMounted) {
          return;
        }

        const nextLayout = normalizeDashboardLayout(JSON.parse(value));

        setLayout(nextLayout);
        setTimeframe(nextLayout.defaultTimeframe);
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isCustomizing && isCustomizeDragLocked) {
      setIsCustomizeDragLocked(false);
    }
  }, [isCustomizeDragLocked, isCustomizing]);

  const saveLayout = (nextLayout: DashboardLayoutConfig) => {
    setLayout(nextLayout);
    void AsyncStorage.setItem(
      DASHBOARD_LAYOUT_STORAGE_KEY,
      JSON.stringify(nextLayout)
    );
  };

  const saveDefaultTimeframe = (defaultTimeframe: DashboardTimeframe) => {
    saveLayout({
      ...layout,
      defaultTimeframe
    });
    setTimeframe(defaultTimeframe);
  };

  return (
    <Screen
      compactHeaderEmphasis
      compactHeaderLabel={commandCenter?.workspace.name}
      scrollEnabled={!isCustomizeDragLocked}
      showTopBar={false}
      title="Dashboard"
      titleScale="compact"
    >
      <View style={styles.toolbar}>
        <SegmentedControl
          options={(["today", "week", "month", "year"] as const).map((key) => ({
            key,
            label: timeframeLabels[key]
          }))}
          value={timeframe}
          onChange={setTimeframe}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsCustomizing((current) => !current)}
          style={({ pressed }) => [
            styles.customizeButton,
            isCustomizing ? styles.customizeButtonActive : null,
            pressed ? styles.pressed : null
          ]}
        >
          <Text
            style={[
              styles.customizeButtonText,
              isCustomizing ? styles.customizeButtonTextActive : null
            ]}
          >
            {isCustomizing ? "Done" : "Customize"}
          </Text>
        </Pressable>
      </View>

      {isDashboardLoading ? <DashboardLoadingState /> : null}
      {!isDashboardLoading && !commandCenter ? (
        <DataState
          error={dashboard.error}
          loading={false}
          title="Loading dashboard"
        />
      ) : null}

      {commandCenter && isCustomizing ? (
        <DashboardCustomizePanel
          defaultTimeframe={layout.defaultTimeframe}
          layout={layout}
          onChange={saveLayout}
          onDragStateChange={setIsCustomizeDragLocked}
          onDefaultTimeframeChange={saveDefaultTimeframe}
          onReset={() => {
            saveLayout(DEFAULT_LAYOUT);
            setTimeframe(DEFAULT_LAYOUT.defaultTimeframe);
          }}
        />
      ) : null}

      {commandCenter && !isCustomizing ? (
        <>
          <View style={styles.kpiGrid}>
            {activeMetricKeys(layout).map((metricKey, index) => (
              <MetricCard
                data={commandCenter}
                key={`${metricKey}-${index}`}
                metricKey={metricKey}
              />
            ))}
          </View>

          <View style={styles.sectionStack}>
            {activeWidgetKeys(layout)
              .slice(0, 3)
              .map((widgetKey, index) => (
              <DashboardWidget
                data={commandCenter}
                key={`middle-${widgetKey}-${index}`}
                size="large"
                timeframe={timeframe}
                widgetKey={widgetKey}
              />
            ))}
          </View>

          <View style={styles.sectionStack}>
            {activeWidgetKeys(layout)
              .slice(3)
              .map((widgetKey, index) => (
              <DashboardWidget
                data={commandCenter}
                key={`bottom-${widgetKey}-${index}`}
                size="compact"
                timeframe={timeframe}
                widgetKey={widgetKey}
              />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function DashboardLoadingState() {
  return (
    <>
      <View style={styles.kpiGrid}>
        {[0, 1, 2, 3].map((index) => (
          <SectionCard key={index} style={styles.kpiCard}>
            <SkeletonLine height={22} tone={index % 2 ? "pink" : "cyan"} width="70%" />
          </SectionCard>
        ))}
      </View>
      <SectionCard style={styles.largeWidget}>
        <SectionHeader eyebrow="Live" title="Work queue" />
        <SkeletonRow tone="cyan" />
        <SkeletonRow tone="pink" />
        <SkeletonRow isLast tone="purple" />
      </SectionCard>
      <SectionCard style={styles.largeWidget}>
        <SectionHeader eyebrow="Live" title="System activity" />
        <SkeletonLine height={14} width="80%" />
        <SkeletonLine width="58%" />
        <SkeletonPill tone="cyan" width={130} />
      </SectionCard>
    </>
  );
}

function MetricCard({
  data,
  metricKey
}: {
  data: MobileDashboardCommandCenter;
  metricKey: DashboardMetricKey;
}) {
  const metric = metricDefinitions[metricKey];
  const toneStyle = toneStyles[metric.tone];

  return (
    <View
      style={[
        styles.kpiCard,
        { borderLeftColor: toneStyle.color }
      ]}
    >
      <View style={styles.kpiLine}>
        <Text style={styles.kpiValue}>{formatCount(metric.value(data))}</Text>
        <Text numberOfLines={1} style={styles.kpiLabel}>
          {metric.label}
        </Text>
      </View>
    </View>
  );
}

function DashboardWidget({
  data,
  size,
  timeframe,
  widgetKey
}: {
  data: MobileDashboardCommandCenter;
  size: "compact" | "large";
  timeframe: DashboardTimeframe;
  widgetKey: DashboardWidgetKey;
}) {
  const definition = widgetDefinitions[widgetKey];

  return (
    <SectionCard
      style={size === "large" ? styles.largeWidget : styles.compactWidget}
    >
      <SectionHeader
        action={<Text style={styles.widgetMeta}>{timeframeLabels[timeframe]}</Text>}
        eyebrow={size === "large" ? "Live" : "Support"}
        title={definition.title}
      />
      <WidgetBody data={data} timeframe={timeframe} widgetKey={widgetKey} />
    </SectionCard>
  );
}

function WidgetBody({
  data,
  timeframe,
  widgetKey
}: {
  data: MobileDashboardCommandCenter;
  timeframe: DashboardTimeframe;
  widgetKey: DashboardWidgetKey;
}) {
  if (widgetKey === "work_queue") {
    const items = timeFilteredQueue(data.workQueue, timeframe).slice(0, 5);

    return items.length ? (
      <View style={styles.widgetList}>
        {items.map((item) => (
          <QueueRow item={item} key={item.id} />
        ))}
      </View>
    ) : (
      <EmptyCopy text="No active queue items in this timeframe." />
    );
  }

  if (widgetKey === "activity") {
    const items = timeFilteredActivity(data.activity, timeframe).slice(0, 5);

    return items.length ? (
      <View style={styles.widgetList}>
        {items.map((item) => (
          <ActivityRow item={item} key={item.id} />
        ))}
      </View>
    ) : (
      <EmptyCopy text="No recent activity in this timeframe." />
    );
  }

  if (widgetKey === "payments") {
    return <PaymentsWidget data={data} />;
  }

  if (widgetKey === "top_contacts") {
    return (
      <ContactsWidget
        emptyText="No active contacts in this timeframe."
        items={timeFilteredContacts(data.topContacts, timeframe)}
      />
    );
  }

  if (widgetKey === "suppliers") {
    return (
      <ContactsWidget
        emptyText="No suppliers have been tagged yet."
        items={timeFilteredContacts(data.suppliers, timeframe)}
      />
    );
  }

  if (widgetKey === "documents") {
    return data.generatedDocuments.length ? (
      <View style={styles.widgetList}>
        {data.generatedDocuments.slice(0, 4).map((document) => (
          <View key={document.id} style={styles.simpleRow}>
            <FileText color={colors.cyan} size={17} />
            <View style={styles.rowCopyBlock}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {document.title}
              </Text>
              <Text numberOfLines={1} style={styles.rowCopy}>
                {document.type} - {document.lifecycleStatus}
              </Text>
            </View>
          </View>
        ))}
      </View>
    ) : (
      <EmptyCopy text="Generated files will appear here when Kyro creates them." />
    );
  }

  return (
    <View style={styles.placeholderBody}>
      <CalendarDays color={colors.purple} size={26} />
      <Text style={styles.placeholderTitle}>Calendar coming next</Text>
      <Text style={styles.placeholderCopy}>
        Scheduled jobs and site visits will sit here once the calendar surface is live.
      </Text>
    </View>
  );
}

function QueueRow({ item }: { item: MobileDashboardWorkQueueItem }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: "/inbox",
          params: { conversationId: item.id }
        })
      }
      style={({ pressed }) => [styles.simpleRow, pressed ? styles.pressed : null]}
    >
      <View style={styles.rowCopyBlock}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {item.title}
        </Text>
        <Text numberOfLines={2} style={styles.rowCopy}>
          {item.preview ?? item.workflowBucket}
        </Text>
      </View>
      <StatusPill label={item.nextActionLabel} tone="neutral" />
    </Pressable>
  );
}

function ActivityRow({ item }: { item: MobileDashboardActivityItem }) {
  const tone =
    item.tone === "failed" ? "pink" : item.tone === "system" ? "purple" : "cyan";

  return (
    <View style={styles.simpleRow}>
      <View style={[styles.activityDot, { backgroundColor: toneColor(tone) }]} />
      <View style={styles.rowCopyBlock}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {item.title}
        </Text>
        <Text numberOfLines={2} style={styles.rowCopy}>
          {item.subject ? `${item.subject} - ` : ""}
          {item.preview}
        </Text>
      </View>
      <Text style={styles.rowMeta}>{formatRelativeTime(item.at)}</Text>
    </View>
  );
}

function PaymentsWidget({ data }: { data: MobileDashboardCommandCenter }) {
  const payments = data.payments;
  const items = [
    {
      amountCents: payments.paidThisWeekCents,
      label: "Paid this week",
      tone: "cyan" as const
    },
    {
      amountCents: payments.paidThisMonthCents,
      label: "Paid this month",
      tone: "purple" as const
    },
    {
      amountCents: payments.outstandingAmountCents,
      label: "Outstanding",
      meta: `${payments.outstandingCount} open`,
      tone: "amber" as const
    },
    {
      amountCents: payments.overdueAmountCents,
      label: "Overdue",
      meta: `${payments.overdueCount} due`,
      tone: "pink" as const
    }
  ];

  return (
    <View style={styles.paymentsGrid}>
      {items.map((item) => (
        <View
          key={item.label}
          style={[
            styles.paymentMetricCard,
            { borderLeftColor: toneColor(item.tone) }
          ]}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.paymentValue}>
            {formatCurrencyFromCents(item.amountCents, payments.currency)}
          </Text>
          <View style={styles.paymentMetricLine}>
            <Text numberOfLines={1} style={styles.paymentMetricLabel}>
              {item.label}
            </Text>
            {item.meta ? (
              <Text numberOfLines={1} style={styles.paymentMetricMeta}>
                {item.meta}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function ContactsWidget({
  emptyText,
  items
}: {
  emptyText: string;
  items: MobileDashboardContactSummary[];
}) {
  return items.length ? (
    <View style={styles.widgetList}>
      {items.slice(0, 4).map((item) => (
        <Pressable
          accessibilityRole="button"
          key={item.id}
          onPress={() =>
            router.push({ pathname: "/crm", params: { contactId: item.id } })
          }
          style={({ pressed }) => [styles.simpleRow, pressed ? styles.pressed : null]}
        >
          <View style={styles.rowCopyBlock}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {item.label}
            </Text>
            <Text numberOfLines={1} style={styles.rowCopy}>
              {item.sublabel ?? `${item.messageCount} messages`}
            </Text>
          </View>
          <Text style={styles.rowMeta}>{item.messageCount}</Text>
        </Pressable>
      ))}
    </View>
  ) : (
    <EmptyCopy text={emptyText} />
  );
}

function DashboardCustomizePanel({
  defaultTimeframe,
  layout,
  onChange,
  onDragStateChange,
  onDefaultTimeframeChange,
  onReset
}: {
  defaultTimeframe: DashboardTimeframe;
  layout: DashboardLayoutConfig;
  onChange: (layout: DashboardLayoutConfig) => void;
  onDragStateChange: (isDragging: boolean) => void;
  onDefaultTimeframeChange: (timeframe: DashboardTimeframe) => void;
  onReset: () => void;
}) {
  const metricActiveSet = useMemo(
    () => new Set(layout.activeMetrics),
    [layout.activeMetrics]
  );
  const widgetActiveSet = useMemo(
    () => new Set(layout.activeWidgets),
    [layout.activeWidgets]
  );

  const updateMetricOrder = (fromIndex: number, toIndex: number) => {
    onChange({
      ...layout,
      metricOrder: moveItem(layout.metricOrder, fromIndex, toIndex)
    });
  };
  const updateWidgetOrder = (fromIndex: number, toIndex: number) => {
    onChange({
      ...layout,
      widgetOrder: moveItem(layout.widgetOrder, fromIndex, toIndex)
    });
  };
  const toggleMetric = (metricKey: DashboardMetricKey) => {
    onChange({
      ...layout,
      activeMetrics: toggleKey(layout.activeMetrics, metricKey)
    });
  };
  const toggleWidget = (widgetKey: DashboardWidgetKey) => {
    onChange({
      ...layout,
      activeWidgets: toggleKey(layout.activeWidgets, widgetKey)
    });
  };

  return (
    <SectionCard style={styles.customizePanel}>
      <View style={styles.customizePanelHeader}>
        <View style={styles.rowCopyBlock}>
          <Text style={styles.customizePanelTitle}>Dashboard layout</Text>
          <Text style={styles.customizePanelCopy}>
            Drag an active row to reorder. Hide a row with X, tap a grey row to show it.
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Reset dashboard layout"
          accessibilityRole="button"
          onPress={onReset}
          style={({ pressed }) => [
            styles.resetIconButton,
            pressed ? styles.pressed : null
          ]}
        >
          <RotateCcw color={colors.cyan} size={16} />
        </Pressable>
      </View>

      <CustomizeSection title="Default view">
        <SegmentedControl
          options={(["today", "week", "month", "year"] as const).map((key) => ({
            key,
            label: timeframeLabels[key]
          }))}
          value={defaultTimeframe}
          onChange={onDefaultTimeframeChange}
        />
      </CustomizeSection>

      <CustomizeSection title="Counters">
        {layout.metricOrder.map((metricKey, index) => (
          <CustomizeRow
            active={metricActiveSet.has(metricKey)}
            index={index}
            key={metricKey}
            label={metricDefinitions[metricKey].label}
            rowCount={layout.metricOrder.length}
            onDragStateChange={onDragStateChange}
            onMove={updateMetricOrder}
            onToggle={() => toggleMetric(metricKey)}
          />
        ))}
      </CustomizeSection>

      <CustomizeSection title="Widgets">
        {layout.widgetOrder.map((widgetKey, index) => (
          <CustomizeRow
            active={widgetActiveSet.has(widgetKey)}
            index={index}
            key={widgetKey}
            label={widgetDefinitions[widgetKey].title}
            rowCount={layout.widgetOrder.length}
            onDragStateChange={onDragStateChange}
            onMove={updateWidgetOrder}
            onToggle={() => toggleWidget(widgetKey)}
          />
        ))}
      </CustomizeSection>
    </SectionCard>
  );
}

function CustomizeSection({
  children,
  title
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <View style={styles.customizeSection}>
      <Text style={styles.customizeSectionTitle}>{title}</Text>
      <View style={styles.customizeRows}>{children}</View>
    </View>
  );
}

function CustomizeRow({
  active,
  index,
  label,
  onDragStateChange,
  onMove,
  onToggle,
  rowCount
}: {
  active: boolean;
  index: number;
  label: string;
  onDragStateChange: (isDragging: boolean) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onToggle: () => void;
  rowCount: number;
}) {
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTargetIndexRef = useRef(index);
  const startIndexRef = useRef(index);
  const [isDragArmed, setIsDragArmed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const releaseDragState = () => {
    clearHoldTimer();
    setIsDragArmed(false);
    setIsDragging(false);
    onDragStateChange(false);
  };

  useEffect(
    () => () => {
      clearHoldTimer();
      onDragStateChange(false);
    },
    [onDragStateChange]
  );

  const armDrag = () => {
    if (!active) {
      return;
    }

    setIsDragArmed(true);
    onDragStateChange(true);
  };

  const handleTouchStart = () => {
    if (!active) {
      return;
    }

    clearHoldTimer();
    holdTimerRef.current = setTimeout(armDrag, 130);
  };

  const handleTouchEnd = () => {
    if (!isDragging) {
      releaseDragState();
    }
  };

  const panResponder = useMemo(
    () => {
      const shouldStartReorder = (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState
      ) =>
        active &&
        isDragArmed &&
        Math.abs(gesture.dy) > 2 &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx);

      return (
      PanResponder.create({
        onMoveShouldSetPanResponder: shouldStartReorder,
        onMoveShouldSetPanResponderCapture: shouldStartReorder,
        onPanResponderGrant: () => {
          clearHoldTimer();
          startIndexRef.current = index;
          lastTargetIndexRef.current = index;
          setIsDragArmed(true);
          setIsDragging(true);
          onDragStateChange(true);
        },
        onPanResponderMove: (_event, gesture) => {
          if (!active) {
            return;
          }

          const targetIndex = clampIndex(
            startIndexRef.current +
              Math.round(gesture.dy / CUSTOMIZE_ROW_REORDER_HEIGHT),
            rowCount
          );

          if (targetIndex !== lastTargetIndexRef.current) {
            onMove(lastTargetIndexRef.current, targetIndex);
            lastTargetIndexRef.current = targetIndex;
          }
        },
        onPanResponderRelease: releaseDragState,
        onPanResponderTerminate: releaseDragState,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true
      })
      );
    },
    [active, index, isDragArmed, onDragStateChange, onMove, rowCount]
  );
  const rowContent = (
    <>
      <View
        style={[
          styles.dragHandle,
          active ? null : styles.dragHandleInactive
        ]}
      >
        <GripVertical
          color={active ? colors.muted : "rgba(160, 164, 175, 0.42)"}
          size={18}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.customizeRowLabel,
          active ? null : styles.customizeRowLabelInactive
        ]}
      >
        {label}
      </Text>
      {active ? (
        <Pressable
          accessibilityLabel={`Hide ${label}`}
          accessibilityRole="button"
          onPress={onToggle}
          hitSlop={10}
          style={({ pressed }) => [
            styles.removeButton,
            pressed ? styles.pressed : null
          ]}
        >
          <X color={colors.muted} size={16} />
        </Pressable>
      ) : (
        <Text style={styles.inactiveText}>Tap to show</Text>
      )}
    </>
  );

  if (active) {
    return (
      <View
        {...panResponder.panHandlers}
        onTouchCancel={handleTouchEnd}
        onTouchEnd={handleTouchEnd}
        onTouchStart={handleTouchStart}
        style={[
          styles.customizeRow,
          isDragArmed || isDragging ? styles.customizeRowDragging : null
        ]}
      >
        {rowContent}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (!active) {
          onToggle();
        }
      }}
      style={({ pressed }) => [
        styles.customizeRow,
        active ? null : styles.customizeRowInactive,
        pressed ? styles.pressed : null
      ]}
    >
      {rowContent}
    </Pressable>
  );
}

function SegmentedControl<T extends string>({
  onChange,
  options,
  value
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
            value === option.key ? styles.segmentActive : null
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              value === option.key ? styles.segmentTextActive : null
            ]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return <Text style={styles.emptyText}>{text}</Text>;
}

function normalizeDashboardLayout(value: unknown): DashboardLayoutConfig {
  const record = objectRecord(value);
  const legacyWidgets = [
    ...arrayValue(record.middle),
    ...arrayValue(record.bottom)
  ];
  const metricOrder = normalizeOrder(
    arrayValue(record.metricOrder).length
      ? arrayValue(record.metricOrder)
      : [...arrayValue(record.top), ...DEFAULT_METRIC_ORDER],
    DEFAULT_METRIC_ORDER
  );
  const widgetOrder = normalizeOrder(
    arrayValue(record.widgetOrder).length
      ? arrayValue(record.widgetOrder)
      : [...legacyWidgets, ...DEFAULT_WIDGET_ORDER],
    DEFAULT_WIDGET_ORDER
  );

  return {
    activeMetrics: normalizeActiveKeys(
      arrayValue(record.activeMetrics).length
        ? arrayValue(record.activeMetrics)
        : arrayValue(record.top),
      metricOrder,
      DEFAULT_LAYOUT.activeMetrics
    ),
    activeWidgets: normalizeActiveKeys(
      arrayValue(record.activeWidgets).length
        ? arrayValue(record.activeWidgets)
        : legacyWidgets,
      widgetOrder,
      DEFAULT_LAYOUT.activeWidgets
    ),
    defaultTimeframe: normalizeTimeframe(record.defaultTimeframe),
    metricOrder,
    widgetOrder
  };
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeOrder<T extends string>(row: unknown[], availableKeys: T[]) {
  const next = uniqueKeys(row, availableKeys);

  for (const key of availableKeys) {
    if (!next.includes(key)) {
      next.push(key);
    }
  }

  return next;
}

function normalizeActiveKeys<T extends string>(
  row: unknown[],
  order: T[],
  fallback: T[]
) {
  const active = uniqueKeys(row, order);

  if (active.length) {
    return active;
  }

  return fallback.filter((key) => order.includes(key));
}

function normalizeTimeframe(value: unknown): DashboardTimeframe {
  return typeof value === "string" &&
    (["today", "week", "month", "year"] as string[]).includes(value)
    ? (value as DashboardTimeframe)
    : DEFAULT_DASHBOARD_TIMEFRAME;
}

function uniqueKeys<T extends string>(row: unknown[], availableKeys: T[]) {
  const seen = new Set<T>();
  const next: T[] = [];

  for (const item of row) {
    if (
      typeof item === "string" &&
      availableKeys.includes(item as T) &&
      !seen.has(item as T)
    ) {
      seen.add(item as T);
      next.push(item as T);
    }
  }

  return next;
}

function activeMetricKeys(layout: DashboardLayoutConfig) {
  return layout.metricOrder.filter((key) => layout.activeMetrics.includes(key));
}

function activeWidgetKeys(layout: DashboardLayoutConfig) {
  return layout.widgetOrder.filter((key) => layout.activeWidgets.includes(key));
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);

  return next;
}

function toggleKey<T extends string>(items: T[], key: T) {
  return items.includes(key)
    ? items.filter((item) => item !== key)
    : [...items, key];
}

function clampIndex(index: number, rowCount: number) {
  return Math.max(0, Math.min(rowCount - 1, index));
}

function startOfTimeframe(timeframe: DashboardTimeframe) {
  const start = new Date();

  if (timeframe === "today") {
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (timeframe === "week") {
    start.setHours(0, 0, 0, 0);
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return start;
  }

  if (timeframe === "month") {
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
    return start;
  }

  start.setHours(0, 0, 0, 0);
  start.setMonth(0, 1);
  return start;
}

function isInsideTimeframe(value: string | null, timeframe: DashboardTimeframe) {
  if (!value) {
    return timeframe === "year";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date >= startOfTimeframe(timeframe);
}

function timeFilteredQueue(
  items: MobileDashboardWorkQueueItem[],
  timeframe: DashboardTimeframe
) {
  return items.filter((item) => isInsideTimeframe(item.lastMessageAt, timeframe));
}

function timeFilteredActivity(
  items: MobileDashboardActivityItem[],
  timeframe: DashboardTimeframe
) {
  return items.filter((item) => isInsideTimeframe(item.at, timeframe));
}

function timeFilteredContacts(
  items: MobileDashboardContactSummary[],
  timeframe: DashboardTimeframe
) {
  return items.filter((item) => isInsideTimeframe(item.lastMessageAt, timeframe));
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    style: "currency"
  }).format(value);
}

function formatCurrencyFromCents(value: number, currency: string) {
  return formatCurrency((Number.isFinite(value) ? value : 0) / 100, currency || "AUD");
}

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));

  if (diffMinutes < 1) {
    return "Now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  return `${Math.round(diffHours / 24)}d`;
}

function toneColor(tone: Tone | "green") {
  if (tone === "amber") {
    return colors.warning;
  }

  if (tone === "green" || tone === "success") {
    return colors.green;
  }

  return colors[tone];
}

const toneStyles: Record<Tone, { color: string }> = {
  amber: { color: colors.warning },
  cyan: { color: colors.cyan },
  pink: { color: colors.pink },
  purple: { color: colors.purple },
  success: { color: colors.green }
};

const styles = StyleSheet.create({
  activityDot: {
    borderRadius: radii.pill,
    height: 9,
    width: 9
  },
  compactWidget: {
    minHeight: 154
  },
  customizeButton: {
    alignItems: "center",
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 13
  },
  customizeButtonActive: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.surfaceStrong
  },
  customizeButtonText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900"
  },
  customizeButtonTextActive: {
    color: colors.background
  },
  customizePanel: {
    gap: 12,
    padding: 12
  },
  customizePanelCopy: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  customizePanelHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  customizePanelTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "900"
  },
  customizeRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: CUSTOMIZE_ROW_REORDER_HEIGHT,
    paddingLeft: 7,
    paddingRight: 9
  },
  customizeRowInactive: {
    backgroundColor: "rgba(160, 164, 175, 0.06)",
    borderColor: "rgba(160, 164, 175, 0.16)"
  },
  customizeRowDragging: {
    backgroundColor: "rgba(81, 229, 255, 0.08)",
    borderColor: "rgba(81, 229, 255, 0.38)",
    elevation: 6,
    shadowColor: colors.cyan,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    transform: [{ scale: 1.015 }],
    zIndex: 10
  },
  customizeRowLabel: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  customizeRowLabelInactive: {
    color: "rgba(160, 164, 175, 0.58)"
  },
  customizeRows: {
    gap: 6
  },
  customizeSection: {
    gap: 7
  },
  customizeSectionTitle: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  dragHandle: {
    alignItems: "center",
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 30,
    width: 28
  },
  dragHandleInactive: {
    opacity: 0.5
  },
  emptyText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  inactiveText: {
    color: "rgba(160, 164, 175, 0.72)",
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900"
  },
  kpiCard: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: "48.5%",
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 58,
    paddingHorizontal: 11,
    paddingVertical: 9
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  kpiLabel: {
    color: colors.text,
    flexShrink: 1,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 15,
    textTransform: "uppercase"
  },
  kpiLine: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 8,
    minWidth: 0
  },
  kpiValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 27
  },
  largeWidget: {
    minHeight: 286
  },
  paymentMetricCard: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: "48.5%",
    flexGrow: 1,
    gap: 5,
    minHeight: 72,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  paymentMetricLabel: {
    color: colors.muted,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 13,
    textTransform: "uppercase"
  },
  paymentMetricLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0
  },
  paymentMetricMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 13
  },
  paymentValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 23
  },
  paymentsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  placeholderBody: {
    alignItems: "flex-start",
    gap: 8
  },
  placeholderCopy: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  placeholderTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "900"
  },
  pressed: {
    opacity: 0.72
  },
  resetIconButton: {
    alignItems: "center",
    borderColor: "rgba(81, 229, 255, 0.34)",
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  removeButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  rowCopy: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17
  },
  rowCopyBlock: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  rowMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900"
  },
  rowTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900"
  },
  sectionStack: {
    gap: 10
  },
  segment: {
    alignItems: "center",
    borderRadius: radii.pill,
    minHeight: 32,
    minWidth: 62,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  segmentActive: {
    backgroundColor: colors.surfaceStrong
  },
  segmented: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3
  },
  segmentText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900"
  },
  segmentTextActive: {
    color: colors.background
  },
  simpleRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 50,
    paddingBottom: 9
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  widgetList: {
    gap: 10
  },
  widgetMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },

});
