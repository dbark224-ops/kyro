import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAudioPlayer } from "expo-audio";
import * as Contacts from "expo-contacts/legacy";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  Activity,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  CreditCard,
  ExternalLink,
  Fingerprint,
  FileText,
  Globe2,
  Image as ImageIcon,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  Mic2,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Volume2,
  X,
} from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { DataState } from "@/components/DataState";
import {
  SkeletonIcon,
  SkeletonLine,
  SkeletonPill,
} from "@/components/LoadingSkeleton";
import { Screen } from "@/components/Screen";
import {
  ActionButton,
  ListRow,
  SectionCard,
  SectionHeader,
  StatusPill,
} from "@/components/ui";
import { useAuthSession } from "@/features/auth/auth-context";
import {
  useAppLock,
  type AppLockMode,
} from "@/features/security/app-lock-context";
import { kyroApiFetch } from "@/lib/kyro-api";
import { mobileEnv } from "@/lib/env";
import {
  mobileDocumentQuoteQueryOptions,
  mobileDocumentsQueryOptions,
  mobileFilePreviewQueryOptions,
  mobileFilesQueryOptions,
  mobilePaymentsQueryOptions,
  mobileQueryKeys,
  mobileSettingsQueryOptions,
  mobileUsageLedgerQueryOptions,
  mobileWorkspaceToolsQueryOptions,
} from "@/lib/mobile-query";
import type {
  MobileActivityLogItem,
  MobileBusinessHourDayKey,
  MobileBusinessHoursDaySettings,
  MobileBusinessHoursScheduleSettings,
  MobileContactImportResponse,
  MobileDocumentsResponse,
  MobileDocumentTemplate,
  MobileEmailSignatureSettings,
  MobileInboundSenderRule,
  MobileOperationalLogItem,
  MobilePaymentLinkResponse,
  MobilePaymentRequest,
  MobilePaymentSetupResponse,
  MobilePaymentsResponse,
  MobileReportPreview,
  MobileSettingsResponse,
  MobileUsageLedgerResponse,
  MobileWorkspaceToolsResponse,
} from "@/lib/mobile-api-types";
import type {
  MobileFileFilter,
  MobileFileItem,
  MobileFileLinkResponse,
  MobileQuoteDraftDetailResponse,
  MobileQuoteDraftListItem,
  MobileQuoteLineItem,
} from "@/lib/mobile-api-types";
import { colors, radii, typography } from "@/theme";

type SettingsSection =
  | "document_generator"
  | "files"
  | "general"
  | "integrations"
  | "phone_sms"
  | "contact_sync"
  | "activity"
  | "developer"
  | "logs"
  | "payments"
  | "reports"
  | "security"
  | "stripe"
  | "voice"
  | "usage"
  | "usage_ledger";
type SettingsGroup =
  | "app_account"
  | "workspace"
  | "communication"
  | "document_generator"
  | "payments"
  | "insight_tools";
type SettingsSaveSection =
  | "communication"
  | "general"
  | "inboundEmail"
  | "pronunciation"
  | "voice";
type GeneralDraft = {
  businessProfile: MobileSettingsResponse["settings"]["general"]["businessProfile"];
  defaultPhoneRegion: string;
  displayCurrency: string;
  timeZone: string;
};
type InboundDraft = {
  actionInstructions: string;
  includeAwarenessEvents: boolean;
  lookbackDays: number;
  maxMessagesPerSync: number;
  pollIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursEnd: string;
  quietHoursStart: string;
  syncMode: string;
};
type CommunicationDraft = {
  aiGeneratedSignature: MobileEmailSignatureSettings;
  aiGeneratedSignatureText: string;
  allowedChannels: string[];
  approvalRequired: boolean;
  manualSignature: MobileEmailSignatureSettings;
  manualSignatureText: string;
  useSeparateAiSignature: boolean;
};
type VoiceDraft = {
  elevenLabsVoicePresetId: string;
  openAiVoice: string;
  outboundVoicePronunciationPolicy: string;
  phoneAgentDemeanor: string;
  phoneAgentEnabled: boolean;
  phoneAgentEscalationMode: string;
  phoneAgentHumourLevel: string;
  phoneAgentInboundEnabled: boolean;
  phoneAgentOutboundEnabled: boolean;
  phoneAgentUserNumbers: string[];
  phoneAgentVerbosity: string;
  phoneAgentVoicemailOverflowEnabled: boolean;
};
type MobileVoiceSettings =
  MobileSettingsResponse["settings"]["voice"];
type PronunciationEntry =
  MobileSettingsResponse["pronunciationEntries"][number];
type SettingsAccount = MobileSettingsResponse["account"];
type DeviceContactImportType =
  | "builder"
  | "client"
  | "contractor"
  | "other"
  | "property_manager"
  | "supplier";
type DeviceContactRow = {
  address: string | null;
  company: string | null;
  email: string | null;
  firstName: string | null;
  id: string;
  lastName: string | null;
  name: string | null;
  phone: string | null;
};
type DocumentLaunch = {
  mode: "invoice";
  nonce: number;
} | null;

const deviceContactImportTypes: DeviceContactImportType[] = [
  "client",
  "supplier",
  "contractor",
  "builder",
  "property_manager",
  "other",
];

const vapiVoiceOptionsFallback: MobileSettingsResponse["options"]["vapiVoices"] =
  [
    {
      accent: "Australian",
      id: "male_australian",
      label: "Male - Australian",
      voiceId: "DYkrAHD8iwork3YSUBbs",
    },
    {
      accent: "Australian",
      id: "female_australian",
      label: "Female - Australian",
      voiceId: "56bWURjYFHyYyVf490Dp",
    },
    {
      accent: "American",
      id: "female_usa",
      label: "Female - USA",
      voiceId: "DODLEQrClDo8wCz460ld",
    },
    {
      accent: "Italian",
      id: "male_italian",
      label: "Male - Italian",
      voiceId: "yowh82B72eMNrxcxHgBh",
    },
    {
      accent: "American",
      id: "male_usa_young_urban_african_american",
      label: "Male - USA - Young urban African American",
      voiceId: "YjlcD3XHztjJEo2wNszv",
    },
    {
      accent: "American",
      id: "male_usa_deep_calming",
      label: "Male - USA - Deep and calming",
      voiceId: "sB7vwSCyX0tQmU24cW2C",
    },
    {
      accent: "American",
      id: "male_usa_upbeat",
      label: "Male - USA - Upbeat",
      voiceId: "7EzWGsX10sAS4c9m9cPf",
    },
    {
      accent: "English",
      id: "male_english_deeper",
      label: "Male - English - Deeper",
      voiceId: "xYo5z1CSHgIA8XSPGcsR",
    },
    {
      accent: "English",
      id: "female_english",
      label: "Female - English",
      voiceId: "lcMyyd2HUfFzxdCaC4Ta",
    },
    {
      accent: "English",
      id: "male_english_upbeat",
      label: "Male - English - Upbeat",
      voiceId: "jRAAK67SEFE9m7ci5DhD",
    },
    {
      accent: "American",
      id: "male_usa_boston",
      label: "Male - USA (Boston)",
      voiceId: "UZvBfqEdvCFLqsBOo9Zr",
    },
    {
      accent: "Irish",
      id: "female_irish",
      label: "Female - Irish",
      voiceId: "sgk995upfe3tYLvoGcBN",
    },
    {
      accent: "Irish",
      id: "male_irish",
      label: "Male - Irish",
      voiceId: "hmMWXCj9K7N5mCPcRkfC",
    },
  ];

const defaultVoiceDraft: VoiceDraft = {
  elevenLabsVoicePresetId: "female_australian",
  openAiVoice: "ballad",
  outboundVoicePronunciationPolicy: "balanced",
  phoneAgentDemeanor: "friendly_direct",
  phoneAgentEnabled: false,
  phoneAgentEscalationMode: "request_callback",
  phoneAgentHumourLevel: "light",
  phoneAgentInboundEnabled: true,
  phoneAgentOutboundEnabled: true,
  phoneAgentUserNumbers: [],
  phoneAgentVerbosity: "concise",
  phoneAgentVoicemailOverflowEnabled: false,
};

const emptySignature: MobileEmailSignatureSettings = {
  logoContentBase64: "",
  logoContentType: "",
  logoFilename: "",
  logoSizeBytes: 0,
  logoUrl: "",
  logoWidthPx: 96,
  text: "",
};

const businessHourDays: Array<{
  key: MobileBusinessHourDayKey;
  label: string;
  shortLabel: string;
}> = [
  { key: "monday", label: "Monday", shortLabel: "Mon" },
  { key: "tuesday", label: "Tuesday", shortLabel: "Tue" },
  { key: "wednesday", label: "Wednesday", shortLabel: "Wed" },
  { key: "thursday", label: "Thursday", shortLabel: "Thu" },
  { key: "friday", label: "Friday", shortLabel: "Fri" },
  { key: "saturday", label: "Saturday", shortLabel: "Sat" },
  { key: "sunday", label: "Sunday", shortLabel: "Sun" },
  { key: "holidays", label: "Holidays", shortLabel: "Holidays" },
];

const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;

  return {
    label: formatTimeLabel(value),
    value,
  };
});

function defaultBusinessHoursSchedule(): MobileBusinessHoursScheduleSettings {
  return {
    days: businessHourDays.map((day) => ({
      day: day.key,
      enabled: ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(
        day.key,
      ),
      endTime: "16:00",
      startTime: "07:00",
    })),
    notes: "",
  };
}

const emptyBusinessProfile: MobileSettingsResponse["settings"]["general"]["businessProfile"] =
  {
    brandAccentColor: "#ec3c96",
    brandPrimaryColor: "#36d7f4",
    brandStyle: "",
    businessAddress: "",
    businessName: "",
    contactHours: "",
    contactHoursSchedule: defaultBusinessHoursSchedule(),
    emergencyJobsEnabled: false,
    industry: "",
    logoContentBase64: "",
    logoContentType: "",
    logoFilename: "",
    logoSizeBytes: 0,
    logoUrl: "",
    logoWidthPx: 120,
    operatingCountry: "",
    publicEmail: "",
    publicPhoneNumber: "",
    serviceArea: "",
    servicePostcodes: "",
    serviceSuburbs: "",
    staffCount: null,
    travelRadiusKm: null,
    workingHours: "",
    workingHoursSchedule: defaultBusinessHoursSchedule(),
  };

type SettingsSectionItem = {
  detail: string;
  eyebrow: string;
  icon: typeof Globe2;
  section: SettingsSection;
  title: string;
};
type SettingsGroupItem = {
  detail: string;
  icon: typeof Globe2;
  id: SettingsGroup;
  sections: SettingsSection[];
  title: string;
};

const sectionItems: SettingsSectionItem[] = [
  {
    detail: "Business details, public info, service area",
    eyebrow: "Business",
    icon: Globe2,
    section: "general",
    title: "Business profile",
  },
  {
    detail: "Email sync, providers, outbound rules",
    eyebrow: "Integrations",
    icon: Mail,
    section: "integrations",
    title: "Connected accounts",
  },
  {
    detail: "Assigned voice and SMS numbers",
    eyebrow: "Phone",
    icon: Mic2,
    section: "phone_sms",
    title: "Phone and SMS",
  },
  {
    detail: "Biometrics, passcode, or no app lock",
    eyebrow: "Security",
    icon: ShieldCheck,
    section: "security",
    title: "App unlock",
  },
  {
    detail: "Realtime voice and pronunciation",
    eyebrow: "Voice",
    icon: Mic2,
    section: "voice",
    title: "Voice assistant",
  },
  {
    detail: "Import selected device contacts",
    eyebrow: "CRM",
    icon: Users,
    section: "contact_sync",
    title: "Phone contacts",
  },
  {
    detail: "Summary, requests, links, and invoices",
    eyebrow: "Payments",
    icon: CreditCard,
    section: "payments",
    title: "Payments",
  },
  {
    detail: "Stripe status and invoice defaults",
    eyebrow: "Stripe",
    icon: CreditCard,
    section: "stripe",
    title: "Stripe",
  },
  {
    detail: "Quote drafts, templates, and PDFs",
    eyebrow: "Documents",
    icon: FileText,
    section: "document_generator",
    title: "Document generator",
  },
  {
    detail: "Generated files, uploads, and attachments",
    eyebrow: "Files",
    icon: FileText,
    section: "files",
    title: "Files library",
  },
  {
    detail: "Build workspace summaries and ledgers",
    eyebrow: "Reports",
    icon: BarChart3,
    section: "reports",
    title: "Report generator",
  },
  {
    detail: "Messages, actions, AI, routing, and usage events",
    eyebrow: "Timeline",
    icon: Activity,
    section: "activity",
    title: "Workspace timeline",
  },
  {
    detail: "Inbound and outbound customer comms",
    eyebrow: "Comms",
    icon: Activity,
    section: "logs",
    title: "Communications log",
  },
  {
    detail: "Health, smoke checks, and internal tools",
    eyebrow: "Developer",
    icon: Code2,
    section: "developer",
    title: "Developer",
  },
  {
    detail: "Usage charge, tasks, provider ledger",
    eyebrow: "Usage",
    icon: Activity,
    section: "usage",
    title: "Usage and billing",
  },
  {
    detail: "Detailed usage event history",
    eyebrow: "Usage",
    icon: Activity,
    section: "usage_ledger",
    title: "Usage ledger",
  },
];

const settingsGroups: SettingsGroupItem[] = [
  {
    detail: "Sign-in, app lock, usage, and billing",
    icon: LockKeyhole,
    id: "app_account",
    sections: ["security", "usage"],
    title: "App & account",
  },
  {
    detail: "Business profile, voice, and CRM imports",
    icon: Globe2,
    id: "workspace",
    sections: ["general", "voice", "contact_sync"],
    title: "Business profile",
  },
  {
    detail: "Email providers, phone numbers, and outbound rules",
    icon: Mail,
    id: "communication",
    sections: ["integrations", "phone_sms"],
    title: "Communication",
  },
  {
    detail: "Quotes, report PDFs, and generated files",
    icon: BarChart3,
    id: "document_generator",
    sections: ["document_generator", "reports", "files"],
    title: "Document Generator",
  },
  {
    detail: "Payment links, invoices, and Stripe setup",
    icon: CreditCard,
    id: "payments",
    sections: ["payments", "stripe"],
    title: "Payments",
  },
  {
    detail: "Internal tools",
    icon: Activity,
    id: "insight_tools",
    sections: ["developer"],
    title: "Developer tools",
  },
];

