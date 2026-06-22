import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import {
  Fingerprint,
  LockKeyhole,
  LogOut,
  ShieldCheck
} from "lucide-react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLockup } from "@/components/BrandLockup";
import { useAuthSession } from "@/features/auth/auth-context";
import { colors, radii, spacing, typography } from "@/theme";

export type AppLockMode = "biometrics" | "passcode" | "none";

type BiometricCapability = {
  available: boolean;
  hasHardware: boolean;
  isEnrolled: boolean;
  label: string;
};

type AppLockContextValue = {
  biometricCapability: BiometricCapability;
  error: string | null;
  isLocked: boolean;
  isReady: boolean;
  lockMode: AppLockMode;
  setupPromptVisible: boolean;
  dismissSetupPrompt: () => Promise<void>;
  setPasscodeLock: (passcode: string) => Promise<void>;
  setLockMode: (mode: AppLockMode) => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
  unlockWithPasscode: (passcode: string) => Promise<boolean>;
};

const APP_LOCK_MODE_KEY = "kyro.mobile.app-lock-mode.v1";
const APP_LOCK_PASSCODE_KEY = "kyro.mobile.app-lock-passcode.v1";
const APP_LOCK_SETUP_PROMPTED_KEY = "kyro.mobile.app-lock-setup-prompted.v1";
const AppLockContext = createContext<AppLockContextValue | null>(null);

const unavailableBiometrics: BiometricCapability = {
  available: false,
  hasHardware: false,
  isEnrolled: false,
  label: "Unavailable"
};

function getWebStorage() {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }

  return globalThis.localStorage;
}

async function getStoredMode() {
  const raw =
    Platform.OS === "web"
      ? getWebStorage()?.getItem(APP_LOCK_MODE_KEY)
      : await SecureStore.getItemAsync(APP_LOCK_MODE_KEY);

  if (raw === "biometrics" || raw === "passcode" || raw === "none") {
    return raw;
  }

  return raw === "full_login" ? "none" : null;
}

