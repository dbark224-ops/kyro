import { getVoiceSettings } from "../../lib/assistant/voice-settings";
import { getPronunciationEntries } from "../../lib/assistant/pronunciation";
import { developerAccessEnabled } from "../../lib/auth/developer-access";
import { getKyroBillingEngineOverview } from "../../lib/billing/kyro-billing-engine";
import { getKyroUserBillingOverview } from "../../lib/billing/kyro-user-billing";
import { getCalendarSettings } from "../../lib/calendar/settings";
import { getCommunicationSettings } from "../../lib/communication/settings";
import { getDocumentTemplateSettings } from "../../lib/documents/settings";
import { getGoogleIntegrationOverview } from "../../lib/integrations/google";
import {
  getInboundEmailOperationalSummary,
  getInboundEmailSettings,
} from "../../lib/integrations/inbound-email-settings";
import { getMicrosoftIntegrationOverview } from "../../lib/integrations/microsoft";
import { getNotificationSettings } from "../../lib/notifications/settings";
import { getTwilioTelephonyOverview } from "../../lib/integrations/twilio";
import { getWorkspaceStripePaymentOverview } from "../../lib/payments/accounts";
import { createServiceSupabaseClient } from "../../lib/supabase/service";
import { getUsageReport, normalizeUsageWindow } from "../../lib/usage/queries";
import { requireWorkspaceContext } from "../../lib/workspace/context";
import { getWorkspaceGeneralSettings } from "../../lib/workspace/general-settings";
import { operatingCountryPhoneRegion } from "../../lib/workspace/operating-countries";
import {
  getAvailableWorkspacePhoneNumbersFromPool,
  getWorkspaceAssignedPhoneNumbers,
} from "../../lib/voice/phone-number-pool";
import {
  defaultSettingsPanel,
  normalizeIntegrationPanel,
  normalizeSettingsSection,
} from "./settings-navigation";

export type SettingsPageQuery = {
  engine_error?: string;
  engine_message?: string;
  focus?: string;
  inboundTrace?: string;
  panel?: string;
  section?: string;
  senderRules?: string;
  window?: string;
};

type DashboardTutorialStateRow = {
  dashboard_tour_force_show: boolean | null;
};

