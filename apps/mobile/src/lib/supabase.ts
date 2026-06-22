import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

import { hasSupabaseConfig, mobileEnv } from "./env";

const REMEMBER_DEVICE_KEY = "kyro.mobile.remember-device.v1";
const memorySessionStorage = new Map<string, string>();

function getWebStorage() {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }

  return globalThis.localStorage;
}

export async function getRememberDevicePreference() {
  const raw =
    Platform.OS === "web"
      ? getWebStorage()?.getItem(REMEMBER_DEVICE_KEY)
      : await SecureStore.getItemAsync(REMEMBER_DEVICE_KEY);

  return raw !== "false";
}

export async function setRememberDevicePreference(rememberDevice: boolean) {
  const value = rememberDevice ? "true" : "false";

  if (Platform.OS === "web") {
    getWebStorage()?.setItem(REMEMBER_DEVICE_KEY, value);
    return;
  }

  await SecureStore.setItemAsync(REMEMBER_DEVICE_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

const secureSessionStorage = {
  async getItem(key: string) {
    if (memorySessionStorage.has(key)) {
      return memorySessionStorage.get(key) ?? null;
    }

    if (!(await getRememberDevicePreference())) {
      return null;
    }

    if (Platform.OS === "web") {
      return getWebStorage()?.getItem(key) ?? null;
    }

    return SecureStore.getItemAsync(key);
  },
  async removeItem(key: string) {
    memorySessionStorage.delete(key);

    if (Platform.OS === "web") {
      getWebStorage()?.removeItem(key);
      return;
    }

    await SecureStore.deleteItemAsync(key);
  },
  async setItem(key: string, value: string) {
    memorySessionStorage.set(key, value);

    if (!(await getRememberDevicePreference())) {
      if (Platform.OS === "web") {
        getWebStorage()?.removeItem(key);
        return;
      }

      await SecureStore.deleteItemAsync(key);
      return;
    }

    if (Platform.OS === "web") {
      getWebStorage()?.setItem(key, value);
      return;
    }

    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    });
  }
};

export const supabase = hasSupabaseConfig
  ? createClient(mobileEnv.supabaseUrl, mobileEnv.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        persistSession: true,
        storage: secureSessionStorage
      }
    })
  : null;