async function storeMode(mode: AppLockMode) {
  if (Platform.OS === "web") {
    getWebStorage()?.setItem(APP_LOCK_MODE_KEY, mode);
    return;
  }

  await SecureStore.setItemAsync(APP_LOCK_MODE_KEY, mode, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

async function getStoredPasscode() {
  return Platform.OS === "web"
    ? getWebStorage()?.getItem(APP_LOCK_PASSCODE_KEY) ?? null
    : await SecureStore.getItemAsync(APP_LOCK_PASSCODE_KEY);
}

async function storePasscode(passcode: string) {
  if (Platform.OS === "web") {
    getWebStorage()?.setItem(APP_LOCK_PASSCODE_KEY, passcode);
    return;
  }

  await SecureStore.setItemAsync(APP_LOCK_PASSCODE_KEY, passcode, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

async function clearPasscode() {
  if (Platform.OS === "web") {
    getWebStorage()?.removeItem(APP_LOCK_PASSCODE_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(APP_LOCK_PASSCODE_KEY);
}

async function getSetupPrompted() {
  const raw =
    Platform.OS === "web"
      ? getWebStorage()?.getItem(APP_LOCK_SETUP_PROMPTED_KEY)
      : await SecureStore.getItemAsync(APP_LOCK_SETUP_PROMPTED_KEY);

  return raw === "true";
}

async function storeSetupPrompted() {
  if (Platform.OS === "web") {
    getWebStorage()?.setItem(APP_LOCK_SETUP_PROMPTED_KEY, "true");
    return;
  }

  await SecureStore.setItemAsync(APP_LOCK_SETUP_PROMPTED_KEY, "true", {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

function normalizePasscode(passcode: string) {
  return passcode.replace(/\D/g, "").slice(0, 8);
}

function isValidPasscode(passcode: string) {
  return /^\d{4,8}$/.test(passcode);
}

function labelForTypes(types: LocalAuthentication.AuthenticationType[]) {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return "Face ID";
  }

  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return "Fingerprint";
  }

  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return "Iris";
  }

  return "Biometrics";
}

async function detectBiometrics(): Promise<BiometricCapability> {
  if (Platform.OS === "web") {
    return unavailableBiometrics;
  }

  try {
    const [hasHardware, isEnrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync()
    ]);

    return {
      available: hasHardware && isEnrolled,
      hasHardware,
      isEnrolled,
      label: labelForTypes(types)
    };
  } catch {
    return unavailableBiometrics;
  }
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { status } = useAuthSession();
  const [biometricCapability, setBiometricCapability] =
    useState<BiometricCapability>(unavailableBiometrics);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(true);
  const [lockMode, setLockModeState] = useState<AppLockMode>("none");
  const [setupPromptVisible, setSetupPromptVisible] = useState(false);
  const appStateRef = useRef(AppState.currentState);
  const previousStatusRef = useRef(status);

  useEffect(() => {
    let mounted = true;

    async function loadLockState() {
      const [storedMode, storedPasscode, setupPrompted, capability] = await Promise.all([
        getStoredMode(),
        getStoredPasscode(),
        getSetupPrompted(),
        detectBiometrics()
      ]);

      if (!mounted) {
        return;
      }

      const defaultMode: AppLockMode = "none";
      const nextMode =
        storedMode === "passcode" && !storedPasscode
          ? defaultMode
          : storedMode ?? defaultMode;

      setBiometricCapability(capability);
      setLockModeState(nextMode);
      setIsUnlocked(nextMode === "none");
      setSetupPromptVisible(!setupPrompted);
      setIsReady(true);

      if (!storedMode) {
        void storeMode(nextMode).catch(() => undefined);
      }
    }

    void loadLockState();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;

    if (status !== "signed-in") {
      setIsUnlocked(true);
    } else if (lockMode === "biometrics" || lockMode === "passcode") {
      setIsUnlocked(previousStatus === "signed-out");
    }

    previousStatusRef.current = status;
  }, [lockMode, status]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;

      if (
        status === "signed-in" &&
        previousState === "active" &&
        (nextState === "inactive" || nextState === "background")
      ) {
        if (lockMode === "biometrics" || lockMode === "passcode") {
          setIsUnlocked(false);
        }
      }

      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [lockMode, status]);

  const unlockWithBiometrics = useCallback(async () => {
    setError(null);

    const capability = await detectBiometrics();
    setBiometricCapability(capability);

    if (!capability.available) {
      setError(
        capability.hasHardware
          ? "Biometric unlock is not enrolled on this device."
          : "Biometric unlock is not available on this device."
      );
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      biometricsSecurityLevel: "weak",
      cancelLabel: "Not now",
      disableDeviceFallback: false,
      fallbackLabel: "Use passcode",
      promptDescription: "Your Kyro session stays signed in on this device.",
      promptMessage: "Unlock Kyro",
      promptSubtitle: "Confirm it is you",
      requireConfirmation: false
    });

    if (result.success) {
      setIsUnlocked(true);
      return true;
    }

    if (result.error !== "user_cancel" && result.error !== "system_cancel") {
      setError("Kyro could not verify this device unlock.");
    }

    return false;
  }, []);

  const unlockWithPasscode = useCallback(async (passcode: string) => {
    setError(null);

    const normalized = normalizePasscode(passcode);
    const storedPasscode = await getStoredPasscode();

    if (!storedPasscode) {
      setError("No passcode is saved for this device.");
      return false;
    }

    if (normalized === storedPasscode) {
      setIsUnlocked(true);
      return true;
    }

    setError("That passcode did not match.");
    return false;
  }, []);

  const setPasscodeLock = useCallback(async (passcode: string) => {
    setError(null);

    const normalized = normalizePasscode(passcode);

    if (!isValidPasscode(normalized)) {
      throw new Error("Use a 4 to 8 digit passcode.");
    }

    await storePasscode(normalized);
    await storeMode("passcode");
    await storeSetupPrompted();
    setLockModeState("passcode");
    setIsUnlocked(true);
    setSetupPromptVisible(false);
  }, []);

  const dismissSetupPrompt = useCallback(async () => {
    await storeSetupPrompted();
    setSetupPromptVisible(false);
  }, []);

  const setLockMode = useCallback(
    async (mode: AppLockMode) => {
      setError(null);

      if (mode === "biometrics") {
        const capability = await detectBiometrics();
        setBiometricCapability(capability);

        if (!capability.available) {
          throw new Error(
            capability.hasHardware
              ? "Set up biometrics on this device first."
              : "This device does not support biometric unlock."
          );
        }

        const unlocked = await unlockWithBiometrics();

        if (!unlocked) {
          throw new Error("Biometric verification was cancelled.");
        }
      }

      if (mode === "passcode") {
        const storedPasscode = await getStoredPasscode();

        if (!storedPasscode) {
          throw new Error("Create a local passcode first.");
        }
      }

      await storeMode(mode);
      await storeSetupPrompted();
      setLockModeState(mode);
      setIsUnlocked(true);
      setSetupPromptVisible(false);

      if (mode === "none") {
        await clearPasscode().catch(() => undefined);
      }
    },
    [unlockWithBiometrics]
  );

  const isLocked =
    isReady &&
    status === "signed-in" &&
    (lockMode === "biometrics" || lockMode === "passcode") &&
    !isUnlocked;

  const value = useMemo<AppLockContextValue>(
    () => ({
      biometricCapability,
      error,
      isLocked,
      isReady,
      lockMode,
      setupPromptVisible,
      dismissSetupPrompt,
      setPasscodeLock,
      setLockMode,
      unlockWithBiometrics,
      unlockWithPasscode
    }),
    [
      biometricCapability,
      error,
      isLocked,
      isReady,
      lockMode,
      setupPromptVisible,
      dismissSetupPrompt,
      setPasscodeLock,
      setLockMode,
      unlockWithBiometrics,
      unlockWithPasscode
    ]
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const { signOut, status } = useAuthSession();
  const {
    biometricCapability,
    error,
    isLocked,
    isReady,
    lockMode,
    setupPromptVisible,
    dismissSetupPrompt,
    setLockMode,
    setPasscodeLock,
    unlockWithBiometrics,
    unlockWithPasscode
  } = useAppLock();
  const promptInFlightRef = useRef(false);
  const [passcode, setPasscode] = useState("");
  const [setupPasscode, setSetupPasscode] = useState("");
  const [setupPasscodeConfirm, setSetupPasscodeConfirm] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const shouldLock = isReady && status === "signed-in" && isLocked;
  const shouldShowSetupPrompt =
    isReady && status === "signed-in" && setupPromptVisible;

  useEffect(() => {
    if (!shouldLock || lockMode !== "biometrics" || promptInFlightRef.current) {
      return;
    }

    promptInFlightRef.current = true;
    void unlockWithBiometrics().finally(() => {
      promptInFlightRef.current = false;
    });
  }, [lockMode, shouldLock, unlockWithBiometrics]);

  const submitPasscode = useCallback(() => {
    void unlockWithPasscode(passcode).then((success) => {
      if (!success) {
        setPasscode("");
      }
    });
  }, [passcode, unlockWithPasscode]);

  if (status === "signed-in" && !isReady) {
    return <View style={styles.loadingShell} />;
  }

  if (shouldShowSetupPrompt) {
    const submitSetupPasscode = async () => {
      const normalizedPasscode = normalizePasscode(setupPasscode);
      const normalizedConfirm = normalizePasscode(setupPasscodeConfirm);

      setSetupError(null);

      if (!isValidPasscode(normalizedPasscode)) {
        setSetupError("Use a 4 to 8 digit passcode.");
        return;
      }

      if (normalizedPasscode !== normalizedConfirm) {
        setSetupError("Those passcodes do not match.");
        return;
      }

      try {
        await setPasscodeLock(normalizedPasscode);
      } catch (nextError) {
        setSetupError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to save passcode."
        );
      }
    };

    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <View style={styles.lockShell}>
          <BrandLockup />
          <View style={styles.lockContent}>
            <View style={styles.iconFrame}>
              <ShieldCheck color={colors.cyan} size={28} strokeWidth={2.3} />
            </View>
            <View style={styles.titleBlock}>
              <Text style={styles.eyebrow}>First sign in</Text>
              <Text style={styles.title}>Choose app unlock</Text>
              <Text style={styles.copy}>
                Your Kyro account is signed in on this device. Choose how the app
                should unlock next time.
              </Text>
            </View>
            {setupError ? <Text style={styles.errorText}>{setupError}</Text> : null}
            {biometricCapability.available ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSetupError(null);
                  void setLockMode("biometrics").catch((nextError) => {
                    setSetupError(
                      nextError instanceof Error
                        ? nextError.message
                        : "Unable to enable biometrics."
                    );
                  });
                }}
                style={({ pressed }) => [
                  styles.optionButton,
                  pressed ? styles.pressed : null
                ]}
              >
                <Fingerprint color={colors.text} size={18} strokeWidth={2.3} />
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{biometricCapability.label}</Text>
                  <Text style={styles.optionDetail}>Use device unlock for Kyro.</Text>
                </View>
              </Pressable>
            ) : null}
            <View style={styles.setupPasscodePanel}>
              <View style={styles.statusRow}>
                <LockKeyhole color={colors.text} size={18} strokeWidth={2.3} />
                <Text style={styles.statusText}>Use a Kyro passcode</Text>
              </View>
              <TextInput
                keyboardType="number-pad"
                maxLength={8}
                onChangeText={(value) => setSetupPasscode(normalizePasscode(value))}
                placeholder="New passcode"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={styles.passcodeInput}
                value={setupPasscode}
              />
              <TextInput
                keyboardType="number-pad"
                maxLength={8}
                onChangeText={(value) =>
                  setSetupPasscodeConfirm(normalizePasscode(value))
                }
                placeholder="Confirm passcode"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={styles.passcodeInput}
                value={setupPasscodeConfirm}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => void submitSetupPasscode()}
                style={({ pressed }) => [
                  styles.unlockButton,
                  pressed ? styles.pressed : null
                ]}
              >
                <Text style={styles.unlockButtonText}>Save passcode</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => void setLockMode("none").catch(dismissSetupPrompt)}
              style={styles.signOutButton}
            >
              <Text style={styles.signOutText}>No app lock</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!shouldLock) {
    return <>{children}</>;
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.lockShell}>
        <BrandLockup />
        <View style={styles.lockContent}>
          <View style={styles.iconFrame}>
            <ShieldCheck color={colors.cyan} size={28} strokeWidth={2.3} />
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>Secure session</Text>
            <Text style={styles.title}>Unlock Kyro</Text>
            <Text style={styles.copy}>
              Your workspace session is still signed in. Confirm it is you to
              continue.
            </Text>
          </View>
          <View style={styles.statusPanel}>
            <View style={styles.statusRow}>
              <Fingerprint color={colors.text} size={18} strokeWidth={2.3} />
              <Text style={styles.statusText}>
                {lockMode === "passcode"
                  ? "Local passcode required"
                  : biometricCapability.available
                  ? `${biometricCapability.label} required`
                  : "Biometric setup needed"}
              </Text>
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
          {lockMode === "passcode" ? (
            <View style={styles.passcodeBlock}>
              <TextInput
                autoFocus
                keyboardType="number-pad"
                maxLength={8}
                onChangeText={(value) => setPasscode(normalizePasscode(value))}
                onSubmitEditing={submitPasscode}
                placeholder="Passcode"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={styles.passcodeInput}
                value={passcode}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!isValidPasscode(passcode)}
                onPress={submitPasscode}
                style={({ pressed }) => [
                  styles.unlockButton,
                  !isValidPasscode(passcode) ? styles.disabled : null,
                  pressed ? styles.pressed : null
                ]}
              >
                <LockKeyhole color={colors.background} size={18} strokeWidth={2.5} />
                <Text style={styles.unlockButtonText}>Unlock</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => void unlockWithBiometrics()}
              style={({ pressed }) => [
                styles.unlockButton,
                pressed ? styles.pressed : null
              ]}
            >
              <LockKeyhole color={colors.background} size={18} strokeWidth={2.5} />
              <Text style={styles.unlockButtonText}>Unlock</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => void signOut()}
            style={styles.signOutButton}
          >
            <LogOut color={colors.text} size={17} strokeWidth={2.3} />
            <Text style={styles.signOutText}>Use full sign in</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

