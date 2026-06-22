import Constants from "expo-constants";
import { Platform } from "react-native";

type ExtraConfig = {
  kyroApiBaseUrl?: unknown;
  supabaseAnonKey?: unknown;
  supabaseUrl?: unknown;
  useDevClient?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;
const rawProcessEnv = process.env as Record<string, string | undefined>;

function defaultKyroApiBaseUrl() {
  if (Platform.OS === "android") {
    return "http://10.0.2.2:3001";
  }

  return "http://localhost:3001";
}

export const mobileEnv = {
  kyroApiBaseUrl:
    stringValue(process.env.EXPO_PUBLIC_KYRO_API_BASE_URL) ||
    stringValue(extra.kyroApiBaseUrl) ||
    defaultKyroApiBaseUrl(),
  supabaseAnonKey:
    stringValue(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
    stringValue(extra.supabaseAnonKey),
  supabaseUrl:
    stringValue(process.env.EXPO_PUBLIC_SUPABASE_URL) ||
    stringValue(extra.supabaseUrl),
  useDevClient:
    rawProcessEnv.EXPO_USE_DEV_CLIENT === "1" || extra.useDevClient === true
};

export const hasSupabaseConfig = Boolean(
  mobileEnv.supabaseUrl && mobileEnv.supabaseAnonKey
);
