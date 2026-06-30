import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { Check, Eye, EyeOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandLockup } from "@/components/BrandLockup";
import { useAuthSession } from "@/features/auth/auth-context";
import { mobileEnv } from "@/lib/env";
import { getRememberDevicePreference } from "@/lib/supabase";
import { colors, radii, spacing, typography } from "@/theme";

export default function SignInScreen() {
  const { signInWithPassword, status } = useAuthSession();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let mounted = true;

    void getRememberDevicePreference().then((storedPreference) => {
      if (mounted) {
        setRememberDevice(storedPreference);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (status === "signed-in") {
    return <Redirect href="/dashboard" />;
  }

  const isDisabled =
    isSubmitting || status === "unconfigured" || !email.trim() || !password;

  const submit = async () => {
    if (isDisabled) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await signInWithPassword(email.trim(), password, { rememberDevice });
      router.replace("/dashboard");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Sign in failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", default: undefined })}
        style={styles.keyboard}
      >
        <View style={styles.shell}>
          <BrandLockup />

          <View style={styles.content}>
            <View style={styles.titleBlock}>
              <Text style={styles.eyebrow}>Kyro Mobile</Text>
              <Text style={styles.title}>Sign in</Text>
            </View>

            <LinearGradient
              colors={[
                "rgba(81, 229, 255, 0.76)",
                "rgba(139, 92, 246, 0.42)",
                "rgba(236, 54, 141, 0.72)",
              ]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.formFrame}
            >
              <View style={styles.form}>
                {status === "unconfigured" ? (
                  <View style={styles.alert}>
                    <Text style={styles.alertText}>
                      Mobile auth environment variables are missing.
                    </Text>
                  </View>
                ) : null}

                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor={colors.muted}
                  returnKeyType="next"
                  style={styles.input}
                  textContentType="emailAddress"
                  value={email}
                />
                <View style={styles.passwordField}>
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setPassword}
                    onSubmitEditing={submit}
                    placeholder="Password"
                    placeholderTextColor={colors.muted}
                    returnKeyType="go"
                    secureTextEntry={!showPassword}
                    style={[styles.input, styles.passwordInput]}
                    textContentType="password"
                    value={password}
                  />
                  <Pressable
                    accessibilityLabel={
                      showPassword ? "Hide password" : "Show password"
                    }
                    accessibilityRole="button"
                    onPress={() => setShowPassword((value) => !value)}
                    style={({ pressed }) => [
                      styles.passwordToggle,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    {showPassword ? (
                      <EyeOff color={colors.text} size={19} strokeWidth={2.2} />
                    ) : (
                      <Eye color={colors.text} size={19} strokeWidth={2.2} />
                    )}
                  </Pressable>
                </View>

                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: rememberDevice }}
                  onPress={() => setRememberDevice((value) => !value)}
                  style={({ pressed }) => [
                    styles.rememberRow,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      rememberDevice ? styles.checkboxChecked : null,
                    ]}
                  >
                    {rememberDevice ? (
                      <Check
                        color={colors.background}
                        size={13}
                        strokeWidth={3}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.rememberText}>
                    Remember me on this device
                  </Text>
                </Pressable>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={isDisabled}
                  onPress={submit}
                  style={({ pressed }) => [
                    styles.submitPressable,
                    pressed && !isDisabled ? styles.pressed : null,
                    isDisabled ? styles.disabled : null,
                  ]}
                >
                  <LinearGradient
                    colors={
                      isDisabled
                        ? [
                            "rgba(246, 247, 251, 0.7)",
                            "rgba(246, 247, 251, 0.7)",
                          ]
                        : [colors.text, "rgba(81, 229, 255, 0.88)"]
                    }
                    end={{ x: 1, y: 0 }}
                    start={{ x: 0, y: 0 }}
                    style={styles.submitButton}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator
                        color={colors.background}
                        size="small"
                      />
                    ) : (
                      <Text style={styles.submitText}>Sign in</Text>
                    )}
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>

            <View style={styles.legalLinks}>
              <LegalLink label="Privacy" url={mobileEnv.privacyPolicyUrl} />
              <Text style={styles.legalSeparator}>|</Text>
              <LegalLink label="Terms" url={mobileEnv.termsOfServiceUrl} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LegalLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      disabled={!url}
      onPress={() => {
        if (url) {
          Linking.openURL(url).catch(() => undefined);
        }
      }}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      <Text style={[styles.legalLink, !url ? styles.disabled : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  alert: {
    backgroundColor: "rgba(236, 54, 141, 0.12)",
    borderColor: "rgba(236, 54, 141, 0.36)",
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  alertText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
  },
  content: {
    flex: 1,
    gap: 18,
    justifyContent: "center",
  },
  checkbox: {
    alignItems: "center",
    borderColor: "rgba(246, 247, 251, 0.24)",
    borderRadius: 7,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  checkboxChecked: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  disabled: {
    opacity: 0.52,
  },
  error: {
    color: colors.pink,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
  },
  eyebrow: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  form: {
    backgroundColor: "rgba(17, 18, 25, 0.98)",
    borderRadius: 13,
    gap: 12,
    padding: 14,
  },
  formFrame: {
    borderRadius: 14,
    padding: 1,
  },
  input: {
    backgroundColor: colors.surfaceSoft,
    borderColor: "rgba(246, 247, 251, 0.1)",
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "600",
    minHeight: 52,
    paddingHorizontal: 14,
  },
  keyboard: {
    flex: 1,
  },
  legalLink: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  legalLinks: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
  },
  legalSeparator: {
    color: colors.line,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.75,
  },
  passwordField: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 52,
  },
  passwordToggle: {
    alignItems: "center",
    bottom: 6,
    justifyContent: "center",
    position: "absolute",
    right: 6,
    top: 6,
    width: 42,
  },
  rememberRow: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 9,
    minHeight: 34,
    paddingRight: 8,
  },
  rememberText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  shell: {
    flex: 1,
    paddingBottom: 18,
    paddingHorizontal: spacing.pageX,
    paddingTop: spacing.pageY,
  },
  submitButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 52,
  },
  submitPressable: {
    borderRadius: radii.md,
    overflow: "hidden",
  },
  submitText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  title: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 44,
  },
  titleBlock: {
    gap: 7,
  },
});