export function useAppLock() {
  const value = useContext(AppLockContext);

  if (!value) {
    throw new Error("useAppLock must be used inside AppLockProvider.");
  }

  return value;
}

const styles = StyleSheet.create({
  copy: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    maxWidth: 304
  },
  errorText: {
    color: colors.pink,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18
  },
  disabled: {
    opacity: 0.48
  },
  eyebrow: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  iconFrame: {
    alignItems: "center",
    backgroundColor: "rgba(81, 229, 255, 0.1)",
    borderColor: "rgba(81, 229, 255, 0.34)",
    borderRadius: 18,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    width: 58
  },
  lockContent: {
    flex: 1,
    gap: 18,
    justifyContent: "center",
    paddingBottom: 56
  },
  lockShell: {
    flex: 1,
    paddingBottom: 18,
    paddingHorizontal: spacing.pageX,
    paddingTop: spacing.pageY
  },
  loadingShell: {
    backgroundColor: colors.background,
    flex: 1
  },
  optionButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  optionCopy: {
    flex: 1,
    gap: 3
  },
  optionDetail: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700"
  },
  optionTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900"
  },
  pressed: {
    opacity: 0.72
  },
  passcodeBlock: {
    gap: 12
  },
  passcodeInput: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 18,
    fontWeight: "900",
    minHeight: 52,
    paddingHorizontal: 14
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1
  },
  signOutButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingRight: 12
  },
  signOutText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  setupPasscodePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9
  },
  statusText: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  title: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 46
  },
  titleBlock: {
    gap: 7
  },
  unlockButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.md,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52
  },
  unlockButtonText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900"
  }
});
