import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { ActionButton, SectionCard } from "./ui";
import { useAuthSession } from "@/features/auth/auth-context";
import { colors, typography } from "@/theme";

export function DataState({
  error,
  loading,
  title = "Loading Kyro"
}: {
  error?: Error | null;
  loading?: boolean;
  title?: string;
}) {
  const { status } = useAuthSession();

  if (status === "loading" || loading) {
    return (
      <SectionCard>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.copy}>Fetching workspace data...</Text>
      </SectionCard>
    );
  }

  if (status === "signed-out" || status === "unconfigured") {
    return (
      <SectionCard>
        <Text style={styles.title}>Sign in required</Text>
        <Text style={styles.copy}>
          Mobile uses your Supabase session to call the Kyro backend.
        </Text>
        <ActionButton onPress={() => router.push("/sign-in")}>Sign in</ActionButton>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <SectionCard>
        <Text style={styles.title}>Backend unavailable</Text>
        <Text style={styles.copy}>{error.message}</Text>
      </SectionCard>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  copy: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19
  },
  title: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "900"
  }
});