type DashboardTutorialStateSupabaseClient = {
  from(table: "workspace_tutorial_state"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{
          data: DashboardTutorialStateRow | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

async function getDashboardTutorialState(
  supabase: unknown,
  workspaceId: string,
) {
  const tutorialSupabase = supabase as DashboardTutorialStateSupabaseClient;
  const { data, error } = await tutorialSupabase
    .from("workspace_tutorial_state")
    .select("dashboard_tour_force_show")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    return { forceShow: false };
  }

  return { forceShow: Boolean(data?.dashboard_tour_force_show) };
}

export async function loadSettingsPageData(
  searchParams?: Promise<SettingsPageQuery>,
) {
  const [query, { supabase, user, workspace }] = await Promise.all([
    searchParams,
    requireWorkspaceContext(),
  ]);
  const activeWindow = normalizeUsageWindow(query?.window);
  const isDeveloperAccount = developerAccessEnabled(user);
  const normalizedSection = normalizeSettingsSection(query?.section);
  const selectedSection =
    normalizedSection === "developer" && !isDeveloperAccount
      ? null
      : normalizedSection;
  const requestedPanel =
    query?.panel ?? defaultSettingsPanel(selectedSection) ?? "";
  const selectedPanel =
    selectedSection === "usage" && requestedPanel === "ledger"
      ? "usage-summary"
      : requestedPanel;
  const activeIntegrationPanel = normalizeIntegrationPanel(
    selectedSection === "integrations" ? selectedPanel : null,
  );
  const showInboundTrace =
    selectedSection === "integrations" && query?.inboundTrace === "1";
  const showSenderRules =
    selectedSection === "integrations" && query?.senderRules === "1";
  const settingsFocus = typeof query?.focus === "string" ? query.focus : null;
  const needsPhoneSettings =
    selectedSection === "integrations" &&
    activeIntegrationPanel === "phone-sms";
  const needsGeneralSettings =
    selectedSection === "general" ||
    selectedSection === "usage" ||
    selectedSection === "calendar" ||
    selectedSection === "notifications" ||
    (selectedSection === "developer" && isDeveloperAccount) ||
    needsPhoneSettings;
  const needsCommunicationSettings =
    (selectedSection === "general" && selectedPanel === "email-signature") ||
    (selectedSection === "integrations" &&
      activeIntegrationPanel === "outbound");
  const needsEmailProviderOverview =
    (selectedSection === "integrations" &&
      (activeIntegrationPanel === "inbound-email" ||
        activeIntegrationPanel === "email-accounts" ||
        activeIntegrationPanel === "google" ||
        activeIntegrationPanel === "microsoft")) ||
    selectedSection === "calendar";
  const needsAssignedPhoneNumbers =
    (selectedSection === "general" && selectedPanel === "public-details") ||
    (selectedSection === "voice" && selectedPanel === "voicemail-overflow") ||
    (selectedSection === "developer" && isDeveloperAccount);
  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient> | null =
    null;
  const getServiceSupabase = () => {
    serviceSupabase ??= createServiceSupabaseClient();

    return serviceSupabase;
  };
  const generalSettingsPromise = needsGeneralSettings
    ? getWorkspaceGeneralSettings(supabase, workspace.id)
    : Promise.resolve(null);

  const [
    communicationSettings,
    availablePhoneNumbers,
    calendarSettings,
    generalSettings,
    googleOverview,
    microsoftOverview,
    inboundEmailSettings,
    inboundEmailSummary,
    notificationSettings,
    twilioOverview,
    stripeOverview,
    documentTemplateSettings,
    pronunciationEntries,
    assignedPhoneNumbers,
    usageReport,
    voiceSettings,
    kyroBillingOverview,
    kyroBillingEngineOverview,
    dashboardTutorialState,
  ] = await Promise.all([
    needsCommunicationSettings
      ? getCommunicationSettings(supabase, workspace.id)
      : Promise.resolve(null),
    needsPhoneSettings
      ? generalSettingsPromise
          .then((settings) =>
            settings
              ? getAvailableWorkspacePhoneNumbersFromPool(
                  getServiceSupabase(),
                  operatingCountryPhoneRegion(
                    settings.businessProfile.operatingCountry,
                  ) ?? settings.defaultPhoneRegion,
                )
              : [],
          )
          .catch(() => [])
      : Promise.resolve([]),
    selectedSection === "calendar"
      ? getCalendarSettings(supabase, workspace.id)
      : Promise.resolve(null),
    generalSettingsPromise,
    needsEmailProviderOverview
      ? getGoogleIntegrationOverview(supabase, workspace.id)
      : Promise.resolve(null),
    needsEmailProviderOverview
      ? getMicrosoftIntegrationOverview(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "integrations" &&
    activeIntegrationPanel === "inbound-email"
      ? getInboundEmailSettings(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "integrations" &&
    activeIntegrationPanel === "inbound-email"
      ? getInboundEmailOperationalSummary(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "notifications"
      ? getNotificationSettings(supabase, workspace.id)
      : Promise.resolve(null),
    needsPhoneSettings
      ? getTwilioTelephonyOverview(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "integrations" && activeIntegrationPanel === "stripe"
      ? getWorkspaceStripePaymentOverview(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "integrations" && activeIntegrationPanel === "stripe"
      ? getDocumentTemplateSettings(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "voice" && selectedPanel === "pronunciation"
      ? getPronunciationEntries(supabase, workspace.id)
      : Promise.resolve([]),
    needsAssignedPhoneNumbers
      ? getWorkspaceAssignedPhoneNumbers(supabase, workspace.id)
      : Promise.resolve([]),
    selectedSection === "usage"
      ? getUsageReport(supabase, workspace.id, activeWindow)
      : Promise.resolve(null),
    selectedSection === "voice" ||
    selectedSection === "developer" ||
    needsPhoneSettings
      ? getVoiceSettings(supabase, workspace.id)
      : Promise.resolve(null),
    selectedSection === "usage"
      ? getKyroUserBillingOverview(getServiceSupabase(), workspace.id)
      : Promise.resolve(null),
    selectedSection === "usage" || selectedSection === "developer"
      ? getKyroBillingEngineOverview(getServiceSupabase(), workspace.id)
      : Promise.resolve(null),
    selectedSection === "developer" && isDeveloperAccount
      ? getDashboardTutorialState(supabase, workspace.id)
      : Promise.resolve({ forceShow: false }),
  ]);

  return {
    activeIntegrationPanel,
    activeWindow,
    assignedPhoneNumbers,
    availablePhoneNumbers,
    calendarSettings,
    communicationSettings,
    dashboardTutorialState,
    documentTemplateSettings,
    generalSettings,
    googleOverview,
    inboundEmailSettings,
    inboundEmailSummary,
    isDeveloperAccount,
    kyroBillingEngineOverview,
    kyroBillingOverview,
    microsoftOverview,
    notificationSettings,
    pronunciationEntries,
    query,
    selectedPanel,
    selectedSection,
    settingsFocus,
    showInboundTrace,
    showSenderRules,
    stripeOverview,
    twilioOverview,
    user,
    usageReport,
    voiceSettings,
    workspace,
  };
}
