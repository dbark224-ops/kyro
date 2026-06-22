# Kyro Mobile

Expo React Native scaffold for the Kyro iOS and Android app. This app lives in `apps/mobile` and keeps mobile-only UI, auth, API-client, and placeholder data isolated from the desktop web app.

## Run Locally

From the repo root:

```bash
npm install
npm --workspace @kyro/mobile run start
```

Then press `i` for iOS Simulator, `a` for Android Emulator, or scan the QR code with Expo Go if your local setup supports it.

Useful mobile scripts:

```bash
npm --workspace @kyro/mobile run ios
npm --workspace @kyro/mobile run android
npm --workspace @kyro/mobile run typecheck
```

PowerShell may block `npm.ps1` on some Windows machines. Use `npm.cmd` for the same commands if that happens.

## Environment

Set the Expo public env vars before testing auth or live API calls:

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_KYRO_API_BASE_URL=http://10.0.2.2:3001
```

Only publishable Supabase values belong in the mobile app. Never put `SUPABASE_SERVICE_ROLE_KEY`, provider secrets, cron secrets, or integration encryption keys in Expo public env vars.

## What Is Scaffolded

- Expo Router tabs for Dashboard, Assistant, Inbox, CRM, and Settings.
- Dark Kyro app shell using copied Kyro logo and Manrope font assets.
- Supabase session provider backed by Expo SecureStore.
- Device-local app unlock for full login, biometric unlock, or no app lock.
- TanStack Query provider for future server state.
- A small typed Kyro API client for backend route calls.
- Dashboard, Assistant, Inbox, CRM, and Settings wired to mobile backend routes.
- Assistant tab mode toggle for Text, Voice, and Vapi Voice interaction surfaces.

Voice mode uses the mobile assistant voice-turn route. Vapi Voice uses the Vapi React Native SDK and fetches its assistant/public-key session from the Kyro backend, so Vapi keys stay server-side.

## Vapi Voice Development Build

The Vapi React Native SDK needs native WebRTC modules and will not run inside Expo Go. Use a development build when testing the Vapi Voice tab:

```bash
set EXPO_USE_DEV_CLIENT=1
npm --workspace @kyro/mobile exec expo prebuild
npm --workspace @kyro/mobile exec expo run:android
```

After the dev client is installed on the emulator, start Metro with:

```bash
set EXPO_USE_DEV_CLIENT=1
npm --workspace @kyro/mobile run start -- --dev-client
```

Vapi tool/webhook callbacks also need `NEXT_PUBLIC_APP_URL` on the web backend to be a public HTTPS URL, such as the same ngrok URL used by the desktop Vapi test.

The native config sets Android min SDK 24 and iOS deployment target 16.4 for Expo 56.

## EAS Builds

Run EAS from the mobile app directory, not from the monorepo root:

```bash
cd apps/mobile
eas build --platform ios --profile production --auto-submit
```

The EAS config lives in `apps/mobile/eas.json` so the cloud builder uses the Expo Router app under `apps/mobile/app`.

## App Unlock

Kyro keeps the Supabase session persisted with SecureStore, then places a local
unlock gate in front of the app. On devices with enrolled biometrics, the first
saved-session default is biometric unlock. On emulators or devices without
biometrics, Kyro falls back to no app lock so local testing does not get trapped.

Change the mode in Settings -> App unlock:

- Biometrics login: keep the session, require Face ID/fingerprint on app open.
- Full login: sign out locally and require email/password.
- No app lock: keep the saved session open on this device.

Because `expo-local-authentication` is native, rebuild the dev client after adding
or changing this feature:

```bash
set EXPO_USE_DEV_CLIENT=1
npm --workspace @kyro/mobile exec expo run:android
```

## Backend For Android Testing

Run the Kyro web backend from this same `kyro-mobile` worktree so mobile calls the matching mobile API routes:

```bash
npm --workspace @kyro/web run dev -- --port 3001
```

For Android Emulator, `10.0.2.2` points back to the host machine. For iOS Simulator, use `http://localhost:3001`.

## Backend Boundary

Mobile should use Supabase Auth for identity and call Kyro backend API routes for privileged actions. Direct Supabase reads are only appropriate once RLS policies and table exposure are intentionally designed for mobile. Service-role secrets and integration credentials must stay server-side.
