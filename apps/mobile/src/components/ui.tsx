import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type ViewStyle
} from "react-native";

import { colors, radii, shadow, typography } from "@/theme";

type ButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  tone?: "primary" | "secondary";
};

export function ActionButton({
  children,
  disabled = false,
  onPress,
  tone = "primary"
}: ButtonProps) {
  const content =
    typeof children === "string" || typeof children === "number" ? (
      <Text
        style={[
          styles.buttonText,
          tone === "secondary" ? styles.buttonTextSecondary : null
        ]}
      >
        {children}
      </Text>
    ) : (
      children
    );

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "secondary" ? styles.buttonSecondary : styles.buttonPrimary,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null
      ]}
    >
      {content}
    </Pressable>
  );
}

export function SectionCard({
  children,
  style
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({
  action,
  eyebrow,
  title
}: {
  action?: ReactNode;
  eyebrow?: string;
  title: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleBlock}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function StatusPill({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: "cyan" | "green" | "neutral" | "pink" | "purple" | "warning";
}) {
  return (
    <View style={[styles.pill, styles[`pill_${tone}`]]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function MetricTile({
  label,
  value,
  tone = "cyan"
}: {
  label: string;
  tone?: "cyan" | "pink" | "purple";
  value: string;
}) {
  return (
    <View style={[styles.metric, styles[`metric_${tone}`]]}>
      <View style={styles.metricLine}>
        <Text style={styles.metricValue}>{value}</Text>
        <Text numberOfLines={1} style={styles.metricLabel}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export function ListRow({
  children,
  right,
  style
}: {
  children: ReactNode;
  right?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.rowMain}>{children}</View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </View>
  );
}

const basePill = {
  borderRadius: radii.pill,
  borderWidth: 1,
  paddingHorizontal: 9,
  paddingVertical: 5
};

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  buttonPrimary: {
    backgroundColor: colors.surfaceStrong
  },
  buttonSecondary: {
    backgroundColor: "rgba(236, 54, 141, 0.12)",
    borderColor: "rgba(236, 54, 141, 0.3)",
    borderWidth: 1
  },
  buttonText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  buttonTextSecondary: {
    color: colors.text
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 13,
    padding: 14,
    ...shadow
  },
  disabled: {
    opacity: 0.5
  },
  eyebrow: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  metric: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 42,
    minWidth: 118,
    paddingHorizontal: 11,
    paddingVertical: 8
  },
  metric_cyan: {
    borderColor: colors.line,
    borderLeftColor: colors.cyan
  },
  metric_pink: {
    borderColor: colors.line,
    borderLeftColor: colors.pink
  },
  metric_purple: {
    borderColor: colors.line,
    borderLeftColor: colors.purple
  },
  metricLabel: {
    color: colors.muted,
    flexShrink: 1,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  metricLine: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 7,
    minWidth: 0
  },
  metricValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 22
  },
  pill: basePill,
  pill_cyan: {
    backgroundColor: "rgba(81, 229, 255, 0.12)",
    borderColor: "rgba(81, 229, 255, 0.42)"
  },
  pill_green: {
    backgroundColor: "rgba(142, 243, 197, 0.12)",
    borderColor: "rgba(142, 243, 197, 0.42)"
  },
  pill_neutral: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line
  },
  pill_pink: {
    backgroundColor: "rgba(236, 54, 141, 0.12)",
    borderColor: "rgba(236, 54, 141, 0.42)"
  },
  pill_purple: {
    backgroundColor: "rgba(139, 92, 246, 0.12)",
    borderColor: "rgba(139, 92, 246, 0.42)"
  },
  pill_warning: {
    backgroundColor: "rgba(255, 209, 102, 0.12)",
    borderColor: "rgba(255, 209, 102, 0.42)"
  },
  pillText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "800"
  },
  pressed: {
    opacity: 0.78
  },
  row: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 66,
    paddingBottom: 12
  },
  rowMain: {
    flex: 1,
    gap: 4,
    minWidth: 0
  },
  rowRight: {
    alignItems: "flex-end"
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 17,
    fontWeight: "900"
  },
  sectionTitleBlock: {
    flex: 1,
    gap: 3,
    minWidth: 0
  }
});