export default function SettingsScreen() {
  const { session, signOut, status, user } = useAuthSession();
  const [selectedGroup, setSelectedGroup] = useState<SettingsGroup | null>(
    null,
  );
  const [selectedSection, setSelectedSection] =
    useState<SettingsSection | null>(null);
  const [documentLaunch, setDocumentLaunch] = useState<DocumentLaunch>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [generalDraft, setGeneralDraft] = useState<GeneralDraft>({
    businessProfile: emptyBusinessProfile,
    defaultPhoneRegion: "AU",
    displayCurrency: "USD",
    timeZone: "UTC",
  });
  const [inboundDraft, setInboundDraft] = useState<InboundDraft>({
    actionInstructions: "",
    includeAwarenessEvents: true,
    lookbackDays: 7,
    maxMessagesPerSync: 25,
    pollIntervalMinutes: 5,
    quietHoursEnabled: true,
    quietHoursEnd: "04:00",
    quietHoursStart: "22:00",
    syncMode: "automatic",
  });
  const [communicationDraft, setCommunicationDraft] =
    useState<CommunicationDraft>({
      aiGeneratedSignature: emptySignature,
      aiGeneratedSignatureText: "",
      allowedChannels: ["email", "sms", "manual"],
      approvalRequired: true,
      manualSignature: emptySignature,
      manualSignatureText: "",
      useSeparateAiSignature: false,
    });
  const [voiceDraft, setVoiceDraft] =
    useState<VoiceDraft>(defaultVoiceDraft);
  const queryClient = useQueryClient();
  const settingsQueryOptions = mobileSettingsQueryOptions(session);
  const queryKey = settingsQueryOptions.queryKey;
  const settings = useQuery({
    ...settingsQueryOptions,
    enabled: status === "signed-in",
  });
  const data = settings.data;
  const account = data ? settingsAccount(data, user?.email) : null;
  const isSettingsLoading =
    status === "loading" || (status === "signed-in" && settings.isLoading);
  const saveSettings = useMutation({
    mutationFn: ({
      section,
      settings: nextSettings,
    }: {
      section: SettingsSaveSection;
      settings: Record<string, unknown>;
    }) =>
      kyroApiFetch<MobileSettingsResponse>("/api/mobile/settings", {
        body: {
          section,
          settings: nextSettings,
        },
        method: "PATCH",
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to save settings.",
      );
    },
    onSuccess: (nextData) => {
      queryClient.setQueryData(queryKey, nextData);
      setMessage(nextData.message ?? "Settings saved.");
    },
  });
  const resendVerification = useMutation({
    mutationFn: () =>
      kyroApiFetch<MobileSettingsResponse>("/api/mobile/settings", {
        body: { operation: "resend_email_verification" },
        method: "POST",
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to send verification email.",
      );
    },
    onSuccess: (nextData) => {
      queryClient.setQueryData(queryKey, nextData);
      setMessage(nextData.message ?? "Verification email sent.");
    },
  });

  useEffect(() => {
    if (!data) {
      return;
    }

    setGeneralDraft({
      businessProfile:
        normalizeMobileBusinessProfile(data.settings.general.businessProfile),
      defaultPhoneRegion: data.settings.general.defaultPhoneRegion ?? "AU",
      displayCurrency: data.settings.general.displayCurrency,
      timeZone: data.settings.general.timeZone,
    });
    setInboundDraft({
      actionInstructions: data.settings.inboundEmail.actionInstructions,
      includeAwarenessEvents: data.settings.inboundEmail.includeAwarenessEvents,
      lookbackDays: data.settings.inboundEmail.lookbackDays,
      maxMessagesPerSync: data.settings.inboundEmail.maxMessagesPerSync,
      pollIntervalMinutes: data.settings.inboundEmail.pollIntervalMinutes,
      quietHoursEnabled: data.settings.inboundEmail.quietHoursEnabled,
      quietHoursEnd: data.settings.inboundEmail.quietHoursEnd,
      quietHoursStart: data.settings.inboundEmail.quietHoursStart,
      syncMode: data.settings.inboundEmail.syncMode,
    });
    setCommunicationDraft({
      aiGeneratedSignature:
        data.settings.communication.aiGeneratedSignature ?? emptySignature,
      aiGeneratedSignatureText:
        data.settings.communication.aiGeneratedSignatureText,
      allowedChannels: data.settings.communication.allowedChannels,
      approvalRequired: data.settings.communication.approvalRequired,
      manualSignature:
        data.settings.communication.manualSignature ?? emptySignature,
      manualSignatureText: data.settings.communication.manualSignatureText,
      useSeparateAiSignature:
        data.settings.communication.useSeparateAiSignature,
    });
    setVoiceDraft(normalizeVoiceDraft(data.settings.voice));
  }, [data]);

  useEffect(() => {
    if (!selectedSection && !selectedGroup) {
      return undefined;
    }

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (selectedSection) {
          setSelectedSection(null);
        } else {
          setSelectedGroup(null);
        }

        return true;
      },
    );

    return () => subscription.remove();
  }, [selectedGroup, selectedSection]);

  const handleSignOut = async () => {
    setMessage(null);

    try {
      await signOut();
      setMessage("Signed out on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign out failed.");
    }
  };

  return (
    <Screen
      compactHeaderEmphasis
      compactHeaderAccessory={
        data && shouldShowSettingsHeaderUsage(selectedSection) ? (
          <SettingsHeaderUsageChip
            value={data.usage.totals.displayCustomerCharge}
            onPress={() => setSelectedSection("usage")}
          />
        ) : null
      }
      compactHeaderLabel={data?.workspace.name ?? "Workspace"}
      showTopBar={false}
      title="Settings"
      titleScale="compact"
    >
      {isSettingsLoading ? (
        <SettingsLoadingState />
      ) : (
        <DataState
          error={settings.error ?? saveSettings.error}
          loading={false}
          title="Loading settings"
        />
      )}

      {data ? (
        <>
          {selectedSection ? (
            <SettingsDetailTransition section={selectedSection}>
              <SettingsDetailHeader
                section={selectedSection}
                onBack={() => setSelectedSection(null)}
              />
              {message ? <Text style={styles.message}>{message}</Text> : null}

              {selectedSection === "general" ? (
                <GeneralSettingsPanel
                  account={account ?? fallbackSettingsAccount(user?.email)}
                  data={data}
                  disabled={saveSettings.isPending}
                  draft={generalDraft}
                  onChange={setGeneralDraft}
                  onResendVerification={() => resendVerification.mutate()}
                  onSave={() =>
                    saveSettings.mutate({
                      section: "general",
                      settings: generalDraft,
                    })
                  }
                  resendingVerification={resendVerification.isPending}
                />
              ) : null}

              {selectedSection === "integrations" ? (
                <IntegrationsSettingsPanel
                  communicationDraft={communicationDraft}
                  data={data}
                  disabled={saveSettings.isPending}
                  inboundDraft={inboundDraft}
                  onCommunicationChange={setCommunicationDraft}
                  onInboundChange={setInboundDraft}
                  onSaveCommunication={() =>
                    saveSettings.mutate({
                      section: "communication",
                      settings: communicationDraft,
                    })
                  }
                  onSaveInbound={() =>
                    saveSettings.mutate({
                      section: "inboundEmail",
                      settings: inboundDraft,
                    })
                  }
                />
              ) : null}

              {selectedSection === "phone_sms" ? (
                <PhoneSmsSettingsPanel data={data} />
              ) : null}

              {selectedSection === "security" ? (
                <SecuritySettingsPanel />
              ) : null}

              {selectedSection === "voice" ? (
                <VoiceSettingsPanel
                  data={data}
                  disabled={saveSettings.isPending}
                  draft={voiceDraft}
                  onChange={setVoiceDraft}
                  onSave={() =>
                    saveSettings.mutate({
                      section: "voice",
                      settings: voiceDraft,
                    })
                  }
                />
              ) : null}

              {selectedSection === "contact_sync" ? (
                <ContactSyncSettingsPanel />
              ) : null}

              {selectedSection === "payments" ? (
                <PaymentsSettingsPanel
                  onCreateInvoice={() => {
                    setDocumentLaunch({ mode: "invoice", nonce: Date.now() });
                    setSelectedSection("document_generator");
                  }}
                  onOpenStripe={() => setSelectedSection("stripe")}
                />
              ) : null}

              {selectedSection === "stripe" ? <StripeSettingsPanel /> : null}

              {selectedSection === "document_generator" ? (
                <DocumentGeneratorSettingsPanel
                  launch={documentLaunch}
                  onLaunchConsumed={() => setDocumentLaunch(null)}
                />
              ) : null}

              {selectedSection === "files" ? <FilesSettingsPanel /> : null}

              {selectedSection === "reports" ? <ReportsSettingsPanel /> : null}

              {selectedSection === "activity" ? (
                <ActivitySettingsPanel />
              ) : null}

              {selectedSection === "logs" ? (
                <OperationalLogSettingsPanel />
              ) : null}

              {selectedSection === "developer" && data.developer.enabled ? (
                <DeveloperSettingsPanel
                  data={data}
                  disabled={saveSettings.isPending}
                  onSaveVoice={() =>
                    saveSettings.mutate({
                      section: "voice",
                      settings: voiceDraft,
                    })
                  }
                  onVoiceDraftChange={setVoiceDraft}
                  voiceDraft={voiceDraft}
                />
              ) : null}

              {selectedSection === "usage" ? (
                <UsageSettingsPanel
                  data={data}
                  onOpenActivity={() => setSelectedSection("activity")}
                  onOpenCommunicationsLog={() => setSelectedSection("logs")}
                  onOpenLedger={() => setSelectedSection("usage_ledger")}
                />
              ) : null}

              {selectedSection === "usage_ledger" ? (
                <UsageLedgerSettingsPanel data={data} />
              ) : null}
            </SettingsDetailTransition>
          ) : selectedGroup ? (
            <SettingsGroupMenu
              data={data}
              groupId={selectedGroup}
              onBack={() => setSelectedGroup(null)}
              onSelect={setSelectedSection}
            />
          ) : (
            <>
              <SettingsMenu data={data} onSelect={setSelectedGroup} />

              {message ? <Text style={styles.message}>{message}</Text> : null}

              <AccountSessionCard
                emailVerified={account?.emailVerified}
                onSignOut={handleSignOut}
                status={status}
                userEmail={account?.email ?? user?.email}
              />
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function shouldShowSettingsHeaderUsage(section: SettingsSection | null) {
  return (
    section !== "reports" &&
    section !== "activity" &&
    section !== "logs" &&
    section !== "usage_ledger"
  );
}

function SettingsHeaderUsageChip({
  onPress,
  value,
}: {
  onPress: () => void;
  value: string;
}) {
  const displayValue = formatHeaderUsageValue(value);

  return (
    <Pressable
      accessibilityLabel="Open usage and billing"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerUsageChip,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={styles.headerUsageValue}>{displayValue}</Text>
      <Text style={styles.headerUsageLabel}>Usage</Text>
    </Pressable>
  );
}

function formatHeaderUsageValue(value: string) {
  const match = value.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/);

  if (!match) {
    return value;
  }

  const amount = Number(match[0].replace(/,/g, ""));

  if (!Number.isFinite(amount)) {
    return value;
  }

  return `${value.slice(0, match.index)}${amount.toFixed(2)}${value.slice(
    (match.index ?? 0) + match[0].length,
  )}`;
}

function SettingsLoadingState() {
  const visibleItems = settingsGroups;

  return (
    <>
      <SectionCard style={styles.settingsListCard}>
        <SectionHeader eyebrow="Settings" title="Controls" />
        <View style={styles.settingsRowGroup}>
          {visibleItems.map((_, index) => {
            const tone = (["cyan", "purple", "pink"] as const)[index % 3];

            return (
              <View
                key={`${tone}-${index}`}
                style={[
                  styles.settingsLoadingRow,
                  index === visibleItems.length - 1
                    ? styles.settingsRowLast
                    : null,
                ]}
              >
                <SkeletonIcon tone={tone} />
                <View style={styles.settingsRowMain}>
                  <SkeletonLine
                    tone={tone}
                    width={index === 1 ? "46%" : "56%"}
                  />
                </View>
                <ChevronRight color={colors.muted} size={18} />
              </View>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Account" />
        <View style={styles.sessionRow}>
          <View style={styles.sessionCopy}>
            <SkeletonLine tone="cyan" width="58%" />
          </View>
          <SkeletonPill tone="purple" width={70} />
        </View>
        <SkeletonLine height={42} tone="pink" width="100%" />
      </SectionCard>
    </>
  );
}

function SettingsMenu({
  data,
  onSelect,
}: {
  data: MobileSettingsResponse;
  onSelect: (group: SettingsGroup) => void;
}) {
  const visibleGroups = settingsGroups
    .map((group) => ({
      ...group,
      sections: visibleSectionsForGroup(group, data),
    }))
    .filter((group) => group.sections.length > 0);

  return (
    <SectionCard style={styles.settingsListCard}>
      <SectionHeader eyebrow="Settings" title="Controls" />
      <View style={styles.settingsRowGroup}>
        {visibleGroups.map((group, index) => (
          <SettingsGroupRow
            group={group}
            isLast={index === visibleGroups.length - 1}
            key={group.id}
            onPress={() => onSelect(group.id)}
          />
        ))}
      </View>
    </SectionCard>
  );
}

function SettingsGroupMenu({
  data,
  groupId,
  onBack,
  onSelect,
}: {
  data: MobileSettingsResponse;
  groupId: SettingsGroup;
  onBack: () => void;
  onSelect: (section: SettingsSection) => void;
}) {
  const group = settingsGroups.find((candidate) => candidate.id === groupId);
  const visibleItems = group
    ? visibleSectionsForGroup(group, data)
        .map(sectionItemFor)
        .filter((item): item is SettingsSectionItem => Boolean(item))
    : [];
  const Icon = group?.icon ?? Globe2;

  return (
    <SettingsDetailTransition section={groupId}>
      <View style={styles.detailHeader}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}
        >
          <ChevronLeft color={colors.text} size={20} strokeWidth={2.5} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
        <View style={styles.detailTitleRow}>
          <View style={styles.detailTitleIcon}>
            <Icon color={colors.cyan} size={19} strokeWidth={2.3} />
          </View>
          <View style={styles.detailTitleCopy}>
            <Text style={styles.eyebrow}>Settings</Text>
            <Text style={styles.detailTitle}>{group?.title ?? "Settings"}</Text>
          </View>
        </View>
      </View>

      <SectionCard style={styles.settingsListCard}>
        <SectionHeader
          eyebrow="Choose a page"
          title={group?.title ?? "Settings"}
        />
        <View style={styles.settingsRowGroup}>
          {visibleItems.map((item, index) => (
            <SettingsMenuRow
              isLast={index === visibleItems.length - 1}
              item={item}
              key={item.section}
              onPress={() => onSelect(item.section)}
            />
          ))}
        </View>
      </SectionCard>
    </SettingsDetailTransition>
  );
}

function SettingsGroupRow({
  group,
  isLast,
  onPress,
}: {
  group: SettingsGroupItem;
  isLast: boolean;
  onPress: () => void;
}) {
  const Icon = group.icon;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.settingsRow, isLast ? styles.settingsRowLast : null]}
    >
      <View style={styles.settingsRowIcon}>
        <Icon color={colors.text} size={18} strokeWidth={2.3} />
      </View>
      <View style={styles.settingsRowMain}>
        <Text style={styles.settingsRowTitle}>{group.title}</Text>
      </View>
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

function SettingsMenuRow({
  isLast,
  item,
  onPress,
}: {
  isLast: boolean;
  item: (typeof sectionItems)[number];
  onPress: () => void;
}) {
  const Icon = item.icon;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.settingsRow, isLast ? styles.settingsRowLast : null]}
    >
      <View style={styles.settingsRowIcon}>
        <Icon color={colors.text} size={18} strokeWidth={2.3} />
      </View>
      <View style={styles.settingsRowMain}>
        <Text style={styles.settingsRowTitle}>{item.title}</Text>
      </View>
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

function SettingsDetailHeader({
  onBack,
  section,
}: {
  onBack: () => void;
  section: SettingsSection;
}) {
  const item = sectionItems.find((candidate) => candidate.section === section);
  const Icon = item?.icon ?? Globe2;

  return (
    <View style={styles.detailHeader}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <ChevronLeft color={colors.text} size={20} strokeWidth={2.5} />
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
      <View style={styles.detailTitleRow}>
        <View style={styles.detailTitleIcon}>
          <Icon color={colors.cyan} size={19} strokeWidth={2.3} />
        </View>
        <View style={styles.detailTitleCopy}>
          <Text style={styles.eyebrow}>{item?.eyebrow ?? "Settings"}</Text>
          <Text style={styles.detailTitle}>{item?.title ?? "Settings"}</Text>
        </View>
      </View>
    </View>
  );
}

function SettingsDetailTransition({
  children,
  section,
}: {
  children: ReactNode;
  section: SettingsSection | SettingsGroup;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(34)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateX.setValue(34);
    Animated.parallel([
      Animated.timing(opacity, {
        duration: 190,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, section, translateX]);

  return (
    <Animated.View
      style={[
        styles.detailTransition,
        {
          opacity,
          transform: [{ translateX }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function AccountSessionCard({
  emailVerified,
  onSignOut,
  status,
  userEmail,
}: {
  emailVerified?: boolean;
  onSignOut: () => void;
  status: ReturnType<typeof useAuthSession>["status"];
  userEmail?: string;
}) {
  return (
    <SectionCard>
      <SectionHeader title="Account" />
      <View style={styles.sessionRow}>
        <View style={styles.sessionCopy}>
          <Text style={styles.sessionTitle}>
            {status === "signed-in" ? userEmail : "No mobile session"}
          </Text>
        </View>
        <StatusPill
          label={
            status === "signed-in"
              ? emailVerified === false
                ? "Verify email"
                : "Active"
              : "Signed out"
          }
          tone={
            status === "signed-in"
              ? emailVerified === false
                ? "warning"
                : "green"
              : "neutral"
          }
        />
      </View>
      {status === "signed-in" ? (
        <Pressable
          accessibilityRole="button"
          onPress={onSignOut}
          style={styles.iconButton}
        >
          <LogOut color={colors.text} size={18} />
          <Text style={styles.iconButtonText}>Sign out</Text>
        </Pressable>
      ) : (
        <ActionButton onPress={() => router.push("/sign-in")}>
          <View style={styles.buttonInner}>
            <LogIn color={colors.background} size={18} />
            <Text style={styles.primaryButtonText}>Sign in</Text>
          </View>
        </ActionButton>
      )}
    </SectionCard>
  );
}

function GeneralSettingsPanel({
  account,
  data,
  disabled,
  draft,
  onChange,
  onResendVerification,
  onSave,
  resendingVerification,
}: {
  account: SettingsAccount;
  data: MobileSettingsResponse;
  disabled: boolean;
  draft: GeneralDraft;
  onChange: (draft: GeneralDraft) => void;
  onResendVerification: () => void;
  onSave: () => void;
  resendingVerification: boolean;
}) {
  const verificationRequired = account.verificationRequired;
  const saveDisabled = disabled || verificationRequired;
  const updateProfile = <K extends keyof GeneralDraft["businessProfile"]>(
    key: K,
    value: GeneralDraft["businessProfile"][K],
  ) => {
    onChange({
      ...draft,
      businessProfile: {
        ...draft.businessProfile,
        [key]: value,
      },
    });
  };
  const updateServiceArea = (serviceArea: string) => {
    onChange({
      ...draft,
      businessProfile: {
        ...draft.businessProfile,
        serviceArea,
        servicePostcodes: "",
        serviceSuburbs: "",
      },
    });
  };
  const updateBusinessHoursSchedule = (
    key: "contactHoursSchedule" | "workingHoursSchedule",
    schedule: MobileBusinessHoursScheduleSettings,
  ) => {
    const summary = businessHoursScheduleSummary(schedule);
    const textKey = key === "workingHoursSchedule" ? "workingHours" : "contactHours";

    onChange({
      ...draft,
      businessProfile: {
        ...draft.businessProfile,
        [key]: schedule,
        [textKey]: summary,
      },
    });
  };

  return (
    <>
      {verificationRequired ? (
        <EmailVerificationNotice
          email={account.email}
          onResend={onResendVerification}
          resending={resendingVerification}
        />
      ) : null}

      <SectionCard>
        <SectionHeader
          action={<StatusPill label="Profile" tone="cyan" />}
          eyebrow="Business"
          title="Business profile"
        />
        <SettingField label="Business name">
          <TextInput
            editable={!disabled}
            onChangeText={(businessName) =>
              updateProfile("businessName", businessName)
            }
            placeholder="WFA Plumbing"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.businessProfile.businessName}
          />
        </SettingField>
        <SettingField label="Industry">
          <TextInput
            editable={!disabled}
            onChangeText={(industry) => updateProfile("industry", industry)}
            placeholder="Plumbing"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.businessProfile.industry}
          />
        </SettingField>
        <View style={styles.twoColumn}>
          <SettingField label="Operating country">
            <TextInput
              autoCapitalize="characters"
              editable={!disabled}
              onChangeText={(operatingCountry) =>
                updateProfile("operatingCountry", operatingCountry)
              }
              placeholder="AU"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={draft.businessProfile.operatingCountry}
            />
          </SettingField>
          <SettingField label="Default phone region">
            <ReportDropdown
              label="Default phone region"
              onChange={(defaultPhoneRegion) =>
                onChange({ ...draft, defaultPhoneRegion })
              }
              options={(data.options.phoneRegions ?? ["AU", "US", "GB"]).map(
                (region) => ({
                  label: region,
                  value: region,
                }),
              )}
              value={draft.defaultPhoneRegion}
            />
          </SettingField>
        </View>
        <SettingField label="Public email">
          <TextInput
            autoCapitalize="none"
            editable={!disabled}
            keyboardType="email-address"
            onChangeText={(publicEmail) =>
              updateProfile("publicEmail", publicEmail)
            }
            placeholder="hello@example.com"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.businessProfile.publicEmail}
          />
        </SettingField>
        <SettingField label="Public phone">
          <TextInput
            editable={!disabled}
            keyboardType="phone-pad"
            onChangeText={(publicPhoneNumber) =>
              updateProfile("publicPhoneNumber", publicPhoneNumber)
            }
            placeholder="+61..."
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.businessProfile.publicPhoneNumber}
          />
        </SettingField>
        <SettingField label="Business address">
          <TextInput
            editable={!disabled}
            onChangeText={(businessAddress) =>
              updateProfile("businessAddress", businessAddress)
            }
            placeholder="Office or trading address"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.textAreaSmall]}
            multiline
            value={draft.businessProfile.businessAddress}
          />
        </SettingField>
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={draft.businessProfile.emergencyJobsEnabled ? "On" : "Off"}
              tone={
                draft.businessProfile.emergencyJobsEnabled ? "cyan" : "neutral"
              }
            />
          }
          eyebrow="Operations"
          title="Service area"
        />
        <SettingField label="Service area">
          <ServiceAreaTagInput
            disabled={disabled}
            onChange={updateServiceArea}
            value={draft.businessProfile.serviceArea}
          />
        </SettingField>
        <SettingField label="Working hours">
          <BusinessHoursEditor
            disabled={disabled}
            onChange={(schedule) =>
              updateBusinessHoursSchedule("workingHoursSchedule", schedule)
            }
            schedule={draft.businessProfile.workingHoursSchedule}
          />
        </SettingField>
        <SettingField label="Contact hours">
          <BusinessHoursEditor
            disabled={disabled}
            onChange={(schedule) =>
              updateBusinessHoursSchedule("contactHoursSchedule", schedule)
            }
            schedule={draft.businessProfile.contactHoursSchedule}
          />
        </SettingField>
        <SwitchRow
          label="Emergency work"
          onValueChange={(emergencyJobsEnabled) =>
            updateProfile("emergencyJobsEnabled", emergencyJobsEnabled)
          }
          value={draft.businessProfile.emergencyJobsEnabled}
        />
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={<StatusPill label="Defaults" tone="purple" />}
          eyebrow="System"
          title="Workspace defaults"
        />
        <SettingField label="Workspace timezone">
          <TextInput
            autoCapitalize="none"
            editable={!disabled}
            onChangeText={(timeZone) => onChange({ ...draft, timeZone })}
            placeholder="Australia/Brisbane"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.timeZone}
          />
        </SettingField>
        <SettingField label="Display currency">
          <OptionChips
            onChange={(displayCurrency) =>
              onChange({ ...draft, displayCurrency })
            }
            options={data.options.displayCurrencies}
            value={draft.displayCurrency}
          />
        </SettingField>
        <SaveFooter
          disabled={saveDisabled}
          label="Save business profile"
          onPress={onSave}
          text={`Currency uses ${data.settings.general.displayCurrencySourceLabel}.`}
        />
      </SectionCard>
    </>
  );
}

type MobileAddressSuggestion = {
  description: string;
  mainText: string;
  placeId: string;
  secondaryText: string | null;
};

function ServiceAreaTagInput({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const { session } = useAuthSession();
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<MobileAddressSuggestion[]>([]);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionToken = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const tags = splitTags(value);
  const query = draft.trim();

  useEffect(() => {
    if (disabled || !session || query.length < 3) {
      setBusy(false);
      setLookupMessage(null);
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setLookupMessage(null);

    const timer = setTimeout(() => {
      kyroApiFetch<{
        data: MobileAddressSuggestion[];
        unavailable?: boolean;
      }>("/api/mobile/addresses/autocomplete", {
        query: {
          q: query,
          sessionToken: sessionToken.current,
          type: "regions",
        },
        session,
      })
        .then((payload) => {
          if (cancelled) {
            return;
          }

          setSuggestions(payload.data ?? []);
          setLookupMessage(
            payload.unavailable ? "Address lookup is unavailable." : null,
          );
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
            setLookupMessage("Address lookup is unavailable.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setBusy(false);
          }
        });
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [disabled, query, session]);

  const commitTags = (nextValues: string[]) => {
    const nextTags = dedupeTextValues([...tags, ...nextValues]);

    onChange(nextTags.join(", "));
    setDraft("");
    setLookupMessage(null);
    setSuggestions([]);
  };
  const removeTag = (tag: string) => {
    onChange(tags.filter((item) => item !== tag).join(", "));
  };

  return (
    <View style={styles.tagControl}>
      <View style={[styles.tagInputBox, disabled ? styles.disabled : null]}>
        <View style={styles.tagPillList}>
          {tags.map((tag) => (
            <View key={tag} style={styles.tagPill}>
              <Text numberOfLines={1} style={styles.tagPillText}>
                {tag}
              </Text>
              <Pressable
                accessibilityLabel={`Remove ${tag}`}
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => removeTag(tag)}
                style={styles.tagRemoveButton}
              >
                <X color={colors.muted} size={12} strokeWidth={2.5} />
              </Pressable>
            </View>
          ))}
          <TextInput
            autoCapitalize="words"
            editable={!disabled}
            onChangeText={(text) => {
              if (/[,;\n]/.test(text)) {
                commitTags(splitTags(text));
                return;
              }

              setDraft(text);
            }}
            onSubmitEditing={() => commitTags(splitTags(draft))}
            placeholder={tags.length ? "Add another area" : "Add service area"}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            style={styles.tagTextInput}
            value={draft}
          />
        </View>
      </View>

      {suggestions.length ? (
        <View style={styles.suggestionMenu}>
          {suggestions.slice(0, 5).map((suggestion) => (
            <Pressable
              accessibilityRole="button"
              key={suggestion.placeId || suggestion.description}
              onPress={() =>
                commitTags([
                  suggestion.mainText ||
                    suggestion.description ||
                    suggestion.secondaryText ||
                    "",
                ])
              }
              style={styles.suggestionRow}
            >
              <View style={styles.settingsRowMain}>
                <Text numberOfLines={1} style={styles.suggestionTitle}>
                  {suggestion.mainText || suggestion.description}
                </Text>
                {suggestion.secondaryText ? (
                  <Text numberOfLines={1} style={styles.suggestionMeta}>
                    {suggestion.secondaryText}
                  </Text>
                ) : null}
              </View>
              <ChevronRight color={colors.cyan} size={16} />
            </Pressable>
          ))}
          <Text style={styles.googleAttribution}>Powered by Google</Text>
        </View>
      ) : null}
      {busy ? <Text style={styles.lookupMeta}>Searching areas...</Text> : null}
      {lookupMessage ? (
        <Text style={styles.lookupMeta}>{lookupMessage}</Text>
      ) : null}
    </View>
  );
}

function BusinessHoursEditor({
  disabled,
  onChange,
  schedule,
}: {
  disabled: boolean;
  onChange: (schedule: MobileBusinessHoursScheduleSettings) => void;
  schedule: MobileBusinessHoursScheduleSettings;
}) {
  const normalized = normalizeBusinessHoursSchedule(schedule);
  const updateDay = (
    dayKey: MobileBusinessHourDayKey,
    changes: Partial<MobileBusinessHoursDaySettings>,
  ) => {
    onChange({
      ...normalized,
      days: normalized.days.map((day) =>
        day.day === dayKey ? { ...day, ...changes } : day,
      ),
    });
  };

  return (
    <View style={styles.hoursEditor}>
      <View style={styles.hoursSummaryBox}>
        <Text style={styles.rowMeta}>Current</Text>
        <Text numberOfLines={3} style={styles.hoursSummaryText}>
          {businessHoursScheduleSummary(normalized)}
        </Text>
      </View>
      {normalized.days.map((day) => {
        const meta =
          businessHourDays.find((candidate) => candidate.key === day.day) ??
          businessHourDays[0];

        return (
          <View key={day.day} style={styles.hoursDayRow}>
            <View style={styles.hoursDayHeader}>
              <Text style={styles.hoursDayLabel}>{meta.label}</Text>
              <Switch
                disabled={disabled}
                onValueChange={(enabled) => updateDay(day.day, { enabled })}
                thumbColor={day.enabled ? colors.text : colors.muted}
                trackColor={{
                  false: colors.line,
                  true: "rgba(81, 229, 255, 0.48)",
                }}
                value={day.enabled}
              />
            </View>
            <View
              style={[
                styles.hoursTimeRow,
                !day.enabled ? styles.hoursTimeRowDisabled : null,
              ]}
            >
              <ReportDropdown
                compact
                disabled={disabled || !day.enabled}
                label={`${meta.label} start`}
                onChange={(startTime) => updateDay(day.day, { startTime })}
                options={timeOptions}
                value={day.startTime}
              />
              <ReportDropdown
                compact
                disabled={disabled || !day.enabled}
                label={`${meta.label} end`}
                onChange={(endTime) => updateDay(day.day, { endTime })}
                options={timeOptions}
                value={day.endTime}
              />
            </View>
          </View>
        );
      })}
      <TextInput
        editable={!disabled}
        multiline
        onChangeText={(notes) => onChange({ ...normalized, notes })}
        placeholder="Notes for Kyro"
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.textAreaSmall]}
        value={normalized.notes}
      />
    </View>
  );
}

function EmailVerificationNotice({
  email,
  onResend,
  resending,
}: {
  email: string | null;
  onResend: () => void;
  resending: boolean;
}) {
  return (
    <SectionCard>
      <SectionHeader
        action={<StatusPill label="Required" tone="warning" />}
        eyebrow="Email verification"
        title="Verify before editing"
      />
      <Text style={styles.rowCopy}>
        Check {email ?? "your account email"} to unlock Business Profile
        changes.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={resending}
        onPress={onResend}
        style={({ pressed }) => [
          styles.iconButton,
          pressed ? styles.pressed : null,
          resending ? styles.disabledButton : null,
        ]}
      >
        <Mail color={colors.text} size={18} />
        <Text style={styles.iconButtonText}>
          {resending ? "Sending..." : "Resend verification email"}
        </Text>
      </Pressable>
    </SectionCard>
  );
}

function ContactSyncSettingsPanel() {
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const [contacts, setContacts] = useState<DeviceContactRow[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactType, setContactType] =
    useState<DeviceContactImportType>("client");
  const [search, setSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [permissionLabel, setPermissionLabel] = useState("Not loaded");
  const [message, setMessage] = useState<string | null>(null);
  const selectedSet = new Set(selectedContactIds);
  const filteredContacts = contacts.filter((contact) =>
    contactMatchesSearch(contact, search),
  );
  const visibleContacts = filteredContacts.slice(0, visibleLimit);
  const selectedContacts = contacts.filter((contact) =>
    selectedSet.has(contact.id),
  );
  const importContacts = useMutation({
    mutationFn: () =>
      kyroApiFetch<MobileContactImportResponse>(
        "/api/mobile/crm/import-contacts",
        {
          body: {
            contactType,
            contacts: selectedContacts,
          },
          method: "POST",
          session,
        },
      ),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to import contacts.",
      );
    },
    onSuccess: (response) => {
      setSelectedContactIds([]);
      setMessage(response.message);
      queryClient.invalidateQueries({
        queryKey: mobileQueryKeys.crm(session?.user.id),
      });
      queryClient.invalidateQueries({
        queryKey: mobileQueryKeys.dashboard(session?.user.id),
      });
      queryClient.invalidateQueries({
        queryKey: mobileQueryKeys.settings(session?.user.id),
      });
    },
  });

  useEffect(() => {
    setVisibleLimit(80);
  }, [search]);

  const handleLoadContacts = async () => {
    setLoadingContacts(true);
    setMessage(null);

    try {
      const permission = await Contacts.requestPermissionsAsync();

      if (permission.status !== "granted") {
        setPermissionLabel("Denied");
        setMessage("Contacts access was not granted.");
        return;
      }

      setPermissionLabel(
        permission.accessPrivileges === "limited" ? "Limited" : "Granted",
      );

      const result = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.ID,
          Contacts.Fields.Name,
          Contacts.Fields.FirstName,
          Contacts.Fields.LastName,
          Contacts.Fields.Company,
          Contacts.Fields.Emails,
          Contacts.Fields.PhoneNumbers,
          Contacts.Fields.Addresses,
        ],
        pageSize: 0,
        sort: Contacts.SortTypes.FirstName,
      });
      const rows = dedupeDeviceContacts(
        result.data
          .map(normalizeDeviceContact)
          .filter((contact): contact is DeviceContactRow => Boolean(contact)),
      );

      setContacts(rows);
      setSelectedContactIds([]);
      setVisibleLimit(80);
      setMessage(
        rows.length
          ? `${rows.length} phone contacts ready.`
          : "No contacts found.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load contacts.",
      );
    } finally {
      setLoadingContacts(false);
    }
  };

  const toggleContact = (contactId: string) => {
    setSelectedContactIds((current) =>
      current.includes(contactId)
        ? current.filter((id) => id !== contactId)
        : [...current, contactId],
    );
  };

  return (
    <SectionCard>
      <SectionHeader
        action={
          <StatusPill
            label={
              selectedContactIds.length
                ? `${selectedContactIds.length} selected`
                : permissionLabel
            }
            tone={selectedContactIds.length ? "cyan" : "neutral"}
          />
        }
        eyebrow="CRM import"
        title="Phone contacts"
      />

      <View style={styles.contactSyncActions}>
        <Pressable
          accessibilityRole="button"
          disabled={loadingContacts || importContacts.isPending}
          onPress={handleLoadContacts}
          style={[
            styles.iconButton,
            loadingContacts || importContacts.isPending
              ? styles.disabled
              : null,
          ]}
        >
          <Users color={colors.text} size={17} strokeWidth={2.4} />
          <Text style={styles.iconButtonText}>
            {contacts.length ? "Refresh contacts" : "Load contacts"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!selectedContacts.length || importContacts.isPending}
          onPress={() => importContacts.mutate()}
          style={[
            styles.saveButton,
            !selectedContacts.length || importContacts.isPending
              ? styles.disabled
              : null,
          ]}
        >
          <Text style={styles.saveButtonText}>
            {importContacts.isPending ? "Importing" : "Import"}
          </Text>
        </Pressable>
      </View>

      <SettingField label="Import as">
        <OptionChips
          formatOption={formatContactType}
          onChange={(nextType) =>
            setContactType(nextType as DeviceContactImportType)
          }
          options={deviceContactImportTypes}
          value={contactType}
        />
      </SettingField>

      {contacts.length ? (
        <TextInput
          autoCapitalize="none"
          onChangeText={setSearch}
          placeholder="Search phone contacts"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={search}
        />
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {contacts.length ? (
        <View style={styles.contactSyncList}>
          {visibleContacts.map((contact) => {
            const selected = selectedSet.has(contact.id);

            return (
              <Pressable
                accessibilityRole="button"
                key={contact.id}
                onPress={() => toggleContact(contact.id)}
                style={[
                  styles.contactSyncRow,
                  selected ? styles.contactSyncRowSelected : null,
                ]}
              >
                <View
                  style={[
                    styles.contactSyncCheck,
                    selected ? styles.contactSyncCheckSelected : null,
                  ]}
                >
                  {selected ? (
                    <Check
                      color={colors.background}
                      size={13}
                      strokeWidth={3}
                    />
                  ) : null}
                </View>
                <View style={styles.contactSyncCopy}>
                  <Text style={styles.contactSyncName} numberOfLines={1}>
                    {contact.name ??
                      contact.company ??
                      contact.email ??
                      contact.phone}
                  </Text>
                  <Text style={styles.contactSyncMeta} numberOfLines={1}>
                    {[contact.company, contact.email, contact.phone]
                      .filter(Boolean)
                      .join(" - ") || "No email or phone"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {filteredContacts.length > visibleContacts.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleLimit((current) => current + 80)}
              style={styles.iconButton}
            >
              <Plus color={colors.text} size={17} strokeWidth={2.4} />
              <Text style={styles.iconButtonText}>
                Show more ({filteredContacts.length - visibleContacts.length})
              </Text>
            </Pressable>
          ) : null}
          {!filteredContacts.length ? (
            <Text style={styles.emptyCopy}>
              No phone contacts match that search.
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.emptyCopy}>
          Load contacts, choose the people to import, then add them to CRM.
        </Text>
      )}
    </SectionCard>
  );
}

function IntegrationsSettingsPanel({
  communicationDraft,
  data,
  disabled,
  inboundDraft,
  onCommunicationChange,
  onInboundChange,
  onSaveCommunication,
  onSaveInbound,
}: {
  communicationDraft: CommunicationDraft;
  data: MobileSettingsResponse;
  disabled: boolean;
  inboundDraft: InboundDraft;
  onCommunicationChange: (draft: CommunicationDraft) => void;
  onInboundChange: (draft: InboundDraft) => void;
  onSaveCommunication: () => void;
  onSaveInbound: () => void;
}) {
  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={
                data.status.reconnectNeededCount
                  ? "Reconnect"
                  : `${data.status.connectedAccountCount} connected`
              }
              tone={data.status.reconnectNeededCount ? "warning" : "green"}
            />
          }
          eyebrow="Providers"
          title="Connected accounts"
        />
        {data.connections.length ? (
          data.connections.map((connection) => (
            <ListRow
              key={connection.id}
              right={
                <StatusPill
                  label={
                    connection.needsReconnect ? "Reconnect" : connection.status
                  }
                  tone={connection.needsReconnect ? "warning" : "neutral"}
                />
              }
            >
              <Text style={styles.rowTitle}>
                {connection.providerLabel}{" "}
                {connection.accountName ? `- ${connection.accountName}` : ""}
              </Text>
              <Text style={styles.rowCopy}>
                {connection.accountEmail ?? "No account email"} -{" "}
                {connection.readReady
                  ? "read scope ready"
                  : "read scope missing"}
              </Text>
              <Text style={styles.rowMeta}>
                Last sync {formatDate(connection.lastSyncAt)}
              </Text>
            </ListRow>
          ))
        ) : (
          <Text style={styles.emptyCopy}>
            No Google or Outlook account connected.
          </Text>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={
                inboundDraft.syncMode === "automatic"
                  ? `Every ${inboundDraft.pollIntervalMinutes} min`
                  : inboundSyncModeLabel(inboundDraft.syncMode)
              }
              tone="cyan"
            />
          }
          eyebrow="Inbound email"
          title="Email awareness"
        />
        <SettingField label="Sync mode">
          <OptionChips
            formatOption={inboundSyncModeLabel}
            onChange={(syncMode) =>
              onInboundChange({ ...inboundDraft, syncMode })
            }
            options={data.options.inboundSyncModes}
            value={inboundDraft.syncMode}
          />
        </SettingField>
        <SettingField label="Daytime poll frequency">
          <OptionChips
            formatOption={(value) => `${value} min`}
            onChange={(value) =>
              onInboundChange({
                ...inboundDraft,
                pollIntervalMinutes: Number(value),
              })
            }
            options={data.options.inboundPollIntervals.map(String)}
            value={String(inboundDraft.pollIntervalMinutes)}
          />
        </SettingField>
        <SwitchRow
          label="Quiet hours"
          onValueChange={(quietHoursEnabled) =>
            onInboundChange({ ...inboundDraft, quietHoursEnabled })
          }
          value={inboundDraft.quietHoursEnabled}
        />
        <View style={styles.twoColumn}>
          <SettingField label="Start">
            <TextInput
              editable={!disabled}
              onChangeText={(quietHoursStart) =>
                onInboundChange({ ...inboundDraft, quietHoursStart })
              }
              placeholder="22:00"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={inboundDraft.quietHoursStart}
            />
          </SettingField>
          <SettingField label="End">
            <TextInput
              editable={!disabled}
              onChangeText={(quietHoursEnd) =>
                onInboundChange({ ...inboundDraft, quietHoursEnd })
              }
              placeholder="04:00"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={inboundDraft.quietHoursEnd}
            />
          </SettingField>
        </View>
        <View style={styles.twoColumn}>
          <SettingField label="Lookback days">
            <NumberInput
              disabled={disabled}
              onChange={(lookbackDays) =>
                onInboundChange({ ...inboundDraft, lookbackDays })
              }
              value={inboundDraft.lookbackDays}
            />
          </SettingField>
          <SettingField label="Fetch cap">
            <NumberInput
              disabled={disabled}
              onChange={(maxMessagesPerSync) =>
                onInboundChange({ ...inboundDraft, maxMessagesPerSync })
              }
              value={inboundDraft.maxMessagesPerSync}
            />
          </SettingField>
        </View>
        <SwitchRow
          label="Skipped-mail summaries"
          onValueChange={(includeAwarenessEvents) =>
            onInboundChange({ ...inboundDraft, includeAwarenessEvents })
          }
          value={inboundDraft.includeAwarenessEvents}
        />
        <SettingField label="Action rules">
          <TextInput
            editable={!disabled}
            multiline
            onChangeText={(actionInstructions) =>
              onInboundChange({ ...inboundDraft, actionInstructions })
            }
            placeholder="Promote business-actionable email..."
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.textArea]}
            textAlignVertical="top"
            value={inboundDraft.actionInstructions}
          />
        </SettingField>
        <EmailSyncHealthSummary data={data} />
        <SenderRulesManager data={data} disabled={disabled} />
        <SaveFooter
          disabled={disabled}
          label="Save inbound rules"
          onPress={onSaveInbound}
          text={`${data.settings.inboundEmail.senderRuleCount} sender rules saved.`}
        />
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={
                communicationDraft.approvalRequired
                  ? "Approval required"
                  : "Auto outbound"
              }
              tone={communicationDraft.approvalRequired ? "purple" : "warning"}
            />
          }
          eyebrow="Outbound"
          title="Communication rules"
        />
        <SwitchRow
          label="Approval before outbound"
          onValueChange={(approvalRequired) =>
            onCommunicationChange({ ...communicationDraft, approvalRequired })
          }
          value={communicationDraft.approvalRequired}
        />
        <SettingField label="Allowed channels">
          <MultiOptionChips
            onChange={(allowedChannels) =>
              onCommunicationChange({ ...communicationDraft, allowedChannels })
            }
            options={data.options.outboundChannels}
            value={communicationDraft.allowedChannels}
          />
        </SettingField>
        <SignatureEditor
          disabled={disabled}
          label="Default email signature"
          signature={{
            ...communicationDraft.manualSignature,
            text: communicationDraft.manualSignatureText,
          }}
          onChange={(manualSignature) =>
            onCommunicationChange({
              ...communicationDraft,
              manualSignature,
              manualSignatureText: manualSignature.text,
            })
          }
        />
        <SwitchRow
          label="Separate assistant signature"
          onValueChange={(useSeparateAiSignature) =>
            onCommunicationChange({
              ...communicationDraft,
              useSeparateAiSignature,
            })
          }
          value={communicationDraft.useSeparateAiSignature}
        />
        {communicationDraft.useSeparateAiSignature ? (
          <SignatureEditor
            disabled={disabled}
            label="Assistant signature"
            signature={{
              ...communicationDraft.aiGeneratedSignature,
              text: communicationDraft.aiGeneratedSignatureText,
            }}
            onChange={(aiGeneratedSignature) =>
              onCommunicationChange({
                ...communicationDraft,
                aiGeneratedSignature,
                aiGeneratedSignatureText: aiGeneratedSignature.text,
              })
            }
          />
        ) : null}
        <SaveFooter
          disabled={disabled}
          label="Save communication"
          onPress={onSaveCommunication}
          text="Email can send through connected providers; phone and SMS stay internal."
        />
      </SectionCard>
    </>
  );
}

function PhoneSmsSettingsPanel({ data }: { data: MobileSettingsResponse }) {
  const phoneSms = normalizePhoneSmsSettingsData(data);
  const voiceNumbers = phoneSms.numbers.filter(
    (number) => number.capabilities.voice,
  ).length;
  const smsNumbers = phoneSms.numbers.filter(
    (number) => number.capabilities.sms,
  ).length;
  const defaultPhoneRegion = data.settings.general.defaultPhoneRegion || "AU";

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={phoneSms.configured ? "Enabled" : "Not assigned"}
              tone={phoneSms.configured ? "green" : "neutral"}
            />
          }
          eyebrow="Phone and SMS"
          title="Workspace numbers"
        />
        <View style={styles.summaryStrip}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Voice</Text>
            <Text style={styles.summaryValue}>{voiceNumbers}</Text>
            <Text style={styles.summaryMeta}>call-capable numbers</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>SMS</Text>
            <Text style={styles.summaryValue}>{smsNumbers}</Text>
            <Text style={styles.summaryMeta}>text-capable numbers</Text>
          </View>
        </View>
        {phoneSms.numbers.length ? (
          phoneSms.numbers.map((number) => (
            <ListRow
              key={number.id}
              right={
                <StatusPill label={formatLabel(number.status)} tone="cyan" />
              }
            >
              <Text style={styles.rowTitle}>{number.phoneNumber}</Text>
              <Text style={styles.rowCopy}>
                {[
                  number.friendlyName,
                  number.countryCode,
                  number.region,
                  number.capabilities.voice ? "Voice" : null,
                  number.capabilities.sms ? "SMS" : null,
                  number.capabilities.mms ? "MMS" : null,
                ]
                  .filter(Boolean)
                  .join(" - ")}
              </Text>
              <Text style={styles.rowMeta}>
                {number.monthlyCostSnapshot
                  ? `${number.currency} ${number.monthlyCostSnapshot}/mo`
                  : "No monthly snapshot"}{" "}
                {number.vapiPhoneNumberId
                  ? `- Vapi ${number.vapiPhoneNumberId}`
                  : ""}
              </Text>
            </ListRow>
          ))
        ) : (
          <Text style={styles.emptyCopy}>
            No workspace phone or SMS number is assigned yet. Use the web
            settings screen to assign or release numbers.
          </Text>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={defaultPhoneRegion}
              tone="purple"
            />
          }
          eyebrow="Routing"
          title="Defaults"
        />
        <ListRow>
          <Text style={styles.rowTitle}>Public phone</Text>
          <Text style={styles.rowCopy}>
            {data.settings.general.businessProfile.publicPhoneNumber ||
              "Not set"}
          </Text>
        </ListRow>
        <ListRow>
          <Text style={styles.rowTitle}>Default phone region</Text>
          <Text style={styles.rowCopy}>{defaultPhoneRegion}</Text>
        </ListRow>
      </SectionCard>
    </>
  );
}

function normalizePhoneSmsSettingsData(data: MobileSettingsResponse) {
  const phoneSms =
    data.phoneSms as
      | MobileSettingsResponse["phoneSms"]
      | null
      | undefined;
  const numbers = Array.isArray(phoneSms?.numbers) ? phoneSms.numbers : [];

  return {
    configured: Boolean(phoneSms?.configured && numbers.length),
    numbers: numbers.map((number, index) => ({
      capabilities: {
        mms: Boolean(number.capabilities?.mms),
        sms: Boolean(number.capabilities?.sms),
        voice: Boolean(number.capabilities?.voice),
      },
      countryCode: number.countryCode ?? null,
      currency: number.currency || "USD",
      friendlyName: number.friendlyName ?? null,
      id: number.id || `${number.phoneNumber || "phone"}-${index}`,
      monthlyCostSnapshot: Number.isFinite(number.monthlyCostSnapshot)
        ? number.monthlyCostSnapshot
        : 0,
      normalizedPhone: number.normalizedPhone ?? null,
      phoneNumber: number.phoneNumber || number.normalizedPhone || "Unknown number",
      providerPhoneNumberId: number.providerPhoneNumberId ?? null,
      region: number.region ?? null,
      status: number.status || "active",
      vapiPhoneNumberId: number.vapiPhoneNumberId ?? null,
    })),
  };
}

function SenderRulesManager({
  data,
  disabled,
}: {
  data: MobileSettingsResponse;
  disabled: boolean;
}) {
  const { session } = useAuthSession();
  const queryClient = useQueryClient();
  const [match, setMatch] = useState<MobileInboundSenderRule["match"]>("email");
  const [action, setAction] = useState("always_promote");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mutateRule = useMutation({
    mutationFn: (payload: {
      operation: "remove_sender_rule" | "upsert_sender_rule";
      settings: Record<string, unknown>;
    }) =>
      kyroApiFetch<MobileSettingsResponse>("/api/mobile/settings", {
        body: {
          operation: payload.operation,
          section: "inboundEmail",
          settings: payload.settings,
        },
        method: "PATCH",
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update sender rule.",
      );
    },
    onSuccess: (nextData) => {
      queryClient.setQueryData(
        mobileSettingsQueryOptions(session).queryKey,
        nextData,
      );
      setValue("");
      setMessage(nextData.message ?? "Sender rules updated.");
    },
  });

  return (
    <View style={styles.nestedPanel}>
      <SectionHeader
        action={
          <StatusPill
            label={`${data.settings.inboundEmail.senderRuleCount}`}
            tone="purple"
          />
        }
        eyebrow="Sender rules"
        title="Email handling"
      />
      <View style={styles.twoColumn}>
        <SettingField label="Match">
          <OptionChips
            onChange={(next) =>
              setMatch(next as MobileInboundSenderRule["match"])
            }
            options={["email", "domain"]}
            value={match}
          />
        </SettingField>
        <SettingField label="Action">
          <OptionChips
            formatOption={(next) =>
              next === "always_promote" ? "Relevant" : "Ignored"
            }
            onChange={setAction}
            options={data.options.inboundSenderRuleActions}
            value={action}
          />
        </SettingField>
      </View>
      <TextInput
        editable={!disabled && !mutateRule.isPending}
        onChangeText={setValue}
        placeholder={match === "email" ? "sender@example.com" : "example.com"}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={value}
      />
      <Pressable
        accessibilityRole="button"
        disabled={disabled || mutateRule.isPending || !value.trim()}
        onPress={() =>
          mutateRule.mutate({
            operation: "upsert_sender_rule",
            settings: { action, match, value },
          })
        }
        style={[
          styles.saveButton,
          disabled || !value.trim() ? styles.disabled : null,
        ]}
      >
        <Text style={styles.saveButtonText}>Save sender rule</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {data.settings.inboundEmail.senderRules.length ? (
        data.settings.inboundEmail.senderRules.map((rule) => (
          <ListRow
            key={`${rule.match}:${rule.value}`}
            right={
              <Pressable
                accessibilityRole="button"
                disabled={disabled || mutateRule.isPending}
                onPress={() =>
                  mutateRule.mutate({
                    operation: "remove_sender_rule",
                    settings: rule,
                  })
                }
              >
                <Trash2 color={colors.muted} size={17} />
              </Pressable>
            }
          >
            <Text style={styles.rowTitle}>{rule.value}</Text>
            <Text style={styles.rowCopy}>
              {formatLabel(rule.match)} -{" "}
              {rule.action === "always_promote" ? "relevant" : "ignored"}
            </Text>
          </ListRow>
        ))
      ) : (
        <Text style={styles.emptyCopy}>No sender rules saved.</Text>
      )}
    </View>
  );
}

function SignatureEditor({
  disabled,
  label,
  onChange,
  signature,
}: {
  disabled: boolean;
  label: string;
  onChange: (signature: MobileEmailSignatureSettings) => void;
  signature: MobileEmailSignatureSettings;
}) {
  const pickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      base64: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    const base64 =
      asset.base64 ??
      (asset.uri
        ? await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          })
        : "");

    onChange({
      ...signature,
      logoContentBase64: base64,
      logoContentType: asset.mimeType ?? "image/jpeg",
      logoFilename: asset.fileName ?? "signature-logo.jpg",
      logoSizeBytes: base64 ? Math.round((base64.length * 3) / 4) : 0,
    });
  };
  const logoUri = signature.logoContentBase64
    ? `data:${signature.logoContentType || "image/png"};base64,${signature.logoContentBase64}`
    : signature.logoUrl || null;

  return (
    <View style={styles.nestedPanel}>
      <SettingField label={label}>
        <TextInput
          editable={!disabled}
          multiline
          onChangeText={(text) => onChange({ ...signature, text })}
          placeholder="Signature text"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.textAreaSmall]}
          textAlignVertical="top"
          value={signature.text}
        />
      </SettingField>
      <View style={styles.twoColumn}>
        <SettingField label="Logo URL">
          <TextInput
            editable={!disabled}
            onChangeText={(logoUrl) => onChange({ ...signature, logoUrl })}
            placeholder="https://..."
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={signature.logoUrl}
          />
        </SettingField>
        <SettingField label="Width">
          <NumberInput
            disabled={disabled}
            onChange={(logoWidthPx) => onChange({ ...signature, logoWidthPx })}
            value={signature.logoWidthPx}
          />
        </SettingField>
      </View>
      <View style={styles.signaturePreview}>
        {logoUri ? (
          <Image
            resizeMode="contain"
            source={{ uri: logoUri }}
            style={[
              styles.signatureLogo,
              { width: Math.min(180, signature.logoWidthPx) },
            ]}
          />
        ) : null}
        <Text style={styles.rowCopy}>
          {signature.text || "Signature preview"}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => void pickLogo()}
        style={[styles.iconButton, disabled ? styles.disabled : null]}
      >
        <Upload color={colors.cyan} size={16} />
        <Text style={styles.iconButtonText}>Upload logo</Text>
      </Pressable>
    </View>
  );
}

