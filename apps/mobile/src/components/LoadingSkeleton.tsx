import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle
} from "react-native";
import type { ReactNode } from "react";

import { colors, radii } from "@/theme";

type SkeletonTone = "cyan" | "neutral" | "pink" | "purple";

export function SkeletonLine({
  height = 12,
  tone = "neutral",
  width = "100%",
  style
}: {
  height?: number;
  style?: StyleProp<ViewStyle>;
  tone?: SkeletonTone;
  width?: DimensionValue;
}) {
  return (
    <View
      style={[
        styles.line,
        styles[`line_${tone}`],
        { height, width },
        style
      ]}
    />
  );
}

export function SkeletonPill({
  tone = "neutral",
  width = 72
}: {
  tone?: SkeletonTone;
  width?: DimensionValue;
}) {
  return <SkeletonLine height={24} tone={tone} width={width} />;
}

export function SkeletonIcon({ tone = "neutral" }: { tone?: SkeletonTone }) {
  return <View style={[styles.icon, styles[`block_${tone}`]]} />;
}

export function SkeletonBlock({
  children,
  style,
  tone = "neutral"
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: SkeletonTone;
}) {
  return <View style={[styles.block, styles[`block_${tone}`], style]}>{children}</View>;
}

export function SkeletonRow({
  isLast = false,
  right,
  tone = "neutral"
}: {
  isLast?: boolean;
  right?: ReactNode;
  tone?: SkeletonTone;
}) {
  return (
    <View style={[styles.row, isLast ? styles.rowLast : null]}>
      <SkeletonIcon tone={tone} />
      <View style={styles.rowMain}>
        <SkeletonLine tone={tone} width="58%" />
        <SkeletonLine height={10} width="82%" />
      </View>
      {right ?? <SkeletonPill tone={tone} width={58} />}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: "rgba(246, 247, 251, 0.06)",
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1
  },
  block_cyan: {
    backgroundColor: "rgba(81, 229, 255, 0.08)",
    borderColor: "rgba(81, 229, 255, 0.22)"
  },
  block_neutral: {
    backgroundColor: "rgba(246, 247, 251, 0.06)",
    borderColor: colors.line
  },
  block_pink: {
    backgroundColor: "rgba(236, 54, 141, 0.08)",
    borderColor: "rgba(236, 54, 141, 0.22)"
  },
  block_purple: {
    backgroundColor: "rgba(139, 92, 246, 0.08)",
    borderColor: "rgba(139, 92, 246, 0.22)"
  },
  icon: {
    borderRadius: radii.md,
    height: 34,
    width: 34
  },
  line: {
    borderRadius: radii.pill
  },
  line_cyan: {
    backgroundColor: "rgba(81, 229, 255, 0.24)"
  },
  line_neutral: {
    backgroundColor: "rgba(246, 247, 251, 0.12)"
  },
  line_pink: {
    backgroundColor: "rgba(236, 54, 141, 0.24)"
  },
  line_purple: {
    backgroundColor: "rgba(139, 92, 246, 0.24)"
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
  rowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0
  },
  rowMain: {
    flex: 1,
    gap: 8,
    minWidth: 0
  }
});
