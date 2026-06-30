import { Redirect, Tabs, useRouter } from "expo-router";
import {
  Bot,
  Inbox,
  LayoutDashboard,
  Settings,
  UsersRound,
  Waves,
  type LucideIcon,
} from "lucide-react-native";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useVapiCall } from "@/features/assistant/vapi-call-context";
import { useAppearance } from "@/features/appearance/appearance-context";
import { useAuthSession } from "@/features/auth/auth-context";
import { MobileDataWarmup } from "@/features/performance/MobileDataWarmup";
import { colors, radii, typography } from "@/theme";

function tabIcon(Icon: LucideIcon) {
  return function TabIcon({
    color,
    focused,
  }: {
    color: ColorValue;
    focused: boolean;
  }) {
    return (
      <Icon
        color={String(color)}
        size={focused ? 24 : 22}
        strokeWidth={focused ? 2.7 : 2.2}
      />
    );
  };
}

export default function TabLayout() {
  const { status } = useAuthSession();
  const appearance = useAppearance();

  if (status === "loading") {
    return <View style={styles.loadingShell} />;
  }

  if (status !== "signed-in") {
    return <Redirect href="/sign-in" />;
  }

  return (
    <>
      <MobileDataWarmup />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: appearance.colors.text,
          tabBarInactiveTintColor: appearance.colors.muted,
          tabBarItemStyle: {
            borderRadius: 8,
            marginHorizontal: 2,
            paddingBottom: 6,
            paddingTop: 2,
          },
          tabBarLabelStyle: {
            fontFamily: typography.fontFamily,
            fontSize: appearance.scaleFont(11),
            fontWeight: "800",
          },
          tabBarStyle: {
            backgroundColor: appearance.colors.surface,
            borderColor: appearance.colors.line,
            borderTopWidth: 1,
            elevation: 0,
            height: 72,
            paddingBottom: 12,
            paddingHorizontal: 8,
            paddingTop: 4,
          },
        }}
      >
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen
          name="dashboard"
          options={{
            tabBarIcon: tabIcon(LayoutDashboard),
            title: "Dashboard",
          }}
        />
        <Tabs.Screen
          name="assistant"
          options={{
            tabBarIcon: tabIcon(Bot),
            title: "Assistant",
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            tabBarIcon: tabIcon(Inbox),
            title: "Inbox",
          }}
        />
        <Tabs.Screen
          name="crm"
          options={{
            tabBarIcon: tabIcon(UsersRound),
            title: "CRM",
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            tabBarIcon: tabIcon(Settings),
            title: "Settings",
          }}
        />
      </Tabs>
      <PersistentVapiCallIndicator />
    </>
  );
}

function PersistentVapiCallIndicator() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const vapi = useVapiCall();
  const appearance = useAppearance();

  if (!vapi.isConnected) {
    return null;
  }

  return (
    <Pressable
      accessibilityLabel="Return to active Kyro voice call"
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: "/assistant",
          params: { mode: "vapi" },
        })
      }
      style={({ pressed }) => [
        styles.voiceIndicator,
        { top: insets.top + 8 },
        pressed ? styles.voiceIndicatorPressed : null,
      ]}
    >
      <View style={styles.voiceIndicatorIcon}>
        <Waves
          color={appearance.colors.background}
          size={15}
          strokeWidth={2.8}
        />
      </View>
      <Text numberOfLines={1} style={styles.voiceIndicatorText}>
        {vapi.connectionState === "speaking" ? "Speaking" : "Live"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingShell: {
    backgroundColor: colors.background,
    flex: 1,
  },
  voiceIndicator: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: "rgba(17, 18, 25, 0.92)",
    borderColor: "rgba(81, 229, 255, 0.46)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 36,
    paddingLeft: 6,
    paddingRight: 11,
    position: "absolute",
    right: 14,
    zIndex: 40,
  },
  voiceIndicatorIcon: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: radii.pill,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  voiceIndicatorPressed: {
    opacity: 0.76,
  },
  voiceIndicatorText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    maxWidth: 62,
    textTransform: "uppercase",
  },
});