function SecuritySettingsPanel() {
  const { biometricCapability, error, lockMode, setPasscodeLock, setLockMode } =
    useAppLock();
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeConfirm, setPasscodeConfirm] = useState("");
  const [isPasscodeSetupOpen, setIsPasscodeSetupOpen] = useState(false);

  const chooseMode = async (mode: AppLockMode) => {
    if (mode === lockMode || isSaving) {
      return;
    }

    setMessage(null);
    setIsSaving(true);

    try {
      await setLockMode(mode);
      setIsPasscodeSetupOpen(false);
      setMessage(`${appLockModeLabel(mode)} enabled on this device.`);
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update app unlock.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const savePasscodeMode = async () => {
    const normalizedPasscode = normalizeSecurityPasscode(passcode);
    const normalizedConfirm = normalizeSecurityPasscode(passcodeConfirm);

    setMessage(null);

    if (!isValidSecurityPasscode(normalizedPasscode)) {
      setMessage("Use a 4 to 8 digit passcode.");
      return;
    }

    if (normalizedPasscode !== normalizedConfirm) {
      setMessage("Those passcodes do not match.");
      return;
    }

    setIsSaving(true);

    try {
      await setPasscodeLock(normalizedPasscode);
      setPasscode("");
      setPasscodeConfirm("");
      setIsPasscodeSetupOpen(false);
      setMessage("Passcode login enabled on this device.");
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : "Unable to save passcode.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={<StatusPill label={appLockModeLabel(lockMode)} tone="cyan" />}
          eyebrow="Security"
          title="App unlock"
        />
        <SecurityModeOption
          active={lockMode === "biometrics"}
          description={
            biometricCapability.available
              ? `Use ${biometricCapability.label} each time Kyro opens.`
              : "Set up device biometrics before using this mode."
          }
          disabled={isSaving || !biometricCapability.available}
          icon={Fingerprint}
          onPress={() => void chooseMode("biometrics")}
          title="Biometrics login"
        />
        <SecurityModeOption
          active={lockMode === "passcode"}
          description={
            lockMode === "passcode"
              ? "Local passcode is set. Tap to change it."
              : "Use a local passcode when biometrics are not available."
          }
          disabled={isSaving}
          icon={LockKeyhole}
          onPress={() => {
            setMessage(null);
            setIsPasscodeSetupOpen((current) => !current);
          }}
          title="Passcode login"
        />
        {isPasscodeSetupOpen ? (
          <View style={styles.passcodeSetup}>
            <TextInput
              keyboardType="number-pad"
              maxLength={8}
              onChangeText={(value) =>
                setPasscode(normalizeSecurityPasscode(value))
              }
              placeholder="New passcode"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              value={passcode}
            />
            <TextInput
              keyboardType="number-pad"
              maxLength={8}
              onChangeText={(value) =>
                setPasscodeConfirm(normalizeSecurityPasscode(value))
              }
              placeholder="Confirm passcode"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              value={passcodeConfirm}
            />
            <ActionButton
              disabled={isSaving}
              onPress={() => void savePasscodeMode()}
            >
              Save passcode
            </ActionButton>
          </View>
        ) : null}
        <SecurityModeOption
          active={lockMode === "none"}
          description="Keep Kyro open on this device while the session is valid."
          disabled={isSaving}
          icon={ShieldCheck}
          onPress={() => void chooseMode("none")}
          title="No app lock"
        />
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {error ? <Text style={styles.securityError}>{error}</Text> : null}
      </SectionCard>

      <SectionCard>
        <SectionHeader eyebrow="Device" title="Biometric status" />
        <View style={styles.securitySummary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Method</Text>
            <Text style={styles.summaryValue}>{biometricCapability.label}</Text>
            <Text style={styles.summaryMeta}>
              {biometricCapability.hasHardware
                ? "Hardware detected"
                : "No biometric hardware detected"}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Enrollment</Text>
            <Text style={styles.summaryValue}>
              {biometricCapability.isEnrolled ? "Ready" : "Not enrolled"}
            </Text>
            <Text style={styles.summaryMeta}>
              {biometricCapability.available
                ? "Kyro can use local unlock"
                : "Use passcode or no app lock"}
            </Text>
          </View>
        </View>
      </SectionCard>
    </>
  );
}

function SecurityModeOption({
  active,
  description,
  disabled,
  icon: Icon,
  onPress,
  title,
}: {
  active: boolean;
  description: string;
  disabled: boolean;
  icon: typeof ShieldCheck;
  onPress: () => void;
  title: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.securityMode,
        active ? styles.securityModeActive : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.securityModeIcon}>
        <Icon
          color={active ? colors.background : colors.text}
          size={18}
          strokeWidth={2.4}
        />
      </View>
      <View style={styles.settingsRowMain}>
        <Text
          style={[
            styles.settingsRowTitle,
            active ? styles.securityModeTitleActive : null,
          ]}
        >
          {title}
        </Text>
        <Text
          numberOfLines={2}
          style={[
            styles.settingsRowDetail,
            active ? styles.securityModeDetailActive : null,
          ]}
        >
          {description}
        </Text>
      </View>
      {active ? <Check color={colors.background} size={16} /> : null}
    </Pressable>
  );
}

function VoiceSettingsPanel({
  data,
  disabled,
  draft,
  onChange,
  onSave,
}: {
  data: MobileSettingsResponse;
  disabled: boolean;
  draft: VoiceDraft;
  onChange: (draft: VoiceDraft) => void;
  onSave: () => void;
}) {
  const voiceSettings = normalizeMobileVoiceSettings(data.settings.voice);
  const optionSets = data.options ?? ({} as MobileSettingsResponse["options"]);
  const baseVapiVoiceOptions =
    optionSets.vapiVoices?.length > 0
      ? optionSets.vapiVoices
      : vapiVoiceOptionsFallback;
  const savedVapiVoiceOption = {
    accent: voiceSettings.elevenLabsVoiceAccent || "Vapi",
    id: voiceSettings.elevenLabsVoicePresetId,
    label: voiceSettings.elevenLabsVoiceLabel || "Saved Vapi voice",
    voiceId: voiceSettings.elevenLabsVoiceId,
  };
  const vapiVoiceOptions =
    savedVapiVoiceOption.id &&
    !baseVapiVoiceOptions.some((voice) => voice.id === savedVapiVoiceOption.id)
      ? [savedVapiVoiceOption, ...baseVapiVoiceOptions]
      : baseVapiVoiceOptions;
  const activeVapiVoice =
    vapiVoiceOptions.find(
      (voice) => voice.id === draft.elevenLabsVoicePresetId,
    ) ?? vapiVoiceOptions[0];

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={activeVapiVoice?.accent ?? "Vapi"}
              tone="purple"
            />
          }
          eyebrow="Voice"
          title="Voice assistant"
        />
        <SettingField label="Vapi voice">
          <ReportDropdown
            label="Vapi voice"
            onChange={(elevenLabsVoicePresetId) =>
              onChange({ ...draft, elevenLabsVoicePresetId })
            }
            options={vapiVoiceOptions.map((voice) => ({
              description: voice.accent,
              label: voice.label,
              value: voice.id,
            }))}
            value={draft.elevenLabsVoicePresetId}
          />
        </SettingField>
        <SettingField label="Outbound pronunciation">
          <OptionChips
            formatOption={policyLabel}
            onChange={(outboundVoicePronunciationPolicy) =>
              onChange({ ...draft, outboundVoicePronunciationPolicy })
            }
            options={
              optionSets.outboundVoicePronunciationPolicies?.length
                ? optionSets.outboundVoicePronunciationPolicies
                : ["balanced"]
            }
            value={draft.outboundVoicePronunciationPolicy}
          />
        </SettingField>
        <SaveFooter
          disabled={disabled}
          label="Save voice settings"
          onPress={onSave}
        />
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={draft.phoneAgentEnabled ? "Enabled" : "Off"}
              tone={draft.phoneAgentEnabled ? "green" : "neutral"}
            />
          }
          eyebrow="Calls"
          title="Phone assistant"
        />
        <SwitchRow
          label="Enable phone assistant"
          onValueChange={(phoneAgentEnabled) =>
            onChange({ ...draft, phoneAgentEnabled })
          }
          value={draft.phoneAgentEnabled}
        />
        <View style={styles.twoColumn}>
          <SwitchRow
            label="Inbound calls"
            onValueChange={(phoneAgentInboundEnabled) =>
              onChange({ ...draft, phoneAgentInboundEnabled })
            }
            value={draft.phoneAgentInboundEnabled}
          />
          <SwitchRow
            label="Outbound calls"
            onValueChange={(phoneAgentOutboundEnabled) =>
              onChange({ ...draft, phoneAgentOutboundEnabled })
            }
            value={draft.phoneAgentOutboundEnabled}
          />
        </View>
        <SwitchRow
          label="Voicemail overflow"
          onValueChange={(phoneAgentVoicemailOverflowEnabled) =>
            onChange({ ...draft, phoneAgentVoicemailOverflowEnabled })
          }
          value={draft.phoneAgentVoicemailOverflowEnabled}
        />
        <SettingField label="Demeanor">
          <ReportDropdown
            label="Demeanor"
            onChange={(phoneAgentDemeanor) =>
              onChange({ ...draft, phoneAgentDemeanor })
            }
            options={voiceOptionValues(
              optionSets.phoneAgentDemeanors,
              draft.phoneAgentDemeanor,
            ).map((value) => ({
              label: formatLabel(value),
              value,
            }))}
            value={draft.phoneAgentDemeanor}
          />
        </SettingField>
        <SettingField label="Detail">
          <ReportDropdown
            label="Detail"
            onChange={(phoneAgentVerbosity) =>
              onChange({ ...draft, phoneAgentVerbosity })
            }
            options={voiceOptionValues(
              optionSets.phoneAgentVerbosities,
              draft.phoneAgentVerbosity,
            ).map((value) => ({
              label: formatLabel(value),
              value,
            }))}
            value={draft.phoneAgentVerbosity}
          />
        </SettingField>
        <SettingField label="Warmth">
          <ReportDropdown
            label="Warmth"
            onChange={(phoneAgentHumourLevel) =>
              onChange({ ...draft, phoneAgentHumourLevel })
            }
            options={voiceOptionValues(
              optionSets.phoneAgentHumourLevels,
              draft.phoneAgentHumourLevel,
            ).map((value) => ({
              label: formatLabel(value),
              value,
            }))}
            value={draft.phoneAgentHumourLevel}
          />
        </SettingField>
        <SettingField label="Escalation">
          <ReportDropdown
            label="Escalation"
            onChange={(phoneAgentEscalationMode) =>
              onChange({ ...draft, phoneAgentEscalationMode })
            }
            options={voiceOptionValues(
              optionSets.phoneAgentEscalationModes,
              draft.phoneAgentEscalationMode,
            ).map((value) => ({
              label: formatLabel(value),
              value,
            }))}
            value={draft.phoneAgentEscalationMode}
          />
        </SettingField>
        <SettingField label="Team phone numbers">
          <TextInput
            editable={!disabled}
            multiline
            onChangeText={(text) =>
              onChange({
                ...draft,
                phoneAgentUserNumbers: text
                  .split(/[\n,]+/)
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              })
            }
            placeholder="+614..., one per line"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.textAreaSmall]}
            textAlignVertical="top"
            value={(draft.phoneAgentUserNumbers ?? []).join("\n")}
          />
        </SettingField>
        <SaveFooter
          disabled={disabled}
          label="Save phone assistant"
          onPress={onSave}
        />
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={`${data.pronunciationEntries?.length ?? 0} entries`}
              tone="cyan"
            />
          }
          eyebrow="Vocabulary"
          title="Pronunciation list"
        />
        <PronunciationManager data={data} disabled={disabled} />
      </SectionCard>
    </>
  );
}

