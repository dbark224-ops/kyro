import type { ReactNode } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLockup } from "./BrandLockup";
import { MetricTile, StatusPill } from "./ui";
import { useAuthSession } from "@/features/auth/auth-context";
import { colors, spacing, typography } from "@/theme";

type ScreenMetric = {
  label: string;
  tone?: "cyan" | "pink" | "purple";
  value: string;
};

type Props = {
  children: ReactNode;
  compactHeaderAccessory?: ReactNode;
  compactHeaderEmphasis?: boolean;
  compactHeaderLabel?: string | null;
  eyebrow?: string | null;
  headerLabel?: string;
  metrics?: ScreenMetric[];
  scrollEnabled?: boolean;
  showTopBar?: boolean;
  title: string;
  titleScale?: "default" | "compact";
};

function sessionLabel(
  status: ReturnType<typeof useAuthSession>["status"],
  email?: string
) {
  if (status === "signed-in") {
    return email ?? "Signed in";
  }

  if (status === "unconfigured") {
    return "Supabase env needed";
  }

  if (status === "loading") {
    return "Checking session";
  }

  return "Signed out";
}

export function Screen({
  children,
  compactHeaderAccessory,
  compactHeaderEmphasis = false,
  compactHeaderLabel,
  eyebrow,
  headerLabel,
  metrics = [],
  scrollEnabled = true,
  showTopBar = true,
  title,
  titleScale = "default"
}: Props) {
  const { status, user } = useAuthSession();

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      {showTopBar ? (
        <View style={styles.top}>
          <BrandLockup />
          {headerLabel ? (
            <Text numberOfLines={1} style={styles.headerLabel}>
              {headerLabel}
            </Text>
          ) : (
            <StatusPill
              label={sessionLabel(status, user?.email)}
              tone={status === "signed-in" ? "green" : "neutral"}
            />
          )}
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          !showTopBar ? styles.contentWithoutTopBar : null
        ]}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroHeader}>
            <View style={styles.titleBlock}>
              {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
              <Text
                style={[
                  styles.title,
                  titleScale === "compact" ? styles.titleCompact : null
                ]}
              >
                {title}
              </Text>
            </View>
            {!showTopBar && compactHeaderLabel ? (
              <View
                style={[
                  styles.compactHeaderStack,
                  compactHeaderEmphasis ? styles.compactHeaderStackEmphasis : null
                ]}
              >
                <View style={styles.compactBusinessMark}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.compactBusinessLabel,
                      compactHeaderEmphasis
                        ? styles.compactBusinessLabelEmphasis
                        : null
                    ]}
                  >
                    {compactHeaderLabel}
                  </Text>
                  <Text
                    style={[
                      styles.compactBusinessSeparator,
                      compactHeaderEmphasis
                        ? styles.compactBusinessSeparatorEmphasis
                        : null
                    ]}
                  >
                    |
                  </Text>
                  <Image
                    accessibilityIgnoresInvertColors
                    resizeMode="contain"
                    source={require("../../assets/kyro-icon.png")}
                    style={[
                      styles.compactBusinessLogo,
                      compactHeaderEmphasis ? styles.compactBusinessLogoEmphasis : null
                    ]}
                  />
                </View>
                {compactHeaderAccessory}
              </View>
            ) : null}
          </View>
          {metrics.length ? (
            <ScrollView
              contentContainerStyle={styles.metrics}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {metrics.map((metric) => (
                <MetricTile
                  key={metric.label}
                  label={metric.label}
                  tone={metric.tone}
                  value={metric.value}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>

        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingBottom: 28,
    paddingHorizontal: spacing.pageX,
    paddingTop: 8
  },
  contentWithoutTopBar: {
    paddingTop: 16
  },
  compactBusinessLabel: {
    color: colors.cyan,
    flexShrink: 1,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0,
    textAlign: "right",
    textTransform: "uppercase"
  },
  compactBusinessLabelEmphasis: {
    fontSize: 15,
    lineHeight: 18
  },
  compactBusinessLogo: {
    height: 16,
    width: 16
  },
  compactBusinessLogoEmphasis: {
    height: 19,
    width: 19
  },
  compactBusinessMark: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    flexShrink: 1
  },
  compactBusinessSeparator: {
    color: colors.line,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800"
  },
  compactBusinessSeparatorEmphasis: {
    fontSize: 15,
    lineHeight: 18
  },
  compactHeaderStack: {
    alignItems: "flex-end",
    flexShrink: 1,
    gap: 8,
    maxWidth: "54%"
  },
  compactHeaderStackEmphasis: {
    maxWidth: "48%"
  },
  eyebrow: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  hero: {
    gap: 12
  },
  heroHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  headerLabel: {
    color: colors.cyan,
    flexShrink: 1,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
    maxWidth: 190,
    textAlign: "right",
    textTransform: "uppercase"
  },
  metrics: {
    gap: 8,
    paddingRight: spacing.pageX
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1
  },
  title: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 35
  },
  titleCompact: {
    fontSize: 25,
    lineHeight: 29
  },
  titleBlock: {
    flexShrink: 0,
    gap: 5
  },
  top: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.pageX,
    paddingVertical: spacing.pageY
  }
});
