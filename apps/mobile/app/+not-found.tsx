import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { colors, radii, typography } from "@/theme";

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Kyro mobile</Text>
      <Text style={styles.title}>That screen is not in the mobile shell yet.</Text>
      <Link href="/assistant" style={styles.link}>
        Back to Assistant
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-start",
    backgroundColor: colors.background,
    flex: 1,
    gap: 14,
    justifyContent: "center",
    padding: 24
  },
  eyebrow: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  link: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.md,
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  title: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 32
  }
});