function PronunciationManager({
  data,
  disabled,
}: {
  data: MobileSettingsResponse;
  disabled: boolean;
}) {
  const { session } = useAuthSession();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PronunciationEntry | null>(
    null,
  );
  const [phrase, setPhrase] = useState("");
  const [pronunciationHint, setPronunciationHint] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [category, setCategory] = useState("other");
  const [status, setStatus] = useState("approved");
  const [message, setMessage] = useState<string | null>(null);

  const resetDraft = () => {
    setSelectedEntry(null);
    setPhrase("");
    setPronunciationHint("");
    setAliasesText("");
    setCategory("other");
    setStatus("approved");
  };
  const saveEntry = useMutation({
    mutationFn: ({
      operation,
      settings,
    }: {
      operation?: "remove";
      settings: Record<string, unknown>;
    }) =>
      kyroApiFetch<MobileSettingsResponse>("/api/mobile/settings", {
        body: {
          operation,
          section: "pronunciation",
          settings,
        },
        method: "PATCH",
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save pronunciation.",
      );
    },
    onSuccess: (nextData) => {
      queryClient.setQueryData(
        mobileSettingsQueryOptions(session).queryKey,
        nextData,
      );
      resetDraft();
      setEditorOpen(false);
      setMessage(nextData.message ?? "Pronunciation updated.");
    },
  });
  const previewEntry = async (id: string) => {
    try {
      setMessage("Preparing preview...");
      const url = new URL(
        "/api/mobile/settings/pronunciation-preview",
        mobileEnv.kyroApiBaseUrl,
      );
      url.searchParams.set("entryId", id);
      const response = await fetch(url.toString(), {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : "Unable to preview pronunciation.",
        );
      }

      const contentType = response.headers.get("Content-Type") ?? "audio/mpeg";
      const bytes = new Uint8Array(await response.arrayBuffer());
      const extension = contentType.includes("wav") ? "wav" : "mp3";
      const uri = `${FileSystem.cacheDirectory}kyro-pronunciation-${id}.${extension}`;

      await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      const player = createAudioPlayer({ uri }, { downloadFirst: false });
      player.play();
      setMessage("Playing pronunciation preview.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to preview pronunciation.",
      );
    }
  };
  const editEntry = (entry: PronunciationEntry) => {
    setSelectedEntry(entry);
    setPhrase(entry.phrase);
    setPronunciationHint(entry.pronunciationHint ?? "");
    setAliasesText(entry.aliases.join(", "));
    setCategory(entry.category);
    setStatus(entry.status);
    setMessage(null);
    setEditorOpen(true);
  };
  const addEntry = () => {
    resetDraft();
    setMessage(null);
    setEditorOpen(true);
  };
  const entrySettings = (entry?: PronunciationEntry) => ({
    aliasesText: entry ? entry.aliases.join(", ") : aliasesText,
    category: entry?.category ?? category,
    entryId: entry?.id ?? selectedEntry?.id ?? null,
    phrase: entry?.phrase ?? phrase,
    pronunciationHint: entry
      ? (entry.pronunciationHint ?? "")
      : pronunciationHint,
    status: entry?.status ?? status,
  });
  const submitEntry = () => {
    saveEntry.mutate({
      settings: entrySettings(),
    });
  };
  const removeEntry = (entry: PronunciationEntry) => {
    saveEntry.mutate({
      operation: "remove",
      settings: entrySettings(entry),
    });
  };
  const closeEditor = () => {
    resetDraft();
    setEditorOpen(false);
  };

  return (
    <>
      <View style={styles.pronunciationHeaderRow}>
        <Text style={styles.pronunciationCount}>
          {data.pronunciationEntries.length}{" "}
          {data.pronunciationEntries.length === 1 ? "entry" : "entries"}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={disabled || saveEntry.isPending}
          onPress={addEntry}
          style={[
            styles.pronunciationAddButton,
            disabled ? styles.disabled : null,
          ]}
        >
          <Plus color={colors.background} size={15} />
          <Text style={styles.pronunciationAddButtonText}>Add</Text>
        </Pressable>
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {data.pronunciationEntries.length ? (
        <View style={styles.pronunciationList}>
          {data.pronunciationEntries.map((entry) => (
            <View key={entry.id} style={styles.pronunciationListRow}>
              <Pressable
                accessibilityRole="button"
                disabled={disabled || saveEntry.isPending}
                onPress={() => editEntry(entry)}
                style={styles.pronunciationRowMain}
              >
                <Text numberOfLines={1} style={styles.rowTitle}>
                  {entry.phrase}
                </Text>
                <Text numberOfLines={1} style={styles.rowCopy}>
                  {entry.pronunciationHint
                    ? `Say it like ${entry.pronunciationHint}`
                    : "Tap to add say-it-like guidance"}
                </Text>
              </Pressable>
              <View style={styles.pronunciationRowActions}>
                <Pressable
                  accessibilityLabel={`Preview ${entry.phrase}`}
                  accessibilityRole="button"
                  disabled={disabled || saveEntry.isPending}
                  onPress={() => void previewEntry(entry.id)}
                  style={styles.pronunciationIconButton}
                >
                  <Volume2 color={colors.cyan} size={17} />
                </Pressable>
                <Pressable
                  accessibilityLabel={`Remove ${entry.phrase}`}
                  accessibilityRole="button"
                  disabled={disabled || saveEntry.isPending}
                  onPress={() => removeEntry(entry)}
                  style={[
                    styles.pronunciationIconButton,
                    styles.pronunciationRemoveButton,
                  ]}
                >
                  <X color="#ff5c7a" size={17} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyCopy}>
          No active pronunciation entries yet.
        </Text>
      )}

      <Modal
        animationType="fade"
        onRequestClose={closeEditor}
        transparent
        visible={editorOpen}
      >
        <Pressable
          accessibilityRole="button"
          onPress={closeEditor}
          style={styles.dropdownBackdrop}
        >
          <Pressable style={styles.pronunciationEditorSheet}>
            <ScrollView
              contentContainerStyle={styles.pronunciationEditorContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.pronunciationEditorHeader}>
                <View style={styles.settingsRowMain}>
                  <Text style={styles.dropdownTitle}>
                    {selectedEntry ? "Edit pronunciation" : "Add pronunciation"}
                  </Text>
                  {selectedEntry ? (
                    <Text style={styles.rowMeta}>
                      {pronunciationEntryPill(selectedEntry)}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityLabel="Close pronunciation editor"
                  accessibilityRole="button"
                  onPress={closeEditor}
                  style={styles.pronunciationIconButton}
                >
                  <X color={colors.muted} size={18} />
                </Pressable>
              </View>

              {selectedEntry ? (
                <View style={styles.pronunciationMetaGrid}>
                  <View style={styles.pronunciationMetaCell}>
                    <Text style={styles.pronunciationMetaLabel}>Source</Text>
                    <Text style={styles.pronunciationMetaValue}>
                      {pronunciationEntrySourceLabel(selectedEntry)}
                    </Text>
                  </View>
                  <View style={styles.pronunciationMetaCell}>
                    <Text style={styles.pronunciationMetaLabel}>Usage</Text>
                    <Text style={styles.pronunciationMetaValue}>
                      {pronunciationUsageLabel(selectedEntry)}
                    </Text>
                  </View>
                </View>
              ) : null}

              <SettingField label="Phrase">
                <TextInput
                  editable={!disabled && !saveEntry.isPending}
                  onChangeText={setPhrase}
                  placeholder="Woolloongabba"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={phrase}
                />
              </SettingField>
              <SettingField label="Say it like">
                <TextInput
                  editable={!disabled && !saveEntry.isPending}
                  onChangeText={setPronunciationHint}
                  placeholder="wuh-lun-gabba"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={pronunciationHint}
                />
              </SettingField>
              <SettingField label="Category">
                <ReportDropdown
                  label="Pronunciation category"
                  onChange={setCategory}
                  options={data.options.pronunciationCategories.map(
                    (value) => ({
                      label: formatLabel(value),
                      value,
                    }),
                  )}
                  value={category}
                />
              </SettingField>
              <SettingField label="Aliases">
                <TextInput
                  editable={!disabled && !saveEntry.isPending}
                  multiline
                  onChangeText={setAliasesText}
                  placeholder="comma-separated, optional"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.textAreaSmall]}
                  value={aliasesText}
                />
              </SettingField>

              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled || saveEntry.isPending || !phrase.trim()}
                  onPress={submitEntry}
                  style={[
                    styles.saveButton,
                    styles.actionRowButton,
                    !phrase.trim() ? styles.disabled : null,
                  ]}
                >
                  <Text style={styles.saveButtonText}>
                    {selectedEntry ? "Save changes" : "Add entry"}
                  </Text>
                </Pressable>
                {selectedEntry ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={disabled || saveEntry.isPending}
                    onPress={() => removeEntry(selectedEntry)}
                    style={[styles.iconButton, styles.actionRowButton]}
                  >
                    <Trash2 color="#ff5c7a" size={16} />
                    <Text style={styles.iconButtonText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function pronunciationUsageLabel(entry: PronunciationEntry) {
  const usage =
    entry.usageCount === 1 ? "Used once" : `Used ${entry.usageCount} times`;

  return entry.lastSeenAt
    ? `${usage} - last ${formatDate(entry.lastSeenAt)}`
    : usage;
}

function pronunciationEntrySourceLabel(entry: PronunciationEntry) {
  return entry.source === "manual"
    ? "Manual entry"
    : entry.source === "assistant"
      ? "Assistant updated"
      : "Auto-added";
}

function pronunciationEntryPill(entry: PronunciationEntry) {
  return entry.source === "manual" || entry.source === "assistant"
    ? "Custom pronunciation"
    : "Auto pronunciation";
}

function UsageSettingsPanel({
  data,
  onOpenActivity,
  onOpenCommunicationsLog,
  onOpenLedger,
}: {
  data: MobileSettingsResponse;
  onOpenActivity: () => void;
  onOpenCommunicationsLog: () => void;
  onOpenLedger: () => void;
}) {
  const { session } = useAuthSession();
  const [usageWindow, setUsageWindow] = useState(data.usage.activeWindow);
  const usage = useQuery({
    enabled: Boolean(session),
    queryFn: () =>
      kyroApiFetch<MobileSettingsResponse>("/api/mobile/settings", {
        query: { usageWindow },
        session,
      }),
    queryKey: ["mobile-settings-usage", session?.user.id, usageWindow],
    staleTime: 60 * 1000,
  });
  const activeData = usage.data ?? data;

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill label={activeData.usage.activeWindow} tone="pink" />
          }
          eyebrow="Usage"
          title="Usage and billing"
        />
        <SettingField label="Window">
          <OptionChips
            onChange={setUsageWindow}
            options={activeData.usage.windows}
            value={usageWindow}
          />
        </SettingField>
        <View style={styles.usageHero}>
          <Text style={styles.usageLabel}>Usage charge</Text>
          <Text style={styles.usageValue}>
            {activeData.usage.totals.displayCustomerCharge}
          </Text>
          <Text style={styles.rowCopy}>
            {activeData.usage.totals.events} ledger events - generated{" "}
            {formatDate(activeData.usage.generatedAt)}
          </Text>
        </View>
      </SectionCard>

      <SectionCard>
        <SectionHeader eyebrow="Task usage" title="Usage by task" />
        {activeData.usage.taskBreakdown.length ? (
          activeData.usage.taskBreakdown.map((row) => (
            <ListRow
              key={row.key}
              right={
                <Text style={styles.moneyText}>
                  {row.displayCustomerCharge}
                </Text>
              }
            >
              <Text style={styles.rowTitle}>{row.label}</Text>
              <Text style={styles.rowCopy}>{row.description}</Text>
              <Text style={styles.rowMeta}>{row.events} events</Text>
            </ListRow>
          ))
        ) : (
          <Text style={styles.emptyCopy}>
            No metered task usage in this range.
          </Text>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeader eyebrow="Provider" title="Provider and model" />
        {activeData.usage.providerBreakdown.length ? (
          activeData.usage.providerBreakdown.map((row) => (
            <ListRow
              key={row.key}
              right={
                <Text style={styles.moneyText}>
                  {row.displayCustomerCharge}
                </Text>
              }
            >
              <Text style={styles.rowTitle}>
                {formatLabel(row.provider)} / {row.model}
              </Text>
              <Text style={styles.rowCopy}>{formatLabel(row.service)}</Text>
              <Text style={styles.rowMeta}>{row.events} events</Text>
            </ListRow>
          ))
        ) : (
          <Text style={styles.emptyCopy}>No provider usage in this range.</Text>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeader
          action={
            <StatusPill label={`${activeData.usage.totals.events}`} tone="cyan" />
          }
          eyebrow="Ledger"
          title="Usage ledger"
        />
        <Pressable
          accessibilityRole="button"
          onPress={onOpenLedger}
          style={({ pressed }) => [
            styles.inlineActionRow,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.inlineActionCopy}>
            <Text style={styles.rowTitle}>Open detailed ledger</Text>
            <Text style={styles.rowCopy}>
              Loads event history only when you need it.
            </Text>
          </View>
          <ChevronRight color={colors.muted} size={18} />
        </Pressable>
      </SectionCard>

      <SectionCard>
        <SectionHeader eyebrow="Communications" title="Communications log" />
        <Pressable
          accessibilityRole="button"
          onPress={onOpenCommunicationsLog}
          style={({ pressed }) => [
            styles.inlineActionRow,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.inlineActionCopy}>
            <Text style={styles.rowTitle}>Inbound and outbound comms</Text>
            <Text style={styles.rowCopy}>
              Review sync, email, SMS, and outbound communication traces.
            </Text>
          </View>
          <ChevronRight color={colors.muted} size={18} />
        </Pressable>
      </SectionCard>

      <SectionCard>
        <SectionHeader eyebrow="Timeline" title="Workspace timeline" />
        <Pressable
          accessibilityRole="button"
          onPress={onOpenActivity}
          style={({ pressed }) => [
            styles.inlineActionRow,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.inlineActionCopy}>
            <Text style={styles.rowTitle}>Activity across the workspace</Text>
            <Text style={styles.rowCopy}>
              Review messages, actions, audit entries, AI runs, routing, and usage.
            </Text>
          </View>
          <ChevronRight color={colors.muted} size={18} />
        </Pressable>
      </SectionCard>
    </>
  );
}

function UsageLedgerSettingsPanel({ data }: { data: MobileSettingsResponse }) {
  const { session } = useAuthSession();
  const [usageWindow, setUsageWindow] = useState(data.usage.activeWindow);
  const usage = useQuery(mobileUsageLedgerQueryOptions(session, usageWindow));
  const ledgerData: MobileUsageLedgerResponse | null = usage.data ?? null;
  const windows = ledgerData?.windows.length
    ? ledgerData.windows
    : data.usage.windows;

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            ledgerData ? (
              <StatusPill label={`${ledgerData.ledger.length}`} tone="cyan" />
            ) : null
          }
          eyebrow="Usage"
          title="Usage ledger"
        />
        <SettingField label="Window">
          <OptionChips
            onChange={setUsageWindow}
            options={windows}
            value={usageWindow}
          />
        </SettingField>
        {ledgerData ? (
          <View style={styles.usageHero}>
            <Text style={styles.usageLabel}>Usage charge</Text>
            <Text style={styles.usageValue}>
              {ledgerData.totals.displayCustomerCharge}
            </Text>
            <Text style={styles.rowCopy}>
              {ledgerData.totals.events} ledger events - generated{" "}
              {formatDate(ledgerData.generatedAt)}
            </Text>
          </View>
        ) : null}
      </SectionCard>

      <SectionCard>
        <SectionHeader eyebrow="Events" title="Detailed history" />
        {usage.isLoading ? (
          <DataState loading title="Loading usage ledger" />
        ) : usage.error ? (
          <DataState
            error={usage.error}
            loading={false}
            title="Loading usage ledger"
          />
        ) : ledgerData?.ledger.length ? (
          ledgerData.ledger.map((row) => (
            <ListRow
              key={row.id}
              right={
                <Text style={styles.moneyText}>
                  {row.displayCustomerCharge}
                </Text>
              }
            >
              <Text style={styles.rowTitle}>{row.taskLabel}</Text>
              <Text numberOfLines={2} style={styles.rowCopy}>
                {formatLabel(row.provider)} / {row.model} - {row.sourceLabel}
              </Text>
              <Text style={styles.rowMeta}>
                {row.quantity} {row.unit} - {formatDate(row.createdAt)}
              </Text>
            </ListRow>
          ))
        ) : (
          <Text style={styles.emptyCopy}>No ledger rows in this range.</Text>
        )}
      </SectionCard>
    </>
  );
}

function ReportsSettingsPanel() {
  const { session, status } = useAuthSession();
  const [reportType, setReportType] = useState("communications_log");
  const [timeframe, setTimeframe] = useState("this_month");
  const [direction, setDirection] = useState("all");
  const [channel, setChannel] = useState("all");
  const [contactId, setContactId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [preview, setPreview] = useState<MobileReportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const reportFilters = {
    channel,
    contactId,
    direction,
    end: timeframe === "custom" ? endDate : "",
    start: timeframe === "custom" ? startDate : "",
    timeframe,
    type: reportType,
  };
  const tools = useQuery({
    ...mobileWorkspaceToolsQueryOptions(session),
    enabled: status === "signed-in",
  });
  const reportData = tools.data?.reports;
  const generateReport = useMutation({
    mutationFn: () =>
      kyroApiFetch<MobileWorkspaceToolsResponse>(
        "/api/mobile/workspace-tools",
        {
          query: {
            ...reportFilters,
          },
          session,
        },
      ),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to generate report.",
      );
    },
    onSuccess: (nextData) => {
      setMessage("Report refreshed.");
      setPreview(nextData.reports.preview);
    },
  });
  const activePreview = preview ?? reportData?.preview ?? null;
  const openPdf = useMutation({
    mutationFn: (mode: "save" | "view") =>
      activePreview
        ? writeReportPdf({
            filters: reportFilters,
            mode,
            title: activePreview.title,
            sessionToken: session?.access_token ?? null,
          })
        : Promise.reject(new Error("Generate a report first.")),
    onError: (error) => {
      setPdfMessage(
        error instanceof Error ? error.message : "Unable to open PDF.",
      );
    },
    onSuccess: ({ mode }) => {
      setPdfMessage(
        mode === "save"
          ? "PDF ready. Choose Save to Files from the native sheet."
          : "PDF ready.",
      );
    },
  });

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={<StatusPill label="Builder" tone="cyan" />}
          eyebrow="Reports"
          title="Report builder"
        />
        <ToolsDataState
          error={tools.error}
          loading={tools.isLoading}
          title="Loading reports"
        />
        {reportData ? (
          <>
            <SettingField label="Report">
              <ReportDropdown
                label="Report"
                onChange={setReportType}
                options={reportData.types}
                value={reportType}
              />
            </SettingField>
            <SettingField label="Timeframe">
              <ReportDropdown
                label="Timeframe"
                onChange={setTimeframe}
                options={reportData.timeframes}
                value={timeframe}
              />
            </SettingField>
            <View style={styles.twoColumn}>
              <SettingField label="Direction">
                <ReportDropdown
                  label="Direction"
                  onChange={setDirection}
                  options={reportData.directions}
                  value={direction}
                />
              </SettingField>
              <SettingField label="Channel">
                <ReportDropdown
                  label="Channel"
                  onChange={setChannel}
                  options={reportData.channels}
                  value={channel}
                />
              </SettingField>
            </View>
            <SettingField label="Contact">
              <ReportDropdown
                label="Contact"
                onChange={setContactId}
                options={
                  reportData.contacts ?? [{ label: "All contacts", value: "" }]
                }
                value={contactId}
              />
            </SettingField>
            {timeframe === "custom" ? (
              <View style={styles.twoColumn}>
                <SettingField label="Start date">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setStartDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    value={startDate}
                  />
                </SettingField>
                <SettingField label="End date">
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setEndDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    value={endDate}
                  />
                </SettingField>
              </View>
            ) : null}
            {message ? <Text style={styles.message}>{message}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={generateReport.isPending}
              onPress={() => generateReport.mutate()}
              style={[
                styles.saveButton,
                generateReport.isPending ? styles.disabled : null,
              ]}
            >
              <Text style={styles.saveButtonText}>
                {generateReport.isPending ? "Generating" : "Generate report"}
              </Text>
            </Pressable>
          </>
        ) : null}
      </SectionCard>

      {activePreview ? (
        <ReportPreviewPanel
          busy={openPdf.isPending}
          message={pdfMessage}
          onSave={() => openPdf.mutate("save")}
          onView={() => openPdf.mutate("view")}
          preview={activePreview}
        />
      ) : null}
    </>
  );
}

function ReportDropdown({
  compact = false,
  disabled = false,
  label,
  onChange,
  options,
  value,
}: {
  compact?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ description?: string; label: string; value: string }>;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const active = options.find((option) => option.value === value) ?? options[0];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          styles.dropdownButton,
          compact ? styles.dropdownButtonCompact : null,
          disabled ? styles.disabled : null,
        ]}
      >
        <Text numberOfLines={1} style={styles.dropdownValue}>
          {active?.label ?? formatLabel(value)}
        </Text>
        <ChevronRight color={colors.muted} size={18} />
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={styles.dropdownBackdrop}
        >
          <Pressable style={styles.dropdownSheet}>
            <Text style={styles.dropdownTitle}>{label}</Text>
            {options.map((option) => {
              const selected = option.value === value;

              return (
                <Pressable
                  accessibilityRole="button"
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={styles.dropdownOption}
                >
                  <View style={styles.settingsRowMain}>
                    <Text style={styles.dropdownOptionText}>
                      {option.label}
                    </Text>
                    {option.description ? (
                      <Text numberOfLines={2} style={styles.dropdownOptionMeta}>
                        {option.description}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? <Check color={colors.cyan} size={17} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ReportPreviewPanel({
  busy,
  message,
  onSave,
  onView,
  preview,
}: {
  busy: boolean;
  message: string | null;
  onSave: () => void;
  onView: () => void;
  preview: MobileReportPreview;
}) {
  return (
    <SectionCard>
      <SectionHeader
        action={<StatusPill label={preview.periodLabel} tone="purple" />}
        eyebrow="Report ready"
        title={preview.title}
      />
      <View style={styles.reportSummaryGrid}>
        {preview.summaryCards.slice(0, 4).map((card) => (
          <View key={card.label} style={styles.reportSummaryCard}>
            <Text style={styles.rowMeta}>{card.label}</Text>
            <Text style={styles.reportSummaryValue}>{card.value}</Text>
            {card.detail ? (
              <Text numberOfLines={2} style={styles.rowCopy}>
                {card.detail}
              </Text>
            ) : null}
          </View>
        ))}
        {preview.summaryCards.length === 0 ? (
          <View style={styles.reportSummaryCard}>
            <Text style={styles.rowMeta}>Generated</Text>
            <Text style={styles.rowTitle}>
              {formatDate(preview.generatedAt)}
            </Text>
          </View>
        ) : null}
      </View>
      {preview.sections.length ? (
        <View style={styles.reportRowList}>
          {preview.sections.slice(0, 2).map((section) => (
            <View key={section.title} style={styles.reportRow}>
              <View style={styles.activityRowTop}>
                <Text style={styles.rowTitle}>{section.title}</Text>
                <Text style={styles.rowMeta}>{section.rows.length} rows</Text>
              </View>
              {section.rows.length === 0 && section.emptyText ? (
                <Text numberOfLines={2} style={styles.rowCopy}>
                  {section.emptyText}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.pdfActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onView}
          style={[
            styles.saveButton,
            styles.pdfActionButton,
            busy ? styles.disabled : null,
          ]}
        >
          <Text style={styles.saveButtonText}>
            {busy ? "Preparing" : "View PDF"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onSave}
          style={[
            styles.iconButton,
            styles.pdfActionButton,
            busy ? styles.disabled : null,
          ]}
        >
          <Text style={styles.iconButtonText}>Save PDF</Text>
        </Pressable>
      </View>
    </SectionCard>
  );
}

function ActivitySettingsPanel() {
  const { session, status } = useAuthSession();
  const [filter, setFilter] = useState("all");
  const tools = useQuery({
    ...mobileWorkspaceToolsQueryOptions(session),
    enabled: status === "signed-in",
  });
  const activity = tools.data?.activity;
  const visibleItems =
    activity?.items.filter((item) => activityItemMatchesFilter(item, filter)) ??
    [];

  return (
    <SectionCard>
      <SectionHeader
        action={
          <StatusPill label={`${visibleItems.length} shown`} tone="cyan" />
        }
        eyebrow="Workspace timeline"
        title="Messages, actions, AI, and usage"
      />
      <ToolsDataState
        error={tools.error}
        loading={tools.isLoading}
        title="Loading activity"
      />
      {activity ? (
        <>
          <SettingField label="Filter">
            <ReportDropdown
              label="Activity filter"
              onChange={setFilter}
              options={activity.filters.map((option) => ({
                ...option,
                label: `${option.label} ${activity.counts[option.value] ?? 0}`,
              }))}
              value={filter}
            />
          </SettingField>
          {visibleItems.length ? (
            <View style={styles.activityList}>
              {visibleItems.slice(0, 30).map((item) => (
                <ActivityLogRow item={item} key={item.id} />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyCopy}>
              No workspace timeline activity matches this filter.
            </Text>
          )}
        </>
      ) : null}
    </SectionCard>
  );
}

function ActivityLogRow({ item }: { item: MobileActivityLogItem }) {
  return (
    <View style={styles.activityRow}>
      <View
        style={[
          styles.activityMarker,
          { backgroundColor: activityToneColor(item.tone) },
        ]}
      />
      <View style={styles.settingsRowMain}>
        <View style={styles.activityRowTop}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {item.title}
          </Text>
          <Text style={styles.rowMeta}>{formatDate(item.at)}</Text>
        </View>
        <Text numberOfLines={2} style={styles.rowCopy}>
          {item.detail}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {item.meta}
        </Text>
      </View>
    </View>
  );
}

function OperationalLogSettingsPanel() {
  const { session, status } = useAuthSession();
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [filter, setFilter] = useState("all");
  const tools = useQuery({
    ...mobileWorkspaceToolsQueryOptions(session),
    enabled: status === "signed-in",
  });
  const logs = tools.data?.operationalLogs;
  const items =
    direction === "inbound" ? (logs?.inbound ?? []) : (logs?.outbound ?? []);
  const visibleItems = items.filter((item) =>
    operationalLogMatchesFilter(item, filter),
  );

  return (
    <SectionCard>
      <SectionHeader
        action={
          <StatusPill label={`${visibleItems.length} shown`} tone="cyan" />
        }
        eyebrow="Communications log"
        title="Inbound and outbound comms"
      />
      <ToolsDataState
        error={tools.error}
        loading={tools.isLoading}
        title="Loading logs"
      />
      {logs ? (
        <>
          <OptionChips
            formatOption={formatLabel}
            onChange={(value) => {
              setDirection(value as "inbound" | "outbound");
              setFilter("all");
            }}
            options={["inbound", "outbound"]}
            value={direction}
          />
          <SettingField label="Filter">
            <ReportDropdown
              label="Log filter"
              onChange={setFilter}
              options={logs.filters}
              value={filter}
            />
          </SettingField>
          {visibleItems.length ? (
            <View style={styles.activityList}>
              {visibleItems.map((item) => (
                <OperationalLogRow item={item} key={item.id} />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyCopy}>
              No communications log rows match.
            </Text>
          )}
        </>
      ) : null}
    </SectionCard>
  );
}

function OperationalLogRow({ item }: { item: MobileOperationalLogItem }) {
  return (
    <View style={styles.activityRow}>
      <View
        style={[
          styles.activityMarker,
          {
            backgroundColor:
              item.status === "warning" || item.status === "error"
                ? colors.pink
                : item.type === "sync"
                  ? colors.purple
                  : colors.cyan,
          },
        ]}
      />
      <View style={styles.settingsRowMain}>
        <View style={styles.activityRowTop}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {item.title}
          </Text>
          <Text style={styles.rowMeta}>{formatDate(item.at)}</Text>
        </View>
        <Text numberOfLines={2} style={styles.rowCopy}>
          {item.detail}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {formatLabel(item.status)} - {item.meta}
        </Text>
      </View>
    </View>
  );
}

function DeveloperSettingsPanel({
  data,
  disabled,
  onSaveVoice,
  onVoiceDraftChange,
  voiceDraft,
}: {
  data: MobileSettingsResponse;
  disabled: boolean;
  onSaveVoice: () => void;
  onVoiceDraftChange: (draft: VoiceDraft) => void;
  voiceDraft: VoiceDraft;
}) {
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [mockFromEmail, setMockFromEmail] = useState("mobile-test@example.com");
  const [mockSubject, setMockSubject] = useState("Mock mobile inquiry");
  const [mockBody, setMockBody] = useState(
    "Hi, I need a quote and would like Kyro to process this as a mock inbound inquiry.",
  );
  const tools = useQuery({
    ...mobileWorkspaceToolsQueryOptions(session),
    enabled: status === "signed-in",
  });
  const developer = tools.data?.developer;
  const runDeveloperTool = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      kyroApiFetch<{ message: string }>("/api/mobile/workspace-tools", {
        body: payload,
        method: "POST",
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Developer action failed.",
      );
    },
    onSuccess: async (result) => {
      setMessage(result.message);
      await queryClient.invalidateQueries({
        queryKey: mobileWorkspaceToolsQueryOptions(session).queryKey,
      });
    },
  });

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={developerHealthLabel(developer?.checks ?? [])}
              tone={developerHealthTone(developer?.checks ?? [])}
            />
          }
          eyebrow="Developer"
          title="System checks"
        />
        <ToolsDataState
          error={tools.error}
          loading={tools.isLoading}
          title="Loading developer"
        />
        {developer
          ? developer.checks.map((check) => (
              <ListRow
                key={check.id}
                right={
                  <StatusPill
                    label={formatLabel(check.status)}
                    tone={
                      check.status === "ok"
                        ? "green"
                        : check.status === "error"
                          ? "warning"
                          : "purple"
                    }
                  />
                }
              >
                <Text style={styles.rowTitle}>{check.title}</Text>
                <Text style={styles.rowCopy}>{check.summary}</Text>
                {check.detail ? (
                  <Text numberOfLines={2} style={styles.rowMeta}>
                    {check.detail}
                  </Text>
                ) : null}
              </ListRow>
            ))
          : null}
      </SectionCard>

      {developer ? (
        <SectionCard>
          <SectionHeader eyebrow="Legacy voice" title="OpenAI assistant" />
          <SettingField label="OpenAI voice">
            <OptionChips
              formatOption={formatLabel}
              onChange={(openAiVoice) =>
                onVoiceDraftChange({ ...voiceDraft, openAiVoice })
              }
              options={data.options.openAiVoices ?? data.options.voices}
              value={voiceDraft.openAiVoice}
            />
          </SettingField>
          <SaveFooter
            disabled={disabled}
            label="Save legacy voice"
            onPress={onSaveVoice}
          />
        </SectionCard>
      ) : null}

      {developer ? (
        <SectionCard>
          <SectionHeader eyebrow="Developer actions" title="Email tools" />
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={runDeveloperTool.isPending}
            onPress={() =>
              runDeveloperTool.mutate({ operation: "manual_email_sync" })
            }
            style={[
              styles.saveButton,
              runDeveloperTool.isPending ? styles.disabled : null,
            ]}
          >
            <Text style={styles.saveButtonText}>
              {runDeveloperTool.isPending
                ? "Running sync"
                : "Manual email sync now"}
            </Text>
          </Pressable>
          <View style={styles.nestedPanel}>
            <SectionHeader eyebrow="Mock inbound" title="Inbound inquiry" />
            <TextInput
              editable={!runDeveloperTool.isPending}
              onChangeText={setMockFromEmail}
              placeholder="from@example.com"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={mockFromEmail}
            />
            <TextInput
              editable={!runDeveloperTool.isPending}
              onChangeText={setMockSubject}
              placeholder="Subject"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={mockSubject}
            />
            <TextInput
              editable={!runDeveloperTool.isPending}
              multiline
              onChangeText={setMockBody}
              placeholder="Inquiry body"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.textAreaSmall]}
              textAlignVertical="top"
              value={mockBody}
            />
            <Pressable
              accessibilityRole="button"
              disabled={runDeveloperTool.isPending}
              onPress={() =>
                runDeveloperTool.mutate({
                  inquiry: {
                    bodyText: mockBody,
                    fromEmail: mockFromEmail,
                    subject: mockSubject,
                  },
                  operation: "mock_inbound_inquiry",
                })
              }
              style={[
                styles.iconButton,
                runDeveloperTool.isPending ? styles.disabled : null,
              ]}
            >
              <Plus color={colors.cyan} size={16} />
              <Text style={styles.iconButtonText}>Create mock inquiry</Text>
            </Pressable>
          </View>
        </SectionCard>
      ) : null}

      {developer ? (
        <SectionCard>
          <SectionHeader eyebrow="Tools" title="Developer links" />
          {developer.tools.map((tool) => (
            <View key={tool.label} style={styles.developerToolRow}>
              <View style={styles.settingsRowMain}>
                <Text style={styles.rowTitle}>{tool.label}</Text>
                <Text style={styles.rowCopy}>{tool.detail}</Text>
                {tool.target ? (
                  <Text style={styles.rowMeta}>{tool.target}</Text>
                ) : null}
              </View>
              <ExternalLink color={colors.muted} size={18} strokeWidth={2.4} />
            </View>
          ))}
        </SectionCard>
      ) : null}
    </>
  );
}

function ToolsDataState({
  error,
  loading,
  title,
}: {
  error: Error | null;
  loading: boolean;
  title: string;
}) {
  return (
    <>
      {loading ? (
        <View style={styles.toolSkeletonList}>
          <SkeletonLine tone="cyan" width="72%" />
          <SkeletonLine height={10} width="54%" />
          <SkeletonLine tone="purple" width="64%" />
        </View>
      ) : null}
      <DataState error={error} loading={false} title={title} />
    </>
  );
}

type PaymentLinkDraft = {
  amount: string;
  contactId: string;
  currency: string;
  description: string;
  dueAt: string;
};

function PaymentsSettingsPanel({
  onCreateInvoice,
  onOpenStripe,
}: {
  onCreateInvoice: () => void;
  onOpenStripe: () => void;
}) {
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const paymentsOptions = mobilePaymentsQueryOptions(session);
  const payments = useQuery({
    ...paymentsOptions,
    enabled: status === "signed-in",
  });
  const [draft, setDraft] = useState<PaymentLinkDraft>({
    amount: "",
    contactId: "",
    currency: "AUD",
    description: "",
    dueAt: "",
  });
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const data = payments.data;
  const createPaymentLink = useMutation({
    mutationFn: (nextDraft: PaymentLinkDraft) =>
      kyroApiFetch<MobilePaymentLinkResponse>("/api/mobile/payments", {
        body: {
          amountCents: Math.round(
            (parseNullableMoney(nextDraft.amount) ?? 0) * 100,
          ),
          contactId: nextDraft.contactId || null,
          currency: nextDraft.currency,
          description: nextDraft.description,
          dueAt: nextDraft.dueAt || null,
        },
        method: "POST",
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create payment link.",
      );
    },
    onSuccess: async (result) => {
      setMessage("Payment link created.");
      setIsCreatingLink(false);
      setDraft((current) => ({
        ...current,
        amount: "",
        description: "",
        dueAt: "",
      }));
      void queryClient.invalidateQueries({
        queryKey: paymentsOptions.queryKey,
      });

      if (result.url) {
        await Linking.openURL(result.url);
      }
    },
  });

  useEffect(() => {
    if (!data) {
      return;
    }

    setDraft((current) => ({
      ...current,
      currency:
        current.currency ||
        data.account?.defaultCurrency ||
        data.stats.currency ||
        "AUD",
    }));
  }, [data]);

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={paymentReady(data) ? "Ready" : "Setup"}
              tone={paymentReady(data) ? "green" : "warning"}
            />
          }
          eyebrow="Payments"
          title="Customer payments"
        />
        {payments.isLoading ? (
          <View style={styles.reportSummaryGrid}>
            {[0, 1, 2, 3].map((index) => (
              <View key={index} style={styles.reportSummaryCard}>
                <SkeletonLine tone={index % 2 ? "pink" : "cyan"} width="52%" />
                <SkeletonLine height={18} width="70%" />
              </View>
            ))}
          </View>
        ) : null}
        <DataState
          error={payments.error}
          loading={false}
          title="Loading payments"
        />
        {data ? <PaymentsSummaryGrid data={data} /> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.pdfActions}>
          <ActionButton
            disabled={!paymentReady(data)}
            onPress={() => setIsCreatingLink((value) => !value)}
          >
            <View style={styles.buttonInner}>
              <Plus color={colors.background} size={15} />
              <Text style={styles.primaryButtonText}>Create payment link</Text>
            </View>
          </ActionButton>
          <Pressable
            accessibilityRole="button"
            onPress={onCreateInvoice}
            style={[styles.saveButton, styles.pdfActionButton]}
          >
            <Text style={styles.saveButtonText}>Create invoice</Text>
          </Pressable>
        </View>
        {!paymentReady(data) ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenStripe}
            style={styles.iconButton}
          >
            <CreditCard color={colors.cyan} size={16} />
            <Text style={styles.iconButtonText}>Open Stripe settings</Text>
          </Pressable>
        ) : null}
      </SectionCard>

      {isCreatingLink && data ? (
        <PaymentLinkCreator
          busy={createPaymentLink.isPending}
          contacts={data.contacts}
          draft={draft}
          onCancel={() => setIsCreatingLink(false)}
          onChange={setDraft}
          onSubmit={() => createPaymentLink.mutate(draft)}
        />
      ) : null}

      {data ? <PaymentRequestsList requests={data.paymentRequests} /> : null}
    </>
  );
}

function PaymentsSummaryGrid({ data }: { data: MobilePaymentsResponse }) {
  const currency = data.stats.currency;
  const items = [
    {
      label: "Paid week",
      value: formatMoney(data.stats.paidThisWeekCents / 100, currency),
    },
    {
      label: "Paid month",
      value: formatMoney(data.stats.paidThisMonthCents / 100, currency),
    },
    {
      label: "Outstanding",
      meta: `${data.stats.outstandingCount} open`,
      value: formatMoney(data.stats.outstandingAmountCents / 100, currency),
    },
    {
      label: "Overdue",
      meta: `${data.stats.overdueCount} overdue`,
      value: formatMoney(data.stats.overdueAmountCents / 100, currency),
    },
  ];

  return (
    <View style={styles.reportSummaryGrid}>
      {items.map((item) => (
        <View key={item.label} style={styles.reportSummaryCard}>
          <Text style={styles.summaryLabel}>{item.label}</Text>
          <Text numberOfLines={1} style={styles.reportSummaryValue}>
            {item.value}
          </Text>
          {item.meta ? (
            <Text style={styles.summaryMeta}>{item.meta}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function PaymentLinkCreator({
  busy,
  contacts,
  draft,
  onCancel,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  contacts: MobilePaymentsResponse["contacts"];
  draft: PaymentLinkDraft;
  onCancel: () => void;
  onChange: (draft: PaymentLinkDraft) => void;
  onSubmit: () => void;
}) {
  return (
    <SectionCard>
      <SectionHeader eyebrow="Stripe link" title="Create payment link" />
      <SettingField label="Customer">
        <ReportDropdown
          label="Customer"
          onChange={(contactId) => onChange({ ...draft, contactId })}
          options={[
            { label: "No contact linked", value: "" },
            ...contacts.map((contact) => ({
              description: [contact.email, contact.phone]
                .filter(Boolean)
                .join(" - "),
              label: contact.label,
              value: contact.id,
            })),
          ]}
          value={draft.contactId}
        />
      </SettingField>
      <SettingField label="Description">
        <TextInput
          editable={!busy}
          onChangeText={(description) => onChange({ ...draft, description })}
          placeholder="Deposit, callout, invoice payment..."
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={draft.description}
        />
      </SettingField>
      <View style={styles.twoColumn}>
        <SettingField label="Amount">
          <TextInput
            editable={!busy}
            keyboardType="decimal-pad"
            onChangeText={(amount) => onChange({ ...draft, amount })}
            placeholder="250.00"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.amount}
          />
        </SettingField>
        <SettingField label="Currency">
          <TextInput
            autoCapitalize="characters"
            editable={!busy}
            onChangeText={(currency) =>
              onChange({ ...draft, currency: currency.toUpperCase() })
            }
            style={styles.input}
            value={draft.currency}
          />
        </SettingField>
      </View>
      <SettingField label="Due date">
        <TextInput
          editable={!busy}
          onChangeText={(dueAt) => onChange({ ...draft, dueAt })}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={draft.dueAt}
        />
      </SettingField>
      <View style={styles.saveFooter}>
        <Text style={styles.footerText}>
          Stripe Checkout manages eligible payment methods. Kyro records the
          request and status.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>Cancel</Text>
        </Pressable>
        <ActionButton disabled={busy} onPress={onSubmit}>
          <Text style={styles.primaryButtonText}>
            {busy ? "Creating..." : "Create"}
          </Text>
        </ActionButton>
      </View>
    </SectionCard>
  );
}

function PaymentRequestsList({
  requests,
}: {
  requests: MobilePaymentRequest[];
}) {
  return (
    <SectionCard>
      <SectionHeader
        action={<StatusPill label={`${requests.length} total`} tone="purple" />}
        eyebrow="Requests"
        title="Payment requests"
      />
      {requests.length ? (
        <View style={styles.fileList}>
          {requests.slice(0, 20).map((request) => (
            <PaymentRequestRow key={request.id} request={request} />
          ))}
        </View>
      ) : (
        <Text style={styles.emptyCopy}>
          Payment links and invoice-backed requests will appear here.
        </Text>
      )}
    </SectionCard>
  );
}

function PaymentRequestRow({ request }: { request: MobilePaymentRequest }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!request.paymentUrl}
      onPress={() => {
        if (request.paymentUrl) {
          void Linking.openURL(request.paymentUrl);
        }
      }}
      style={styles.fileRow}
    >
      <View style={styles.fileRowMain}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {formatMoney(request.amountCents / 100, request.currency)} -{" "}
          {request.contactLabel}
        </Text>
        <Text numberOfLines={1} style={styles.rowCopy}>
          {request.description}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {request.dueAt
            ? `Due ${formatDate(request.dueAt)}`
            : formatDate(request.createdAt)}
        </Text>
      </View>
      <StatusPill
        label={formatLabel(request.status)}
        tone={paymentStatusTone(request.status)}
      />
      {request.paymentUrl ? (
        <ExternalLink color={colors.muted} size={16} />
      ) : null}
    </Pressable>
  );
}

function StripeSettingsPanel() {
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const paymentsOptions = mobilePaymentsQueryOptions(session);
  const documentsOptions = mobileDocumentsQueryOptions(session);
  const payments = useQuery({
    ...paymentsOptions,
    enabled: status === "signed-in",
  });
  const documents = useQuery({
    ...documentsOptions,
    enabled: status === "signed-in",
  });
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [stripeMessage, setStripeMessage] = useState<string | null>(null);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const saveDefaultTemplate = useMutation({
    mutationFn: (defaultInvoiceTemplateKey: string) =>
      kyroApiFetch<MobileDocumentsResponse>("/api/mobile/documents", {
        body: {
          defaultInvoiceTemplateKey: defaultInvoiceTemplateKey || null,
          operation: "save_default_invoice_template",
        },
        method: "POST",
        session,
      }),
    onError: (error) => {
      setTemplateMessage(
        error instanceof Error
          ? error.message
          : "Unable to save invoice template.",
      );
    },
    onSuccess: (nextData) => {
      setTemplateMessage(nextData.message ?? "Default invoice template saved.");
      queryClient.setQueryData(documentsOptions.queryKey, nextData);
      void queryClient.invalidateQueries({
        queryKey: paymentsOptions.queryKey,
      });
    },
  });

  useEffect(() => {
    const defaultKey = documents.data?.settings.defaultInvoiceTemplateKey;

    setSelectedTemplateKey(defaultKey ?? "");
  }, [documents.data?.settings.defaultInvoiceTemplateKey]);

  const overview = payments.data;
  const templates = documents.data?.templates ?? [];
  const connectStripe = useMutation({
    mutationFn: () =>
      kyroApiFetch<MobilePaymentSetupResponse>("/api/mobile/payments", {
        body: { operation: "connect_stripe" },
        method: "POST",
        session,
      }),
    onError: (error) => {
      setStripeMessage(
        error instanceof Error
          ? error.message
          : "Unable to start Stripe setup.",
      );
    },
    onSuccess: async (result) => {
      setStripeMessage("Stripe setup opened.");
      await Linking.openURL(result.url);
    },
  });

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={paymentReady(overview) ? "Ready" : "Setup"}
              tone={paymentReady(overview) ? "green" : "warning"}
            />
          }
          eyebrow="Stripe"
          title="Payment connection"
        />
        {payments.isLoading ? <FilesLoadingRows /> : null}
        <DataState
          error={payments.error}
          loading={false}
          title="Loading Stripe"
        />
        {overview ? (
          <View style={styles.summaryStrip}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Account</Text>
              <Text style={styles.summaryValue}>
                {overview.account?.status
                  ? formatLabel(overview.account.status)
                  : "Not connected"}
              </Text>
              <Text numberOfLines={1} style={styles.summaryMeta}>
                {overview.account?.providerAccountId ??
                  "No Stripe account linked"}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Webhook</Text>
              <Text style={styles.summaryValue}>
                {overview.webhookConfigured ? "Configured" : "Missing"}
              </Text>
              <Text numberOfLines={1} style={styles.summaryMeta}>
                {overview.configured
                  ? "Stripe key loaded"
                  : "Stripe key missing"}
              </Text>
            </View>
          </View>
        ) : null}
        {overview && !overview.migrationReady ? (
          <Text style={styles.securityError}>
            Payment tables are not available in this backend yet.
          </Text>
        ) : null}
        {stripeMessage ? (
          <Text style={styles.message}>{stripeMessage}</Text>
        ) : null}
        {overview?.migrationReady && overview.configured ? (
          <Pressable
            accessibilityRole="button"
            disabled={connectStripe.isPending}
            onPress={() => connectStripe.mutate()}
            style={[
              styles.iconButton,
              connectStripe.isPending ? styles.disabled : null,
            ]}
          >
            <ExternalLink color={colors.cyan} size={16} />
            <Text style={styles.iconButtonText}>
              {connectStripe.isPending
                ? "Opening Stripe..."
                : overview.account?.providerAccountId
                  ? "Continue Stripe setup"
                  : "Connect Stripe"}
            </Text>
          </Pressable>
        ) : null}
      </SectionCard>

      <SectionCard>
        <SectionHeader eyebrow="Invoices" title="Default invoice template" />
        {documents.isLoading ? <FilesLoadingRows /> : null}
        <DataState
          error={documents.error}
          loading={false}
          title="Loading templates"
        />
        {templates.length ? (
          <>
            <ReportDropdown
              label="Default invoice template"
              onChange={setSelectedTemplateKey}
              options={[
                { label: "No template selected", value: "" },
                ...templates.map((template) => ({
                  description: `${template.lineItems.length} reusable items`,
                  label: template.label,
                  value: template.key,
                })),
              ]}
              value={selectedTemplateKey}
            />
            {templateMessage ? (
              <Text style={styles.message}>{templateMessage}</Text>
            ) : null}
            <View style={styles.saveFooter}>
              <Text style={styles.footerText}>
                Payments uses this template when creating invoice drafts.
              </Text>
              <ActionButton
                disabled={saveDefaultTemplate.isPending}
                onPress={() => saveDefaultTemplate.mutate(selectedTemplateKey)}
              >
                <Text style={styles.primaryButtonText}>
                  {saveDefaultTemplate.isPending ? "Saving..." : "Save"}
                </Text>
              </ActionButton>
            </View>
          </>
        ) : (
          <Text style={styles.emptyCopy}>
            Create an invoice template in Document Generator, then select it
            here.
          </Text>
        )}
      </SectionCard>
    </>
  );
}

type QuoteEditorDraft = {
  customerCompany: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  documentKind: "invoice" | "quote";
  jobAddress: string;
  jobType: string;
  lineItemsText: string;
  notes: string;
  preferredTime: string;
  status: string;
  templateKey: string;
  title: string;
};

type TemplateEditorDraft = {
  accentTheme: string;
  currency: string;
  description: string;
  footerText: string;
  label: string;
  lineItemsText: string;
  notes: string;
  paymentTerms: string;
  quoteStyleDirection: string;
  showPreparedBy: boolean;
  templateKey: string;
  validityDays: string;
};

function DocumentWorkbenchPanel({
  launch,
  onLaunchConsumed,
}: {
  launch?: DocumentLaunch;
  onLaunchConsumed?: () => void;
}) {
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(
    null,
  );
  const [newQuoteTemplateKey, setNewQuoteTemplateKey] = useState<string | null>(
    null,
  );
  const [newQuoteKind, setNewQuoteKind] = useState<"invoice" | "quote">(
    "quote",
  );
  const [quoteMode, setQuoteMode] = useState<"list" | "new" | "template">(
    "list",
  );
  const [message, setMessage] = useState<string | null>(null);
  const documentsOptions = mobileDocumentsQueryOptions(session);
  const documents = useQuery({
    ...documentsOptions,
    enabled: status === "signed-in",
  });
  const documentsData = documents.data;
  const selectedTemplate =
    quoteMode === "template"
      ? documentsData?.templates.find(
          (template) => template.key === selectedTemplateKey,
        )
      : null;
  const selectedNewQuoteTemplate =
    quoteMode === "new" && documentsData
      ? (documentsData.templates.find(
          (template) => template.key === newQuoteTemplateKey,
        ) ??
        documentsData.templates[0] ??
        null)
      : null;
  const createQuote = useMutation({
    mutationFn: (draft: QuoteEditorDraft) =>
      kyroApiFetch<MobileDocumentsResponse>("/api/mobile/documents", {
        body: {
          ...quoteDraftPayload(draft),
          operation: "create_quote",
        },
        method: "POST",
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to create quote.",
      );
    },
    onSuccess: (nextData) => {
      queryClient.setQueryData(documentsOptions.queryKey, nextData);
      setMessage(nextData.message ?? "Quote draft created.");
      setQuoteMode("list");
      setNewQuoteKind("quote");
      setNewQuoteTemplateKey(null);
      setSelectedQuoteId(nextData.quoteDrafts[0]?.id ?? null);
    },
  });
  const saveTemplate = useMutation({
    mutationFn: (draft: TemplateEditorDraft) =>
      kyroApiFetch<MobileDocumentsResponse>("/api/mobile/documents", {
        body: {
          accentTheme: draft.accentTheme,
          currency: draft.currency,
          description: draft.description,
          footerText: draft.footerText,
          label: draft.label,
          lineItems: parseLineItemsText(draft.lineItemsText),
          notes: draft.notes,
          operation: "save_template",
          paymentTerms: draft.paymentTerms,
          quoteStyleDirection: draft.quoteStyleDirection,
          showPreparedBy: draft.showPreparedBy,
          templateKey: draft.templateKey || null,
          validityDays: Number(draft.validityDays),
        },
        method: "POST",
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to save template.",
      );
    },
    onSuccess: (nextData) => {
      queryClient.setQueryData(documentsOptions.queryKey, nextData);
      setMessage(nextData.message ?? "Template saved.");
      setQuoteMode("list");
    },
  });

  useEffect(() => {
    if (!launch || !documentsData) {
      return;
    }

    if (launch.mode === "invoice") {
      const template = defaultInvoiceTemplateFromDocuments(documentsData);

      setSelectedQuoteId(null);
      setNewQuoteKind("invoice");
      setNewQuoteTemplateKey(template?.key ?? null);
      setQuoteMode("new");
      setMessage(
        template
          ? `Invoice draft opened with ${template.label}.`
          : "Invoice draft opened. Choose or create an invoice template when ready.",
      );
    }

    onLaunchConsumed?.();
  }, [documentsData, launch, onLaunchConsumed]);

  if (selectedQuoteId) {
    return (
      <QuoteDraftMobileEditor
        onBack={() => setSelectedQuoteId(null)}
        onChanged={(detail) => {
          setMessage("Quote updated.");
          void queryClient.invalidateQueries({
            queryKey: documentsOptions.queryKey,
          });
          void queryClient.setQueryData(
            mobileDocumentQuoteQueryOptions(session, selectedQuoteId).queryKey,
            detail,
          );
        }}
        quoteDraftId={selectedQuoteId}
      />
    );
  }

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={`${documentsData?.counts.total ?? 0} quotes`}
              tone="cyan"
            />
          }
          eyebrow="Quotes"
          title="Document workbench"
        />
        <View style={styles.chipGrid}>
          <ActionButton
            onPress={() => {
              setMessage(null);
              setNewQuoteKind("quote");
              setNewQuoteTemplateKey(null);
              setQuoteMode(quoteMode === "new" ? "list" : "new");
            }}
          >
            <View style={styles.buttonInner}>
              <Plus color={colors.background} size={15} />
              <Text style={styles.primaryButtonText}>New quote</Text>
            </View>
          </ActionButton>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMessage(null);
              setSelectedTemplateKey(null);
              setQuoteMode(quoteMode === "template" ? "list" : "template");
            }}
            style={styles.choiceChip}
          >
            <Text style={styles.choiceText}>New template</Text>
          </Pressable>
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {documents.isLoading ? <FilesLoadingRows /> : null}
        <DataState
          error={documents.error ?? createQuote.error ?? saveTemplate.error}
          loading={false}
          title="Loading quotes"
        />
      </SectionCard>

      {quoteMode === "new" && documentsData ? (
        <QuoteDraftForm
          busy={createQuote.isPending}
          initialDraft={quoteDraftFromTemplate(
            selectedNewQuoteTemplate,
            newQuoteKind,
          )}
          onCancel={() => setQuoteMode("list")}
          onSave={(draft) => createQuote.mutate(draft)}
          templates={documentsData.templates}
        />
      ) : null}

      {quoteMode === "template" && documentsData ? (
        <TemplateDraftForm
          busy={saveTemplate.isPending}
          initialDraft={templateDraftFromTemplate(
            selectedTemplate,
            documentsData.settings,
          )}
          onCancel={() => setQuoteMode("list")}
          onSave={(draft) => saveTemplate.mutate(draft)}
        />
      ) : null}

      {documentsData ? (
        <SectionCard>
          <SectionHeader eyebrow="Drafts" title="Quote drafts" />
          {documentsData.quoteDrafts.length ? (
            <View style={styles.fileList}>
              {documentsData.quoteDrafts.map((quoteDraft) => (
                <QuoteDraftRow
                  key={quoteDraft.id}
                  quoteDraft={quoteDraft}
                  onPress={() => setSelectedQuoteId(quoteDraft.id)}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyCopy}>
              Quote drafts created by Kyro or by you will appear here.
            </Text>
          )}
        </SectionCard>
      ) : null}

      {documentsData?.templates.length ? (
        <SectionCard>
          <SectionHeader eyebrow="Templates" title="Reusable structures" />
          <View style={styles.fileList}>
            {documentsData.templates.map((template) => (
              <TemplateRow
                key={template.key}
                onEdit={() => {
                  setSelectedTemplateKey(template.key);
                  setQuoteMode("template");
                  setMessage(`Editing ${template.label}.`);
                }}
                template={template}
              />
            ))}
          </View>
        </SectionCard>
      ) : null}
    </>
  );
}

function QuoteDraftMobileEditor({
  onBack,
  onChanged,
  quoteDraftId,
}: {
  onBack: () => void;
  onChanged: (detail: MobileQuoteDraftDetailResponse) => void;
  quoteDraftId: string;
}) {
  const { session } = useAuthSession();
  const [message, setMessage] = useState<string | null>(null);
  const detailOptions = mobileDocumentQuoteQueryOptions(session, quoteDraftId);
  const detail = useQuery(detailOptions);
  const [draft, setDraft] = useState<QuoteEditorDraft | null>(null);
  const saveQuote = useMutation({
    mutationFn: (nextDraft: QuoteEditorDraft) =>
      kyroApiFetch<MobileQuoteDraftDetailResponse>(
        `/api/mobile/documents/${quoteDraftId}`,
        {
          body: {
            ...quoteDraftPayload(nextDraft),
            operation: "update_quote",
          },
          method: "PATCH",
          session,
        },
      ),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to save quote.",
      );
    },
    onSuccess: (nextDetail) => {
      setMessage(nextDetail.message ?? "Quote draft saved.");
      onChanged(nextDetail);
    },
  });
  const runQuoteAction = useMutation({
    mutationFn: (
      operation: "create_approval_link" | "prepare_send" | "apply_template",
    ) =>
      kyroApiFetch<MobileQuoteDraftDetailResponse>(
        `/api/mobile/documents/${quoteDraftId}`,
        {
          body: {
            operation,
            templateKey: draft?.templateKey || undefined,
          },
          method: "PATCH",
          session,
        },
      ),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to update quote.",
      );
    },
    onSuccess: (nextDetail) => {
      setMessage(nextDetail.message ?? "Quote updated.");
      onChanged(nextDetail);
    },
  });
  const pdfAction = useMutation({
    mutationFn: (mode: "save" | "view") =>
      writeQuotePdf({
        mode,
        quoteDraftId,
        sessionToken: session?.access_token ?? null,
        title: detail.data?.quoteDraft.title ?? "quote",
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to open PDF.",
      );
    },
    onSuccess: ({ mode }) => {
      setMessage(
        mode === "view"
          ? "Quote PDF ready."
          : "Quote PDF ready. Choose Save to Files from the native sheet.",
      );
    },
  });

  useEffect(() => {
    if (!detail.data || draft) {
      return;
    }

    setDraft(quoteDraftFromDetail(detail.data));
  }, [detail.data, draft]);

  const quote = detail.data;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <ChevronLeft color={colors.text} size={20} strokeWidth={2.5} />
        <Text style={styles.backButtonText}>Quotes</Text>
      </Pressable>
      {detail.isLoading ? <FilesLoadingRows /> : null}
      <DataState error={detail.error} loading={false} title="Loading quote" />
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {quote && draft ? (
        <>
          <QuotePreviewCard
            busy={pdfAction.isPending || runQuoteAction.isPending}
            detail={quote}
            onApprovalLink={() => runQuoteAction.mutate("create_approval_link")}
            onPrepareSend={() => runQuoteAction.mutate("prepare_send")}
            onSavePdf={() => pdfAction.mutate("save")}
            onViewPdf={() => pdfAction.mutate("view")}
          />
          <QuoteDraftForm
            busy={saveQuote.isPending}
            initialDraft={draft}
            onCancel={() => setDraft(quoteDraftFromDetail(quote))}
            onSave={(nextDraft) => saveQuote.mutate(nextDraft)}
            templates={quote.templates}
          />
          <SectionCard>
            <SectionHeader eyebrow="History" title="Quote events" />
            {quote.history.length ? (
              <View style={styles.fileList}>
                {quote.history.map((event, index) => (
                  <View
                    key={`${event.kind}-${event.occurredAt}-${index}`}
                    style={styles.reportRow}
                  >
                    <Text style={styles.rowTitle}>{event.label}</Text>
                    <Text style={styles.rowCopy}>
                      {event.meta} - {formatDate(event.occurredAt)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyCopy}>
                PDF generation, customer approval, and send-prep events will
                appear here.
              </Text>
            )}
          </SectionCard>
        </>
      ) : null}
    </>
  );
}

function QuotePreviewCard({
  busy,
  detail,
  onApprovalLink,
  onPrepareSend,
  onSavePdf,
  onViewPdf,
}: {
  busy: boolean;
  detail: MobileQuoteDraftDetailResponse;
  onApprovalLink: () => void;
  onPrepareSend: () => void;
  onSavePdf: () => void;
  onViewPdf: () => void;
}) {
  const quote = detail.quoteDraft;
  const lineItems = quote.lineItems;

  return (
    <SectionCard>
      <SectionHeader
        action={<StatusPill label={detail.revision.label} tone="purple" />}
        eyebrow="Preview"
        title={quote.title}
      />
      <View style={styles.quotePreviewPage}>
        <Text style={styles.pdfTitle}>{quote.title}</Text>
        <Text style={styles.pdfSubtitle}>
          {detail.preview.customerLabel} - {detail.preview.jobLabel}
        </Text>
        <View style={styles.pdfDivider} />
        {lineItems.slice(0, 6).map((item, index) => (
          <View key={`${item.description}-${index}`} style={styles.pdfLine}>
            <Text numberOfLines={1} style={styles.pdfLineLabel}>
              {item.description}
            </Text>
            <Text style={styles.pdfLineValue}>
              {formatMoney(item.total, detail.preview.currency)}
            </Text>
          </View>
        ))}
        <View style={styles.pdfDivider} />
        <View style={styles.pdfLine}>
          <Text style={styles.pdfLineLabel}>Status</Text>
          <Text style={styles.pdfLineValue}>{formatLabel(quote.status)}</Text>
        </View>
        <View style={styles.pdfLine}>
          <Text style={styles.pdfLineLabel}>Subtotal</Text>
          <Text style={styles.pdfLineValue}>
            {formatMoney(detail.preview.subtotal, detail.preview.currency)}
          </Text>
        </View>
      </View>
      {detail.revision.needsRevision ? (
        <Text style={styles.securityError}>
          Customer requested changes:{" "}
          {detail.revision.pendingChangeRequest?.message ??
            "Review and revise this quote."}
        </Text>
      ) : null}
      <View style={styles.pdfActions}>
        <ActionButton disabled={busy} onPress={onViewPdf}>
          <Text style={styles.primaryButtonText}>View PDF</Text>
        </ActionButton>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onSavePdf}
          style={styles.saveButton}
        >
          <Text style={styles.saveButtonText}>Save PDF</Text>
        </Pressable>
      </View>
      <View style={styles.pdfActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onApprovalLink}
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>
            {detail.approval ? "Fresh approval link" : "Create approval link"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onPrepareSend}
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>
            {detail.revision.currentVersion > 1
              ? "Send revised quote"
              : "Prepare send"}
          </Text>
        </Pressable>
      </View>
      {detail.approval?.url ? (
        <Text selectable style={styles.rowCopy}>
          {detail.approval.url}
        </Text>
      ) : null}
    </SectionCard>
  );
}

function QuoteDraftForm({
  busy,
  initialDraft,
  onCancel,
  onSave,
  templates,
}: {
  busy: boolean;
  initialDraft: QuoteEditorDraft;
  onCancel: () => void;
  onSave: (draft: QuoteEditorDraft) => void;
  templates: MobileDocumentTemplate[];
}) {
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => {
    setDraft(initialDraft);
  }, [initialDraft]);

  return (
    <SectionCard>
      <SectionHeader eyebrow="Editor" title="Quote draft" />
      {templates.length ? (
        <View style={styles.chipGrid}>
          {templates.slice(0, 6).map((template) => (
            <Pressable
              accessibilityRole="button"
              key={template.key}
              onPress={() =>
                setDraft({
                  ...draft,
                  documentKind: draft.documentKind,
                  jobType: draft.jobType || template.label,
                  lineItemsText: lineItemsToText(template.lineItems),
                  notes: draft.notes || template.notes,
                  templateKey: template.key,
                })
              }
              style={[
                styles.choiceChip,
                draft.templateKey === template.key
                  ? styles.choiceChipActive
                  : null,
              ]}
            >
              <Text
                style={[
                  styles.choiceText,
                  draft.templateKey === template.key
                    ? styles.choiceTextActive
                    : null,
                ]}
              >
                {template.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <SettingField label="Title">
        <TextInput
          editable={!busy}
          onChangeText={(title) => setDraft({ ...draft, title })}
          style={styles.input}
          value={draft.title}
        />
      </SettingField>
      <View style={styles.twoColumn}>
        <SettingField label="Status">
          <TextInput
            autoCapitalize="none"
            editable={!busy}
            onChangeText={(status) => setDraft({ ...draft, status })}
            style={styles.input}
            value={draft.status}
          />
        </SettingField>
        <SettingField label="Job">
          <TextInput
            editable={!busy}
            onChangeText={(jobType) => setDraft({ ...draft, jobType })}
            style={styles.input}
            value={draft.jobType}
          />
        </SettingField>
      </View>
      <View style={styles.twoColumn}>
        <SettingField label="Customer">
          <TextInput
            editable={!busy}
            onChangeText={(customerName) =>
              setDraft({ ...draft, customerName })
            }
            style={styles.input}
            value={draft.customerName}
          />
        </SettingField>
        <SettingField label="Email">
          <TextInput
            autoCapitalize="none"
            editable={!busy}
            keyboardType="email-address"
            onChangeText={(customerEmail) =>
              setDraft({ ...draft, customerEmail })
            }
            style={styles.input}
            value={draft.customerEmail}
          />
        </SettingField>
      </View>
      <SettingField label="Address">
        <TextInput
          editable={!busy}
          onChangeText={(jobAddress) => setDraft({ ...draft, jobAddress })}
          style={styles.input}
          value={draft.jobAddress}
        />
      </SettingField>
      <SettingField label="Line items">
        <TextInput
          editable={!busy}
          multiline
          onChangeText={(lineItemsText) =>
            setDraft({ ...draft, lineItemsText })
          }
          style={[styles.input, styles.textAreaSmall]}
          value={draft.lineItemsText}
        />
      </SettingField>
      <SettingField label="Notes">
        <TextInput
          editable={!busy}
          multiline
          onChangeText={(notes) => setDraft({ ...draft, notes })}
          style={[styles.input, styles.textAreaSmall]}
          value={draft.notes}
        />
      </SettingField>
      <View style={styles.saveFooter}>
        <Text style={styles.footerText}>
          One line item per row: item | qty | unit | price | note
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>Reset</Text>
        </Pressable>
        <ActionButton disabled={busy} onPress={() => onSave(draft)}>
          <Text style={styles.primaryButtonText}>
            {busy ? "Saving..." : "Save"}
          </Text>
        </ActionButton>
      </View>
    </SectionCard>
  );
}

function TemplateDraftForm({
  busy,
  initialDraft,
  onCancel,
  onSave,
}: {
  busy: boolean;
  initialDraft: TemplateEditorDraft;
  onCancel: () => void;
  onSave: (draft: TemplateEditorDraft) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => {
    setDraft(initialDraft);
  }, [initialDraft]);

  return (
    <SectionCard>
      <SectionHeader eyebrow="Template" title="Reusable quote structure" />
      <SettingField label="Template name">
        <TextInput
          editable={!busy}
          onChangeText={(label) => setDraft({ ...draft, label })}
          style={styles.input}
          value={draft.label}
        />
      </SettingField>
      <SettingField label="Description">
        <TextInput
          editable={!busy}
          onChangeText={(description) => setDraft({ ...draft, description })}
          style={styles.input}
          value={draft.description}
        />
      </SettingField>
      <SettingField label="Reusable line items">
        <TextInput
          editable={!busy}
          multiline
          onChangeText={(lineItemsText) =>
            setDraft({ ...draft, lineItemsText })
          }
          style={[styles.input, styles.textAreaSmall]}
          value={draft.lineItemsText}
        />
      </SettingField>
      <SettingField label="Design direction">
        <TextInput
          editable={!busy}
          multiline
          onChangeText={(quoteStyleDirection) =>
            setDraft({ ...draft, quoteStyleDirection })
          }
          style={[styles.input, styles.textAreaSmall]}
          value={draft.quoteStyleDirection}
        />
      </SettingField>
      <View style={styles.twoColumn}>
        <SettingField label="Accent">
          <TextInput
            autoCapitalize="none"
            editable={!busy}
            onChangeText={(accentTheme) => setDraft({ ...draft, accentTheme })}
            style={styles.input}
            value={draft.accentTheme}
          />
        </SettingField>
        <SettingField label="Currency">
          <TextInput
            autoCapitalize="characters"
            editable={!busy}
            onChangeText={(currency) => setDraft({ ...draft, currency })}
            style={styles.input}
            value={draft.currency}
          />
        </SettingField>
      </View>
      <SettingField label="Payment terms">
        <TextInput
          editable={!busy}
          multiline
          onChangeText={(paymentTerms) => setDraft({ ...draft, paymentTerms })}
          style={[styles.input, styles.textAreaSmall]}
          value={draft.paymentTerms}
        />
      </SettingField>
      <SettingField label="Footer">
        <TextInput
          editable={!busy}
          multiline
          onChangeText={(footerText) => setDraft({ ...draft, footerText })}
          style={[styles.input, styles.textAreaSmall]}
          value={draft.footerText}
        />
      </SettingField>
      <View style={styles.saveFooter}>
        <Text style={styles.footerText}>
          Templates seed future quote drafts.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>Cancel</Text>
        </Pressable>
        <ActionButton disabled={busy} onPress={() => onSave(draft)}>
          <Text style={styles.primaryButtonText}>
            {busy ? "Saving..." : "Save"}
          </Text>
        </ActionButton>
      </View>
    </SectionCard>
  );
}

function QuoteDraftRow({
  onPress,
  quoteDraft,
}: {
  onPress: () => void;
  quoteDraft: MobileQuoteDraftListItem;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.fileRow}
    >
      <View style={styles.fileRowMain}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {quoteDraft.title}
        </Text>
        <Text numberOfLines={1} style={styles.rowCopy}>
          {quoteDraft.contact?.name ??
            quoteDraft.contact?.company ??
            "Manual customer"}{" "}
          - {quoteDraft.lineItemCount} items -{" "}
          {formatDate(quoteDraft.updatedAt)}
        </Text>
      </View>
      <StatusPill label={formatLabel(quoteDraft.status)} tone="purple" />
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

function TemplateRow({
  onEdit,
  template,
}: {
  onEdit: () => void;
  template: MobileDocumentTemplate;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onEdit}
      style={styles.fileRow}
    >
      <View style={styles.fileRowMain}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {template.label}
        </Text>
        <Text numberOfLines={1} style={styles.rowCopy}>
          {template.lineItems.length} reusable items -{" "}
          {template.settings.currency}
        </Text>
      </View>
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

function DocumentGeneratorSettingsPanel({
  launch,
  onLaunchConsumed,
}: {
  launch?: DocumentLaunch;
  onLaunchConsumed?: () => void;
}) {
  return (
    <DocumentWorkbenchPanel
      launch={launch}
      onLaunchConsumed={onLaunchConsumed}
    />
  );
}

function FilesSettingsPanel() {
  const { session, status } = useAuthSession();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<MobileFileFilter>("all");
  const [previewFile, setPreviewFile] = useState<MobileFileItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const files = useQuery({
    ...mobileFilesQueryOptions(session),
    enabled: status === "signed-in",
  });
  const openFile = useMutation({
    mutationFn: (fileId: string) =>
      kyroApiFetch<MobileFileLinkResponse>("/api/mobile/file-link", {
        query: { fileId },
        session,
      }),
    onError: (error) => {
      setMessage(
        error instanceof Error ? error.message : "Unable to open file.",
      );
    },
    onSuccess: async (link) => {
      setMessage(null);
      await Linking.openURL(link.url);
    },
  });
  const fileData = files.data;
  const visibleFiles =
    fileData?.files.filter((file) =>
      fileMatchesMobileFilter(file, activeFilter),
    ) ?? [];

  useEffect(() => {
    if (
      status !== "signed-in" ||
      !session?.access_token ||
      !fileData?.files.length
    ) {
      return undefined;
    }

    const timers = fileData.files
      .filter((file) => file.kind === "image" && file.canPreviewInline)
      .slice(0, 3)
      .map((file, index) =>
        setTimeout(() => {
          void queryClient
            .prefetchQuery(mobileFilePreviewQueryOptions(session, file.id))
            .catch(() => undefined);
        }, index * 80),
      );

    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [fileData?.files, queryClient, session, status]);

  return (
    <>
      <SectionCard>
        <SectionHeader
          action={
            <StatusPill
              label={`${visibleFiles.length} shown`}
              tone={activeFilter === "all" ? "cyan" : "purple"}
            />
          }
          eyebrow="Library"
          title="Generated and uploaded files"
        />
        <FileFilterChips
          activeFilter={activeFilter}
          counts={fileData?.counts}
          filters={fileData?.filters}
          onChange={setActiveFilter}
        />
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {files.isLoading ? <FilesLoadingRows /> : null}
        <DataState error={files.error} loading={false} title="Loading files" />
        {fileData && !files.isLoading ? (
          visibleFiles.length ? (
            <View style={styles.fileList}>
              {visibleFiles.map((file) => (
                <FileLibraryRow
                  disabled={openFile.isPending}
                  file={file}
                  key={file.id}
                  onOpen={() => {
                    if (file.kind === "image") {
                      setPreviewFile(file);
                      return;
                    }

                    openFile.mutate(file.id);
                  }}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyCopy}>
              {fileData.files.length
                ? "No files match this view."
                : "Generated images, PDFs, inbound attachments, and uploads will appear here."}
            </Text>
          )
        ) : null}
      </SectionCard>

      <FileImagePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />
    </>
  );
}

function FileFilterChips({
  activeFilter,
  counts,
  filters,
  onChange,
}: {
  activeFilter: MobileFileFilter;
  counts?: Record<MobileFileFilter, number>;
  filters?: MobileFileFilter[];
  onChange: (filter: MobileFileFilter) => void;
}) {
  const visibleFilters: MobileFileFilter[] = filters ?? [
    "all",
    "generated",
    "upload",
    "image",
    "document",
    "email",
  ];

  return (
    <View style={styles.chipGrid}>
      {visibleFilters.map((filter) => {
        const active = activeFilter === filter;

        return (
          <Pressable
            accessibilityRole="button"
            key={filter}
            onPress={() => onChange(filter)}
            style={[styles.choiceChip, active ? styles.choiceChipActive : null]}
          >
            {active ? <Check color={colors.background} size={13} /> : null}
            <Text
              style={[
                styles.choiceText,
                active ? styles.choiceTextActive : null,
              ]}
            >
              {fileFilterLabel(filter)}
              {typeof counts?.[filter] === "number" ? ` ${counts[filter]}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FilesLoadingRows() {
  return (
    <View style={styles.fileList}>
      {(["cyan", "purple", "pink"] as const).map((tone, index) => (
        <View style={styles.fileRow} key={`${tone}-${index}`}>
          <SkeletonIcon tone={tone} />
          <View style={styles.fileRowMain}>
            <SkeletonLine tone={tone} width={index === 1 ? "52%" : "68%"} />
            <SkeletonLine height={10} width={index === 2 ? "76%" : "58%"} />
          </View>
          <ChevronRight color={colors.muted} size={18} />
        </View>
      ))}
    </View>
  );
}

function FileLibraryRow({
  disabled,
  file,
  onOpen,
}: {
  disabled: boolean;
  file: MobileFileItem;
  onOpen: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.fileRow,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <FileThumb file={file} />
      <View style={styles.fileRowMain}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {file.filename}
        </Text>
        <Text numberOfLines={1} style={styles.rowCopy}>
          {file.sourceLabel} - {formatFileSize(file.sizeBytes)} -{" "}
          {formatDate(file.createdAt)}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {file.contentType ?? formatLabel(file.kind)}
        </Text>
      </View>
      {file.kind === "image" ? (
        <ImageIcon color={colors.cyan} size={18} strokeWidth={2.4} />
      ) : (
        <ExternalLink color={colors.muted} size={18} strokeWidth={2.4} />
      )}
    </Pressable>
  );
}

function FileThumb({ file }: { file: MobileFileItem }) {
  const { session } = useAuthSession();
  const preview = useQuery({
    ...mobileFilePreviewQueryOptions(session, file.id),
    enabled: Boolean(session?.access_token && file.kind === "image"),
  });
  const imageUri = preview.data?.dataUri;

  if (imageUri) {
    return (
      <Image
        resizeMode="cover"
        source={{ uri: imageUri }}
        style={styles.fileThumbImage}
      />
    );
  }

  return (
    <View style={styles.fileKindToken}>
      <Text style={styles.fileKindTokenText}>
        {file.kind === "image" ? "IMG" : fileKindToken(file.kind)}
      </Text>
    </View>
  );
}

function FileImagePreviewModal({
  file,
  onClose,
}: {
  file: MobileFileItem | null;
  onClose: () => void;
}) {
  const { session } = useAuthSession();
  const preview = useQuery({
    ...mobileFilePreviewQueryOptions(session, file?.id),
    enabled: Boolean(session?.access_token && file?.id),
  });
  const imageUri = preview.data?.dataUri;

  return (
    <Modal
      animationType="fade"
      hardwareAccelerated
      navigationBarTranslucent
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={Boolean(file)}
    >
      <StatusBar hidden />
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={styles.previewBackdrop}
      >
        {imageUri ? (
          <Image
            resizeMode="contain"
            source={{ uri: imageUri }}
            style={styles.previewImage}
          />
        ) : (
          <Text style={styles.previewLoadingText}>Loading image...</Text>
        )}
      </Pressable>
    </Modal>
  );
}

function EmailSyncHealthSummary({ data }: { data: MobileSettingsResponse }) {
  const latestSync = data.status.latestSync;
  const connectedConnections = data.connections.filter(
    (connection) => connection.status === "connected",
  );
  const health = emailSyncHealthStatus(data);
  const lastSuccessfulSync = latestConnectionTimestamp(
    connectedConnections,
    "lastSyncAt",
  );
  const lastCheckAttempt = latestConnectionTimestamp(
    connectedConnections,
    "lastCheckedAt",
  );

  return (
    <View style={styles.nestedPanel}>
      <View style={styles.rowHeader}>
        <View style={styles.flexOne}>
          <Text style={styles.summaryLabel}>Sync health</Text>
          <Text style={styles.summaryValue}>{health.title}</Text>
          <Text style={styles.summaryMeta}>{health.detail}</Text>
        </View>
        <StatusPill label={health.pill} tone={health.tone} />
      </View>
      <View style={styles.summaryStrip}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Last successful</Text>
          <Text style={styles.summaryValue}>
            {formatDate(lastSuccessfulSync)}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Last check</Text>
          <Text style={styles.summaryValue}>
            {formatDate(lastCheckAttempt)}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Next sync</Text>
          <Text style={styles.summaryValue} numberOfLines={1}>
            {nextEmailSyncLabel(data)}
          </Text>
        </View>
      </View>
      {connectedConnections.length ? (
        connectedConnections.slice(0, 3).map((connection) => (
          <View key={connection.id} style={styles.compactStatusRow}>
            <View style={styles.flexOne}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {connection.providerLabel}{" "}
                {connection.accountEmail ?? connection.accountName ?? ""}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {connection.lastError
                  ? connection.lastError
                  : connection.readReady
                    ? "Read scope ready"
                    : "Read scope missing"}
              </Text>
            </View>
            <StatusPill
              label={connection.needsReconnect ? "Reconnect" : "Ready"}
              tone={connection.needsReconnect ? "warning" : "green"}
            />
          </View>
        ))
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => openWebSettingsPanel("email-accounts")}
          style={({ pressed }) => [
            styles.iconButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <ExternalLink color={colors.text} size={18} />
          <Text style={styles.iconButtonText}>Set up email</Text>
        </Pressable>
      )}
      {latestSync ? (
        <Text style={styles.summaryMeta}>
          Latest run: {latestSync.promotedMessages} promoted,{" "}
          {latestSync.errors} errors.
        </Text>
      ) : null}
    </View>
  );
}

function emailSyncHealthStatus(data: MobileSettingsResponse): {
  detail: string;
  pill: string;
  title: string;
  tone: "cyan" | "green" | "neutral" | "purple" | "warning";
} {
  const connectedConnections = data.connections.filter(
    (connection) => connection.status === "connected",
  );

  if (!connectedConnections.length) {
    return {
      detail: "Connect Gmail or Outlook before automatic inbound checks can run.",
      pill: "Setup",
      title: "Set up email",
      tone: "warning",
    };
  }

  if (data.status.reconnectNeededCount) {
    return {
      detail: `${data.status.reconnectNeededCount} connected account needs a fresh read permission grant.`,
      pill: "Reconnect",
      title: "Reconnect needed",
      tone: "warning",
    };
  }

  if (connectedConnections.some((connection) => connection.lastError)) {
    return {
      detail: "A recent account check reported an error. Review the affected account below.",
      pill: "Check",
      title: "Last check needs attention",
      tone: "warning",
    };
  }

  if (data.settings.inboundEmail.syncMode === "paused") {
    return {
      detail: "Inbound email sync is paused for this workspace.",
      pill: "Paused",
      title: "Paused",
      tone: "neutral",
    };
  }

  if (data.settings.inboundEmail.syncMode === "manual_only") {
    return {
      detail: "Kyro will only check inbound email when triggered manually.",
      pill: "Manual",
      title: "Manual checks only",
      tone: "purple",
    };
  }

  return {
    detail: "Automatic inbound email checks are configured for connected accounts.",
    pill: "Ready",
    title: "Automatic sync ready",
    tone: "green",
  };
}

function latestConnectionTimestamp(
  connections: MobileSettingsResponse["connections"],
  key: "lastCheckedAt" | "lastSyncAt",
) {
  return connections
    .map((connection) => connection[key])
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function nextEmailSyncLabel(data: MobileSettingsResponse) {
  const syncMode = data.settings.inboundEmail.syncMode;

  if (!data.status.connectedAccountCount) {
    return "Set up email";
  }

  if (syncMode === "paused") {
    return "Paused";
  }

  if (syncMode === "manual_only") {
    return "Manual only";
  }

  return `Every ${data.settings.inboundEmail.pollIntervalMinutes} min`;
}

function openWebSettingsPanel(panel: string) {
  const baseUrl = mobileEnv.kyroApiBaseUrl;

  if (!baseUrl) {
    return;
  }

  const url = new URL("/settings", baseUrl);
  url.searchParams.set("section", "integrations");
  url.searchParams.set("panel", panel);
  Linking.openURL(url.toString()).catch(() => undefined);
}

function SettingField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <View style={styles.settingField}>
      <Text style={styles.settingLabel}>{label}</Text>
      {children}
    </View>
  );
}

function SwitchRow({
  label,
  onValueChange,
  value,
}: {
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        onValueChange={onValueChange}
        thumbColor={value ? colors.text : colors.muted}
        trackColor={{
          false: colors.line,
          true: "rgba(81, 229, 255, 0.48)",
        }}
        value={value}
      />
    </View>
  );
}

function NumberInput({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <TextInput
      editable={!disabled}
      keyboardType="number-pad"
      onChangeText={(text) => {
        const parsed = Number(text);

        if (Number.isFinite(parsed)) {
          onChange(parsed);
        }
      }}
      placeholderTextColor={colors.muted}
      style={styles.input}
      value={String(value)}
    />
  );
}

function OptionChips({
  formatOption = formatLabel,
  onChange,
  options,
  value,
}: {
  formatOption?: (value: string) => string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <View style={styles.chipGrid}>
      {options.map((option) => {
        const active = option === value;

        return (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => onChange(option)}
            style={[styles.choiceChip, active ? styles.choiceChipActive : null]}
          >
            {active ? <Check color={colors.background} size={13} /> : null}
            <Text
              style={[
                styles.choiceText,
                active ? styles.choiceTextActive : null,
              ]}
            >
              {formatOption(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MultiOptionChips({
  onChange,
  options,
  value,
}: {
  onChange: (value: string[]) => void;
  options: string[];
  value: string[];
}) {
  return (
    <View style={styles.chipGrid}>
      {options.map((option) => {
        const active = value.includes(option);

        return (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => {
              const next = active
                ? value.filter((item) => item !== option)
                : [...value, option];

              onChange(next.length ? next : value);
            }}
            style={[styles.choiceChip, active ? styles.choiceChipActive : null]}
          >
            {active ? <Check color={colors.background} size={13} /> : null}
            <Text
              style={[
                styles.choiceText,
                active ? styles.choiceTextActive : null,
              ]}
            >
              {formatLabel(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SaveFooter({
  disabled,
  label,
  onPress,
  text,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  text?: string;
}) {
  return (
    <View style={styles.saveFooter}>
      {text ? (
        <Text style={styles.footerText}>{text}</Text>
      ) : (
        <View style={styles.footerSpacer} />
      )}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={[styles.saveButton, disabled ? styles.disabled : null]}
      >
        <Text style={styles.saveButtonText}>{disabled ? "Saving" : label}</Text>
      </Pressable>
    </View>
  );
}

function sectionItemFor(section: SettingsSection) {
  return sectionItems.find((item) => item.section === section) ?? null;
}

function visibleSectionsForGroup(
  group: SettingsGroupItem,
  data: MobileSettingsResponse,
) {
  return group.sections.filter(
    (section) => section !== "developer" || data.developer.enabled,
  );
}

function settingsAccount(
  data: MobileSettingsResponse,
  fallbackEmail?: string | null,
): SettingsAccount {
  const account = (data as Partial<MobileSettingsResponse>).account;

  return {
    email: account?.email ?? fallbackEmail ?? null,
    emailVerified: account?.emailVerified ?? true,
    supabaseEmailConfirmed: account?.supabaseEmailConfirmed ?? true,
    verificationRequired: account?.verificationRequired ?? false,
  };
}

function fallbackSettingsAccount(fallbackEmail?: string | null): SettingsAccount {
  return {
    email: fallbackEmail ?? null,
    emailVerified: true,
    supabaseEmailConfirmed: true,
    verificationRequired: false,
  };
}

function normalizeMobileBusinessProfile(
  value:
    | MobileSettingsResponse["settings"]["general"]["businessProfile"]
    | null
    | undefined,
): MobileSettingsResponse["settings"]["general"]["businessProfile"] {
  const source = value ?? emptyBusinessProfile;

  return {
    ...emptyBusinessProfile,
    ...source,
    contactHoursSchedule: normalizeBusinessHoursSchedule(
      source.contactHoursSchedule,
    ),
    workingHoursSchedule: normalizeBusinessHoursSchedule(
      source.workingHoursSchedule,
    ),
  };
}

function normalizeMobileVoiceSettings(
  value: Partial<MobileVoiceSettings> | null | undefined,
): MobileVoiceSettings {
  const fallbackVapiVoice =
    vapiVoiceOptionsFallback.find(
      (voice) => voice.id === defaultVoiceDraft.elevenLabsVoicePresetId,
    ) ?? vapiVoiceOptionsFallback[0];

  return {
    elevenLabsVoiceAccent:
      typeof value?.elevenLabsVoiceAccent === "string"
        ? value.elevenLabsVoiceAccent
        : (fallbackVapiVoice?.accent ?? "Australian"),
    elevenLabsVoiceId:
      typeof value?.elevenLabsVoiceId === "string"
        ? value.elevenLabsVoiceId
        : (fallbackVapiVoice?.voiceId ?? ""),
    elevenLabsVoiceLabel:
      typeof value?.elevenLabsVoiceLabel === "string"
        ? value.elevenLabsVoiceLabel
        : (fallbackVapiVoice?.label ?? "Female - Australian"),
    elevenLabsVoicePresetId:
      typeof value?.elevenLabsVoicePresetId === "string" &&
      value.elevenLabsVoicePresetId.trim()
        ? value.elevenLabsVoicePresetId
        : defaultVoiceDraft.elevenLabsVoicePresetId,
    openAiVoice:
      typeof value?.openAiVoice === "string"
        ? value.openAiVoice
        : defaultVoiceDraft.openAiVoice,
    outboundVoicePronunciationPolicy:
      typeof value?.outboundVoicePronunciationPolicy === "string"
        ? value.outboundVoicePronunciationPolicy
        : defaultVoiceDraft.outboundVoicePronunciationPolicy,
    phoneAgentDemeanor:
      typeof value?.phoneAgentDemeanor === "string"
        ? value.phoneAgentDemeanor
        : defaultVoiceDraft.phoneAgentDemeanor,
    phoneAgentEnabled:
      typeof value?.phoneAgentEnabled === "boolean"
        ? value.phoneAgentEnabled
        : defaultVoiceDraft.phoneAgentEnabled,
    phoneAgentEscalationMode:
      typeof value?.phoneAgentEscalationMode === "string"
        ? value.phoneAgentEscalationMode
        : defaultVoiceDraft.phoneAgentEscalationMode,
    phoneAgentHumourLevel:
      typeof value?.phoneAgentHumourLevel === "string"
        ? value.phoneAgentHumourLevel
        : defaultVoiceDraft.phoneAgentHumourLevel,
    phoneAgentInboundEnabled:
      typeof value?.phoneAgentInboundEnabled === "boolean"
        ? value.phoneAgentInboundEnabled
        : defaultVoiceDraft.phoneAgentInboundEnabled,
    phoneAgentOutboundEnabled:
      typeof value?.phoneAgentOutboundEnabled === "boolean"
        ? value.phoneAgentOutboundEnabled
        : defaultVoiceDraft.phoneAgentOutboundEnabled,
    phoneAgentUserNumbers: Array.isArray(value?.phoneAgentUserNumbers)
      ? value.phoneAgentUserNumbers.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : defaultVoiceDraft.phoneAgentUserNumbers,
    phoneAgentVerbosity:
      typeof value?.phoneAgentVerbosity === "string"
        ? value.phoneAgentVerbosity
        : defaultVoiceDraft.phoneAgentVerbosity,
    phoneAgentVoicemailOverflowEnabled:
      typeof value?.phoneAgentVoicemailOverflowEnabled === "boolean"
        ? value.phoneAgentVoicemailOverflowEnabled
        : defaultVoiceDraft.phoneAgentVoicemailOverflowEnabled,
    provider:
      typeof value?.provider === "string" && value.provider
        ? value.provider
        : "vapi",
  };
}

function normalizeVoiceDraft(
  value: Partial<MobileVoiceSettings> | null | undefined,
): VoiceDraft {
  const settings = normalizeMobileVoiceSettings(value);

  return {
    elevenLabsVoicePresetId: settings.elevenLabsVoicePresetId,
    openAiVoice: settings.openAiVoice,
    outboundVoicePronunciationPolicy:
      settings.outboundVoicePronunciationPolicy,
    phoneAgentDemeanor: settings.phoneAgentDemeanor,
    phoneAgentEnabled: settings.phoneAgentEnabled,
    phoneAgentEscalationMode: settings.phoneAgentEscalationMode,
    phoneAgentHumourLevel: settings.phoneAgentHumourLevel,
    phoneAgentInboundEnabled: settings.phoneAgentInboundEnabled,
    phoneAgentOutboundEnabled: settings.phoneAgentOutboundEnabled,
    phoneAgentUserNumbers: settings.phoneAgentUserNumbers,
    phoneAgentVerbosity: settings.phoneAgentVerbosity,
    phoneAgentVoicemailOverflowEnabled:
      settings.phoneAgentVoicemailOverflowEnabled,
  };
}

function voiceOptionValues(options: string[] | undefined, activeValue: string) {
  const values = options?.length ? options : [activeValue];

  return values.includes(activeValue) ? values : [activeValue, ...values];
}

function normalizeBusinessHoursSchedule(
  value: Partial<MobileBusinessHoursScheduleSettings> | null | undefined,
): MobileBusinessHoursScheduleSettings {
  const fallback = defaultBusinessHoursSchedule();
  const inputDays = new Map(
    Array.isArray(value?.days)
      ? value.days.map((day, index) => {
          const fallbackDay = fallback.days[index] ?? fallback.days[0];
          const normalizedDay = normalizeBusinessHourDayKey(
            day.day,
            fallbackDay.day,
          );

          return [normalizedDay, day] as const;
        })
      : [],
  );

  return {
    days: businessHourDays.map((day) => {
      const fallbackDay =
        fallback.days.find((candidate) => candidate.day === day.key) ??
        fallback.days[0];
      const input = inputDays.get(day.key);

      return {
        day: day.key,
        enabled:
          typeof input?.enabled === "boolean"
            ? input.enabled
            : fallbackDay.enabled,
        endTime: normalizeBusinessTime(input?.endTime, fallbackDay.endTime),
        startTime: normalizeBusinessTime(
          input?.startTime,
          fallbackDay.startTime,
        ),
      };
    }),
    notes: typeof value?.notes === "string" ? value.notes : "",
  };
}

function normalizeBusinessHourDayKey(
  value: unknown,
  fallback: MobileBusinessHourDayKey,
): MobileBusinessHourDayKey {
  return businessHourDays.some((day) => day.key === value)
    ? (value as MobileBusinessHourDayKey)
    : fallback;
}

function normalizeBusinessTime(value: unknown, fallback: string) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : fallback;
}

function businessHoursScheduleSummary(
  schedule: MobileBusinessHoursScheduleSettings,
) {
  const normalized = normalizeBusinessHoursSchedule(schedule);
  const groups = new Map<string, string[]>();

  normalized.days
    .filter((day) => day.enabled)
    .forEach((day) => {
      const key = `${day.startTime}-${day.endTime}`;
      const label =
        businessHourDays.find((candidate) => candidate.key === day.day)
          ?.shortLabel ?? day.day;

      groups.set(key, [...(groups.get(key) ?? []), label]);
    });

  const summary = Array.from(groups.entries()).map(([range, labels]) => {
    const [start, end] = range.split("-");

    return `${labels.join(", ")}: ${formatTimeLabel(start)} to ${formatTimeLabel(
      end,
    )}`;
  });
  const notes = normalized.notes.trim();

  return [...summary, notes ? `Notes: ${notes}` : null]
    .filter((item): item is string => Boolean(item))
    .join("; ") || "Not set";
}

function splitTags(value: string | null | undefined) {
  return dedupeTextValues(
    (value ?? "")
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function dedupeTextValues(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];

  values.forEach((value) => {
    const normalized = value.trim();
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      return;
    }

    seen.add(key);
    next.push(normalized);
  });

  return next;
}

function formatTimeLabel(value: string) {
  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return value;
  }

  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;

  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function appLockModeLabel(mode: AppLockMode) {
  if (mode === "biometrics") {
    return "Biometrics";
  }

  if (mode === "passcode") {
    return "Passcode";
  }

  return "No app lock";
}

function normalizeSecurityPasscode(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function isValidSecurityPasscode(value: string) {
  return /^\d{4,8}$/.test(value);
}

function fileMatchesMobileFilter(
  file: MobileFileItem,
  filter: MobileFileFilter,
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "generated") {
    return file.kind === "generated" || file.source.startsWith("generated_");
  }

  return file.kind === filter;
}

function quoteDraftPayload(draft: QuoteEditorDraft) {
  return {
    customerCompany: draft.customerCompany,
    customerEmail: draft.customerEmail,
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    documentKind: draft.documentKind,
    jobAddress: draft.jobAddress,
    jobType: draft.jobType,
    lineItems: parseLineItemsText(draft.lineItemsText),
    notes: draft.notes,
    preferredTime: draft.preferredTime,
    status: draft.status || "draft",
    templateKey: draft.templateKey || null,
    title: draft.title || "Quote draft",
  };
}

function quoteDraftFromTemplate(
  template: MobileDocumentTemplate | null,
  documentKind: "invoice" | "quote" = "quote",
): QuoteEditorDraft {
  return {
    customerCompany: "",
    customerEmail: "",
    customerName: "",
    customerPhone: "",
    documentKind,
    jobAddress: "",
    jobType: template?.label ?? "",
    lineItemsText: lineItemsToText(template?.lineItems ?? []),
    notes: template?.notes ?? "",
    preferredTime: "",
    status: "draft",
    templateKey: template?.key ?? "",
    title: template
      ? `${template.label} ${documentKind}`
      : documentKind === "invoice"
        ? "Invoice draft"
        : "Quote draft",
  };
}

function quoteDraftFromDetail(
  detail: MobileQuoteDraftDetailResponse,
): QuoteEditorDraft {
  const quote = detail.quoteDraft;
  const quoteMetadata =
    "metadata" in quote && quote.metadata && typeof quote.metadata === "object"
      ? (quote.metadata as Record<string, unknown>)
      : {};

  return {
    customerCompany: stringDraftValue(quoteMetadata.customerCompany),
    customerEmail: stringDraftValue(
      quoteMetadata.customerEmail ?? quote.contact?.email,
    ),
    customerName: stringDraftValue(
      quoteMetadata.customerName ?? quote.contact?.name,
    ),
    customerPhone: stringDraftValue(
      quoteMetadata.customerPhone ?? quote.contact?.phone,
    ),
    documentKind:
      quoteMetadata.documentKind === "invoice" ? "invoice" : "quote",
    jobAddress: stringDraftValue(
      quoteMetadata.jobAddress ??
        quote.inquiryFacts?.address ??
        quote.contact?.address,
    ),
    jobType: stringDraftValue(
      quoteMetadata.jobType ??
        quote.inquiryFacts?.jobType ??
        quote.lead?.serviceType,
    ),
    lineItemsText: lineItemsToText(quote.lineItems),
    notes: quote.notes ?? "",
    preferredTime: stringDraftValue(
      quoteMetadata.preferredTime ?? quote.inquiryFacts?.preferredTime,
    ),
    status: quote.status,
    templateKey: stringDraftValue(quoteMetadata.templateKey),
    title: quote.title,
  };
}

function templateDraftFromTemplate(
  template: MobileDocumentTemplate | null | undefined,
  settings: MobileDocumentsResponse["settings"],
): TemplateEditorDraft {
  const sourceSettings = template?.settings ?? settings;

  return {
    accentTheme: sourceSettings.accentTheme,
    currency: sourceSettings.currency,
    description: template?.description ?? "",
    footerText: sourceSettings.footerText,
    label: template?.label ?? "",
    lineItemsText: lineItemsToText(template?.lineItems ?? []),
    notes: template?.notes ?? "",
    paymentTerms: sourceSettings.paymentTerms,
    quoteStyleDirection: sourceSettings.quoteStyleDirection,
    showPreparedBy: sourceSettings.showPreparedBy,
    templateKey: template?.key ?? "",
    validityDays: String(sourceSettings.validityDays),
  };
}

function stringDraftValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseLineItemsText(value: string): MobileQuoteLineItem[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        descriptionValue,
        quantityValue,
        unitValue,
        unitPriceValue,
        notesValue,
      ] = line.split("|").map((part) => part.trim());
      const quantity = parseNullableMoney(quantityValue);
      const unitPrice = parseNullableMoney(unitPriceValue);

      return {
        description: descriptionValue || "Quote line item",
        notes: notesValue || null,
        quantity,
        total:
          quantity !== null && unitPrice !== null
            ? Math.round(quantity * unitPrice * 100) / 100
            : null,
        unit: unitValue || null,
        unitPrice,
      };
    });
}

function lineItemsToText(items: MobileQuoteLineItem[]) {
  return items
    .map((item) =>
      [
        item.description,
        item.quantity ?? "",
        item.unit ?? "",
        item.unitPrice ?? "",
        item.notes ?? "",
      ].join(" | "),
    )
    .join("\n");
}

function parseNullableMoney(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/[$,]/g, "").trim());

  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: number | null | undefined, currency = "AUD") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en", {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function paymentReady(data?: MobilePaymentsResponse | null) {
  return Boolean(
    data?.migrationReady &&
    data.configured &&
    data.account?.status === "active" &&
    data.account.chargesEnabled,
  );
}

function paymentStatusTone(
  status: string,
): "cyan" | "green" | "neutral" | "pink" | "purple" | "warning" {
  if (status === "paid") {
    return "green";
  }

  if (status === "failed" || status === "cancelled" || status === "refunded") {
    return "pink";
  }

  if (status === "link_created" || status === "sent") {
    return "cyan";
  }

  if (status === "overdue") {
    return "warning";
  }

  return "purple";
}

function defaultInvoiceTemplateFromDocuments(data: MobileDocumentsResponse) {
  const selectedKey = data.settings.defaultInvoiceTemplateKey;
  const selected = selectedKey
    ? data.templates.find((template) => template.key === selectedKey)
    : null;

  return (
    selected ??
    data.templates.find((template) => /invoice/i.test(template.label)) ??
    data.templates[0] ??
    null
  );
}

function fileFilterLabel(filter: MobileFileFilter) {
  if (filter === "all") {
    return "All";
  }

  if (filter === "upload") {
    return "Uploaded";
  }

  return `${filter.charAt(0).toUpperCase()}${filter.slice(1)}s`;
}

function fileKindToken(kind: MobileFileItem["kind"]) {
  if (kind === "document") {
    return "DOC";
  }

  if (kind === "generated") {
    return "GEN";
  }

  if (kind === "upload") {
    return "UP";
  }

  if (kind === "email") {
    return "MAIL";
  }

  return "FILE";
}

function formatFileSize(value: number | null) {
  if (!value || value <= 0) {
    return "-";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`;
  }

  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatContactType(value: string) {
  if (value === "property_manager") {
    return "Property manager";
  }

  return formatLabel(value);
}

function normalizeDeviceContact(
  contact: Contacts.ExistingContact,
): DeviceContactRow | null {
  const email = primaryEmail(contact.emails);
  const phone = primaryPhone(contact.phoneNumbers);
  const address = formatDeviceAddress(contact.addresses?.[0]);
  const firstName = cleanText(contact.firstName);
  const lastName = cleanText(contact.lastName);
  const company = cleanText(contact.company);
  const name =
    cleanText(contact.name) ??
    [firstName, lastName].filter(Boolean).join(" ").trim() ??
    null;

  if (!name && !email && !phone && !company) {
    return null;
  }

  return {
    address,
    company,
    email,
    firstName,
    id:
      cleanText(contact.id) ??
      [name, email, phone, company].filter(Boolean).join(":").toLowerCase(),
    lastName,
    name,
    phone,
  };
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function primaryEmail(emails?: Contacts.Email[]) {
  const email = emails?.find((candidate) => candidate.isPrimary) ?? emails?.[0];

  return cleanText(email?.email)?.toLowerCase() ?? null;
}

function primaryPhone(phoneNumbers?: Contacts.PhoneNumber[]) {
  const phone =
    phoneNumbers?.find((candidate) => candidate.isPrimary) ?? phoneNumbers?.[0];

  return cleanText(phone?.number) ?? cleanText(phone?.digits) ?? null;
}

function formatDeviceAddress(address?: Contacts.Address) {
  if (!address) {
    return null;
  }

  return (
    [
      address.street,
      address.city,
      address.region,
      address.postalCode,
      address.country,
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(", ") || null
  );
}

function dedupeDeviceContacts(contacts: DeviceContactRow[]) {
  const seen = new Set<string>();

  return contacts.filter((contact) => {
    const key = [
      contact.email?.toLowerCase(),
      normalizePhone(contact.phone),
      contact.name?.toLowerCase(),
      contact.company?.toLowerCase(),
    ]
      .filter(Boolean)
      .join("|");
    const stableKey = key || contact.id;

    if (seen.has(stableKey)) {
      return false;
    }

    seen.add(stableKey);
    return true;
  });
}

function contactMatchesSearch(contact: DeviceContactRow, search: string) {
  const needle = search.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return [
    contact.name,
    contact.company,
    contact.email,
    contact.phone,
    contact.address,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function normalizePhone(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";

  return digits.length >= 6 ? digits : null;
}

function inboundSyncModeLabel(value: string) {
  if (value === "manual_only") {
    return "Manual only";
  }

  return formatLabel(value);
}

function policyLabel(value: string) {
  return value === "strict"
    ? "Strict"
    : value === "balanced"
      ? "Balanced"
      : value === "flexible"
        ? "Flexible"
        : "Off";
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function activityItemMatchesFilter(
  item: MobileActivityLogItem,
  filter: string,
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "messages") {
    return item.tone === "inbound" || item.tone === "outbound";
  }

  if (filter === "actions") {
    return item.tone === "action";
  }

  if (filter === "events") {
    return item.tone === "event";
  }

  if (filter === "routing") {
    return item.tone === "route";
  }

  return item.tone === filter;
}

function operationalLogMatchesFilter(
  item: MobileOperationalLogItem,
  filter: string,
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "warning") {
    return item.status === "warning" || item.status === "error";
  }

  return item.type === filter;
}

function activityToneColor(tone: MobileActivityLogItem["tone"]) {
  if (tone === "inbound" || tone === "usage") {
    return colors.cyan;
  }

  if (tone === "outbound" || tone === "ai") {
    return colors.pink;
  }

  if (tone === "action" || tone === "route") {
    return colors.purple;
  }

  if (tone === "audit") {
    return colors.green;
  }

  return colors.warning;
}

function developerHealthLabel(
  checks: MobileWorkspaceToolsResponse["developer"]["checks"],
) {
  if (checks.some((check) => check.status === "error")) {
    return "Needs attention";
  }

  if (checks.some((check) => check.status === "warning")) {
    return "Warnings";
  }

  return "Healthy";
}

function developerHealthTone(
  checks: MobileWorkspaceToolsResponse["developer"]["checks"],
) {
  if (checks.some((check) => check.status === "error")) {
    return "warning" as const;
  }

  if (checks.some((check) => check.status === "warning")) {
    return "purple" as const;
  }

  return "green" as const;
}

async function writeReportPdf({
  filters,
  mode,
  title,
  sessionToken,
}: {
  filters: {
    channel: string;
    contactId: string;
    direction: string;
    end: string;
    start: string;
    timeframe: string;
    type: string;
  };
  mode: "save" | "view";
  title: string;
  sessionToken: string | null;
}) {
  if (!sessionToken) {
    throw new Error("Sign in again before generating a PDF.");
  }

  if (!FileSystem.documentDirectory) {
    throw new Error("Device storage is not available.");
  }

  const url = new URL("/api/mobile/reports/pdf", mobileEnv.kyroApiBaseUrl);

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const filename = `${reportPdfFilename(title, true)}.pdf`;
  const uri = await downloadPdfFile({
    filename,
    sessionToken,
    url: url.toString(),
  });

  await presentPdfFile({
    filename,
    mode,
    uri,
  });

  return { mode, uri };
}

async function writeQuotePdf({
  mode,
  quoteDraftId,
  sessionToken,
  title,
}: {
  mode: "save" | "view";
  quoteDraftId: string;
  sessionToken: string | null;
  title: string;
}) {
  if (!sessionToken) {
    throw new Error("Sign in again before generating a PDF.");
  }

  if (!FileSystem.documentDirectory) {
    throw new Error("Device storage is not available.");
  }

  const url = new URL(
    `/api/mobile/documents/${encodeURIComponent(quoteDraftId)}/pdf`,
    mobileEnv.kyroApiBaseUrl,
  );
  const filename = `${reportPdfFilename(title, false)}.pdf`;
  const uri = await downloadPdfFile({
    filename,
    sessionToken,
    url: url.toString(),
  });

  await presentPdfFile({
    filename,
    mode,
    uri,
  });

  return { mode, uri };
}

async function downloadPdfFile({
  filename,
  sessionToken,
  url,
}: {
  filename: string;
  sessionToken: string;
  url: string;
}) {
  if (!FileSystem.documentDirectory) {
    throw new Error("Device storage is not available.");
  }

  const uri = `${FileSystem.documentDirectory}${filename}`;
  const result = await FileSystem.downloadAsync(url, uri, {
    headers: {
      Accept: "application/pdf",
      Authorization: `Bearer ${sessionToken}`,
    },
  });

  if (result.status < 200 || result.status >= 300) {
    const body = await FileSystem.readAsStringAsync(result.uri).catch(() => "");
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(
      () => undefined,
    );
    const payload = body ? parseJsonObject(body) : null;
    const message =
      payload && "error" in payload
        ? String(payload.error)
        : `Unable to generate PDF (${result.status}).`;

    throw new Error(message);
  }

  return result.uri;
}

async function presentPdfFile({
  filename,
  mode,
  uri,
}: {
  filename: string;
  mode: "save" | "view";
  uri: string;
}) {
  const sharingAvailable = await Sharing.isAvailableAsync().catch(() => false);

  if (sharingAvailable) {
    await Sharing.shareAsync(uri, {
      UTI: "com.adobe.pdf",
      dialogTitle: mode === "save" ? `Save ${filename}` : `Open ${filename}`,
      mimeType: "application/pdf",
    });
    return;
  }

  if (mode === "save") {
    return;
  }

  const openUri = await FileSystem.getContentUriAsync(uri).catch(() => uri);
  const canOpen = await Linking.canOpenURL(openUri).catch(() => false);

  if (!canOpen) {
    throw new Error(
      "PDF saved, but this device could not find an app to open it.",
    );
  }

  await Linking.openURL(openUri);
}

function reportPdfFilename(title: string, includeTimestamp: boolean) {
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  const timestamp = includeTimestamp ? `-${filenameTimestamp(new Date())}` : "";

  return `kyro-${safeTitle || "report"}${timestamp}`;
}

function filenameTimestamp(date: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseJsonObject(body: string) {
  try {
    const payload = JSON.parse(body) as unknown;

    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let index = 0;

  for (; index + 2 < bytes.length; index += 3) {
    output += alphabet[bytes[index] >> 2];
    output += alphabet[((bytes[index] & 3) << 4) | (bytes[index + 1] >> 4)];
    output +=
      alphabet[((bytes[index + 1] & 15) << 2) | (bytes[index + 2] >> 6)];
    output += alphabet[bytes[index + 2] & 63];
  }

  if (index < bytes.length) {
    output += alphabet[bytes[index] >> 2];

    if (index + 1 < bytes.length) {
      output += alphabet[((bytes[index] & 3) << 4) | (bytes[index + 1] >> 4)];
      output += alphabet[(bytes[index + 1] & 15) << 2];
      output += "=";
    } else {
      output += alphabet[(bytes[index] & 3) << 4];
      output += "==";
    }
  }

  return output;
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionRowButton: {
    flex: 1,
  },
  activityList: {
    gap: 8,
  },
  activityMarker: {
    borderRadius: radii.pill,
    height: "72%",
    width: 3,
  },
  activityRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 82,
    padding: 10,
  },
  activityRowTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  buttonInner: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 11,
  },
  choiceChipActive: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.cyan,
  },
  choiceText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
  },
  choiceTextActive: {
    color: colors.background,
  },
  contactSyncActions: {
    flexDirection: "row",
    gap: 10,
  },
  contactSyncCheck: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  contactSyncCheckSelected: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  contactSyncCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  contactSyncList: {
    gap: 8,
  },
  contactSyncMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
  },
  contactSyncName: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  contactSyncRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  contactSyncRowSelected: {
    borderColor: colors.cyan,
  },
  disabled: {
    opacity: 0.52,
  },
  dropdownBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  dropdownButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  dropdownButtonCompact: {
    flex: 1,
    minWidth: 0,
  },
  dropdownOption: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    paddingVertical: 9,
  },
  dropdownOptionMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  dropdownOptionText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  dropdownSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    gap: 2,
    maxHeight: "78%",
    padding: 14,
  },
  dropdownTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "900",
    paddingBottom: 4,
  },
  dropdownValue: {
    color: colors.text,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  googleAttribution: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "right",
    textTransform: "uppercase",
  },
  hoursDayHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  hoursDayLabel: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  hoursDayRow: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  hoursEditor: {
    gap: 9,
  },
  hoursSummaryBox: {
    backgroundColor: "rgba(81, 229, 255, 0.06)",
    borderColor: "rgba(81, 229, 255, 0.22)",
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  hoursSummaryText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  hoursTimeRow: {
    flexDirection: "row",
    gap: 8,
  },
  hoursTimeRowDisabled: {
    opacity: 0.48,
  },
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    minHeight: 36,
    paddingRight: 12,
  },
  backButtonText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900",
  },
  detailHeader: {
    gap: 8,
  },
  detailTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 29,
  },
  detailTitleCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  detailTitleIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  detailTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  detailTransition: {
    gap: 14,
  },
  developerToolRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 72,
    paddingVertical: 10,
  },
  emptyCopy: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  eyebrow: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  fileKindToken: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  fileKindTokenText: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
  },
  fileList: {
    gap: 8,
  },
  fileRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 72,
    padding: 9,
  },
  fileRowMain: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  fileThumbImage: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 48,
    width: 48,
  },
  footerText: {
    color: colors.muted,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  footerSpacer: {
    flex: 1,
  },
  headerUsageChip: {
    alignItems: "baseline",
    alignSelf: "flex-end",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderLeftColor: colors.pink,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 42,
    minWidth: 118,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  headerUsageLabel: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  headerUsageValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 22,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "rgba(236, 54, 141, 0.12)",
    borderColor: "rgba(236, 54, 141, 0.32)",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  disabledButton: {
    opacity: 0.55,
  },
  iconButtonText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  nestedPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.025)",
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    padding: 10,
  },
  input: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "700",
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lookupMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
  },
  message: {
    color: colors.green,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
  },
  passcodeSetup: {
    gap: 10,
    paddingTop: 4,
  },
  moneyText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  primaryButtonText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  pronunciationAddButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
  },
  pronunciationAddButtonText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  pronunciationCount: {
    color: colors.muted,
    flex: 1,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
  },
  pronunciationEditorContent: {
    gap: 12,
    paddingBottom: 4,
  },
  pronunciationEditorHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  pronunciationEditorSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: "82%",
    padding: 14,
  },
  pronunciationHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  pronunciationIconButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  pronunciationList: {
    gap: 7,
  },
  pronunciationListRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pronunciationMetaCell: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minWidth: 0,
    padding: 10,
  },
  pronunciationMetaGrid: {
    flexDirection: "row",
    gap: 8,
  },
  pronunciationMetaLabel: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  pronunciationMetaValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  pronunciationRemoveButton: {
    backgroundColor: "rgba(255, 92, 122, 0.1)",
    borderColor: "rgba(255, 92, 122, 0.3)",
  },
  pronunciationRowActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  pronunciationRowMain: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.72,
  },
  previewBackdrop: {
    alignItems: "center",
    backgroundColor: "#000",
    flex: 1,
    height: "100%",
    justifyContent: "center",
    width: "100%",
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  previewLoadingText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
  },
  pdfActionButton: {
    flex: 1,
  },
  pdfActions: {
    flexDirection: "row",
    gap: 10,
  },
  pdfDivider: {
    backgroundColor: "rgba(8, 9, 13, 0.16)",
    height: 1,
    marginVertical: 9,
  },
  pdfLine: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pdfLineLabel: {
    color: "rgba(8, 9, 13, 0.62)",
    fontFamily: typography.fontFamily,
    fontSize: 9,
    fontWeight: "900",
  },
  pdfLineValue: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
  },
  pdfPage: {
    alignSelf: "center",
    aspectRatio: 0.7727,
    backgroundColor: colors.surfaceStrong,
    borderRadius: 6,
    gap: 3,
    padding: 18,
    width: "72%",
  },
  pdfPreviewFrame: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: 18,
  },
  quotePreviewPage: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: 8,
    gap: 5,
    padding: 16,
  },
  pdfRowText: {
    color: "rgba(8, 9, 13, 0.72)",
    fontFamily: typography.fontFamily,
    fontSize: 7,
    fontWeight: "700",
  },
  pdfSectionTitle: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 2,
  },
  pdfSubtitle: {
    color: "rgba(8, 9, 13, 0.58)",
    fontFamily: typography.fontFamily,
    fontSize: 8,
    fontWeight: "800",
  },
  pdfTitle: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  rowCopy: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  rowMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "800",
  },
  rowTitle: {
    color: colors.text,
    flexShrink: 1,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "900",
  },
  reportRow: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  reportRowList: {
    gap: 8,
  },
  reportSummaryCard: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 4,
    minHeight: 82,
    padding: 10,
  },
  reportSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  reportSummaryValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 26,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 13,
  },
  saveButtonText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  signatureLogo: {
    height: 46,
  },
  signaturePreview: {
    backgroundColor: "rgba(255, 255, 255, 0.035)",
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 10,
  },
  saveFooter: {
    alignItems: "center",
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 13,
  },
  sessionCopy: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  sessionRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  sessionText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  sessionTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    fontWeight: "900",
  },
  securityError: {
    color: colors.pink,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
  },
  securityMode: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 72,
    padding: 10,
  },
  securityModeActive: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.cyan,
  },
  securityModeDetailActive: {
    color: "rgba(8, 9, 13, 0.72)",
  },
  securityModeIcon: {
    alignItems: "center",
    backgroundColor: "rgba(139, 92, 246, 0.14)",
    borderColor: "rgba(139, 92, 246, 0.34)",
    borderRadius: radii.md,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  securityModeTitleActive: {
    color: colors.background,
  },
  securitySummary: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  settingField: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  settingLabel: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  settingsListCard: {
    gap: 12,
    paddingBottom: 4,
  },
  settingsLoadingRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    paddingVertical: 9,
  },
  settingsRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    paddingVertical: 9,
  },
  settingsRowDetail: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
  },
  settingsRowGroup: {
    gap: 0,
  },
  settingsRowIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  settingsRowLast: {
    borderBottomWidth: 0,
  },
  settingsRowMain: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  settingsRowTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "900",
  },
  inlineActionRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  inlineActionCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  summaryItem: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  summaryLabel: {
    color: colors.cyan,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  summaryMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
  },
  compactStatusRow: {
    alignItems: "center",
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  flexOne: {
    flex: 1,
  },
  rowHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  summaryStrip: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  summaryValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  suggestionMenu: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 2,
    padding: 8,
  },
  suggestionMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
  },
  suggestionRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    paddingVertical: 7,
  },
  suggestionTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900",
  },
  switchRow: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
  },
  textArea: {
    minHeight: 132,
  },
  textAreaSmall: {
    minHeight: 86,
  },
  tagControl: {
    gap: 7,
  },
  tagInputBox: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 48,
    padding: 8,
  },
  tagPill: {
    alignItems: "center",
    backgroundColor: "rgba(81, 229, 255, 0.09)",
    borderColor: "rgba(81, 229, 255, 0.34)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
    minHeight: 30,
    paddingLeft: 10,
    paddingRight: 7,
  },
  tagPillList: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  tagPillText: {
    color: colors.text,
    flexShrink: 1,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "900",
  },
  tagRemoveButton: {
    alignItems: "center",
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  tagTextInput: {
    color: colors.text,
    flexGrow: 1,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "800",
    minHeight: 32,
    minWidth: 128,
    padding: 0,
  },
  toolSkeletonList: {
    gap: 8,
  },
  twoColumn: {
    flexDirection: "row",
    gap: 10,
  },
  usageHero: {
    backgroundColor: colors.surfaceSoft,
    borderColor: "rgba(236, 54, 141, 0.28)",
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 5,
    padding: 14,
  },
  usageLabel: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  usageValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 34,
  },
});
