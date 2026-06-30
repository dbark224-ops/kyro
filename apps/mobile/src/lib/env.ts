import Constants from "expo-constants";
import { Platform } from "react-native";

type ExtraConfig = {
  accountDeletionUrl?: unknown;
  kyroApiBaseUrl?: unknown;
  privacyPolicyUrl?: unknown;
  supabaseAnonKey?: unknown;
  supabaseUrl?: unknown;
  supportUrl?: unknown;
  termsOfServiceUrl?: unknown;
  useDevClient?: unknown;
  webBaseUrl?: unknown;
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

function webUrl(path: string) {
  const baseUrl =
    stringValue(process.env.EXPO_PUBLIC_KYRO_WEB_BASE_URL) ||
    stringValue(extra.webBaseUrl) ||
    stringValue(process.env.EXPO_PUBLIC_KYRO_API_BASE_URL) ||
    stringValue(extra.kyroApiBaseUrl) ||
    "";

  if (!baseUrl) {
    return "";
  }

  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return "";
  }
}

export const mobileEnv = {
  accountDeletionUrl:
    stringValue(process.env.EXPO_PUBLIC_KYRO_ACCOUNT_DELETION_URL) ||
    stringValue(extra.accountDeletionUrl) ||
    webUrl("/account/delete"),
  kyroApiBaseUrl:
    stringValue(process.env.EXPO_PUBLIC_KYRO_API_BASE_URL) ||
    stringValue(extra.kyroApiBaseUrl) ||
    defaultKyroApiBaseUrl(),
  privacyPolicyUrl:
    stringValue(process.env.EXPO_PUBLIC_KYRO_PRIVACY_URL) ||
    stringValue(extra.privacyPolicyUrl) ||
    webUrl("/legal/privacy"),
  supabaseAnonKey:
    stringValue(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
    stringValue(extra.supabaseAnonKey),
  supabaseUrl:
    stringValue(process.env.EXPO_PUBLIC_SUPABASE_URL) ||
    stringValue(extra.supabaseUrl),
  supportUrl:
    stringValue(process.env.EXPO_PUBLIC_KYRO_SUPPORT_URL) ||
    stringValue(extra.supportUrl) ||
    webUrl("/support"),
  termsOfServiceUrl:
    stringValue(process.env.EXPO_PUBLIC_KYRO_TERMS_URL) ||
    stringValue(extra.termsOfServiceUrl) ||
    webUrl("/legal/terms"),
  useDevClient:
    rawProcessEnv.EXPO_USE_DEV_CLIENT === "1" || extra.useDevClient === true,
};

export const hasSupabaseConfig = Boolean(
  mobileEnv.supabaseUrl && mobileEnv.supabaseAnonKey,
);
