import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { darkColors, lightColors, type KyroColorPalette } from "@/theme";

export type AppearanceMode = "default" | "light" | "dark";
export type AppTextSize = "compact" | "default" | "large";

type AppearancePreferences = {
  mode: AppearanceMode;
  textSize: AppTextSize;
};

type AppearanceContextValue = AppearancePreferences & {
  colors: KyroColorPalette;
  isLoaded: boolean;
  isLight: boolean;
  saveMode: (mode: AppearanceMode) => Promise<void>;
  saveTextSize: (textSize: AppTextSize) => Promise<void>;
  scaleFont: (size: number) => number;
  textScale: number;
};

const APPEARANCE_STORAGE_KEY = "kyro:appearance:v1";

const defaultPreferences: AppearancePreferences = {
  mode: "default",
  textSize: "default",
};

const textSizeScales: Record<AppTextSize, number> = {
  compact: 0.94,
  default: 1,
  large: 1.08,
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function normalizeAppearancePreferences(
  value: Partial<AppearancePreferences> | null | undefined,
): AppearancePreferences {
  return {
    mode:
      value?.mode === "light" || value?.mode === "dark"
        ? value.mode
        : "default",
    textSize:
      value?.textSize === "compact" || value?.textSize === "large"
        ? value.textSize
        : "default",
  };
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] =
    useState<AppearancePreferences>(defaultPreferences);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(APPEARANCE_STORAGE_KEY)
      .then((stored) => {
        if (!stored || !isMounted) {
          return;
        }

        const parsed = JSON.parse(stored) as Partial<AppearancePreferences>;
        setPreferences(normalizeAppearancePreferences(parsed));
      })
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setIsLoaded(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const persistPreferences = useCallback(
    async (nextPreferences: AppearancePreferences) => {
      setPreferences(nextPreferences);
      await AsyncStorage.setItem(
        APPEARANCE_STORAGE_KEY,
        JSON.stringify(nextPreferences),
      );
    },
    [],
  );

  const saveMode = useCallback(
    async (mode: AppearanceMode) => {
      await persistPreferences(
        normalizeAppearancePreferences({ ...preferences, mode }),
      );
    },
    [persistPreferences, preferences],
  );

  const saveTextSize = useCallback(
    async (textSize: AppTextSize) => {
      await persistPreferences(
        normalizeAppearancePreferences({ ...preferences, textSize }),
      );
    },
    [persistPreferences, preferences],
  );

  const resolvedMode = preferences.mode === "light" ? "light" : "dark";
  const textScale = textSizeScales[preferences.textSize];
  const colors = resolvedMode === "light" ? lightColors : darkColors;

  const value = useMemo<AppearanceContextValue>(
    () => ({
      ...preferences,
      colors,
      isLight: resolvedMode === "light",
      isLoaded,
      saveMode,
      saveTextSize,
      scaleFont: (size: number) => Math.round(size * textScale),
      textScale,
    }),
    [
      colors,
      isLoaded,
      preferences,
      resolvedMode,
      saveMode,
      saveTextSize,
      textScale,
    ],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);

  if (!value) {
    throw new Error("useAppearance must be used inside AppearanceProvider");
  }

  return value;
}
