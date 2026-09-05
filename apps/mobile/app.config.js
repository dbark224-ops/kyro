const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const IS_DEV_CLIENT = process.env.EXPO_USE_DEV_CLIENT === "1";
const DAILY_FOREGROUND_SERVICE =
  "com.daily.reactlibrary.DailyOngoingMeetingForegroundService";

const upsertGradleProperty = (properties, key, value) => {
  const existing = properties.find(
    (property) => property.type === "property" && property.key === key,
  );

  if (existing) {
    existing.value = value;
  } else {
    properties.push({ type: "property", key, value });
  }
};

const withAndroidNativePackagingFixes = (config) => {
  config = withGradleProperties(config, (gradleConfig) => {
    upsertGradleProperty(
      gradleConfig.modResults,
      "expo.useLegacyPackaging",
      "false",
    );

    return gradleConfig;
  });

  return withAppBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
      /\nandroid\.packagingOptions\.jniLibs\.useLegacyPackaging\s*=\s*true\s*\n?/g,
      "\n",
    );

    return gradleConfig;
  });
};

const withFinalAndroidNativePackagingCleanup = (config) =>
  withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const appBuildGradlePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "build.gradle",
      );
      const androidManifestPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "AndroidManifest.xml",
      );

      if (fs.existsSync(appBuildGradlePath)) {
        const contents = fs.readFileSync(appBuildGradlePath, "utf8");
        const cleaned = contents.replace(
          /\nandroid\.packagingOptions\.jniLibs\.useLegacyPackaging\s*=\s*true\s*\n?/g,
          "\n",
        );

        if (cleaned !== contents) {
          fs.writeFileSync(appBuildGradlePath, cleaned);
        }
      }

      if (fs.existsSync(androidManifestPath)) {
        const contents = fs.readFileSync(androidManifestPath, "utf8");
        let hasDailyService = false;
        const cleaned = contents
          .replace(/\sandroid:pageSizeCompat="enabled"/g, "")
          .split(/\r?\n/)
          .filter((line) => {
            if (!line.includes(DAILY_FOREGROUND_SERVICE)) {
              return true;
            }

            if (hasDailyService) {
              return false;
            }

            hasDailyService = true;
            return true;
          })
          .join("\n");

        if (cleaned !== contents) {
          fs.writeFileSync(androidManifestPath, cleaned);
        }
      }

      return modConfig;
    },
  ]);

const withFinalAndroidManifestCleanup = (config) =>
  withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];

    if (application?.$) {
      delete application.$["android:pageSizeCompat"];
    }

    if (application?.service) {
      let hasDailyService = false;
      application.service = application.service.filter((service) => {
        const serviceName = service.$?.["android:name"];

        if (serviceName !== DAILY_FOREGROUND_SERVICE) {
          return true;
        }

        if (hasDailyService) {
          return false;
        }

        hasDailyService = true;
        return true;
      });
    }

    return manifestConfig;
  });

module.exports = {
  expo: {
    name: "Kyro",
    slug: "kyro",
    owner: "dbark24",
    scheme: "kyro",
    version: "0.1.0",
    orientation: "portrait",
    newArchEnabled: false,
    userInterfaceStyle: "dark",
    icon: "./assets/kyro-icon.png",
    splash: {
      image: "./assets/kyro-logo.png",
      resizeMode: "contain",
      backgroundColor: "#08090d",
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: false,
      bundleIdentifier: "ai.kyro.mobile",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          "Kyro uses the camera when you take a photo to attach to an assistant message.",
        NSContactsUsageDescription:
          "Kyro uses contacts so you can choose people to import into CRM.",
        NSFaceIDUsageDescription:
          "Kyro uses Face ID to unlock your saved workspace session.",
        NSMicrophoneUsageDescription:
          "Kyro uses the microphone when you talk to the voice assistant.",
        NSPhotoLibraryUsageDescription:
          "Kyro uses your photo library when you choose images to attach to the assistant.",
      },
    },
    android: {
      package: "ai.kyro.mobile",
      adaptiveIcon: {
        foregroundImage: "./assets/kyro-icon.png",
        backgroundColor: "#08090d",
      },
      permissions: [
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.BLUETOOTH",
        "android.permission.CAMERA",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_CAMERA",
        "android.permission.FOREGROUND_SERVICE_MICROPHONE",
        "android.permission.INTERNET",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.READ_CONTACTS",
        "android.permission.RECORD_AUDIO",
        "android.permission.WAKE_LOCK",
      ],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-font",
      [
        "expo-notifications",
        {
          color: "#51e5ff",
        },
      ],
      [
        "expo-contacts",
        {
          contactsPermission:
            "Kyro uses contacts so you can choose people to import into CRM.",
        },
      ],
      "expo-sharing",
      [
        "expo-local-authentication",
        {
          faceIDPermission:
            "Kyro uses Face ID to unlock your saved workspace session.",
        },
      ],
      [
        "expo-image-picker",
        {
          cameraPermission:
            "Kyro uses the camera when you take a photo for the assistant.",
          photosPermission:
            "Kyro uses your photo library when you attach images to the assistant.",
        },
      ],
      [
        "expo-audio",
        {
          microphonePermission:
            "Kyro uses the microphone when you talk to the voice assistant.",
          recordAudioAndroid: true,
        },
      ],
      "@config-plugins/react-native-webrtc",
      withAndroidNativePackagingFixes,
      withFinalAndroidManifestCleanup,
      "@daily-co/config-plugin-rn-daily-js",
      withFinalAndroidNativePackagingCleanup,
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 24,
          },
          ios: {
            deploymentTarget: "16.4",
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId:
          process.env.EXPO_PROJECT_ID ?? "78a1249a-94e0-4333-a978-6f3251303457",
      },
      useDevClient: IS_DEV_CLIENT,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
      kyroApiBaseUrl: process.env.EXPO_PUBLIC_KYRO_API_BASE_URL ?? "",
      webBaseUrl: process.env.EXPO_PUBLIC_KYRO_WEB_BASE_URL ?? "",
      privacyPolicyUrl:
        process.env.EXPO_PUBLIC_KYRO_PRIVACY_URL ??
        "https://kyroassistant.com/legal/privacy",
      termsOfServiceUrl:
        process.env.EXPO_PUBLIC_KYRO_TERMS_URL ??
        "https://kyroassistant.com/legal/terms",
      accountDeletionUrl:
        process.env.EXPO_PUBLIC_KYRO_ACCOUNT_DELETION_URL ??
        "https://kyroassistant.com/account/delete",
      supportUrl:
        process.env.EXPO_PUBLIC_KYRO_SUPPORT_URL ??
        "https://kyroassistant.com/support",
    },
  },
};
