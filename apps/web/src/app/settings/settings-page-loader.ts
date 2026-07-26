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
  mock?: string;
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

/**
 * Let one section's data fail without taking the Settings page with it.
 *
 * Every load below is already scoped to the section being viewed, but they all
 * ran inside a single Promise.all, which rejects as soon as any one of them
 * does. So a Twilio outage did not just break the Twilio card -- it blanked the
 * whole page, and you could not reach your business hours either.
 *
 * A failure now resolves to the same value the load produces when it is not
 * needed, so the section renders in its empty state while the rest of the page
 * works. The failure is logged rather than swallowed: degrading quietly for the
 * user is the point, degrading invisibly for the operator is not.
 */
function optionalLoad<T>(
  label: string,
  workspaceId: string,
  load: Promise<T>,
  fallback: T,
): Promise<T> {
  return load.catch((error: unknown) => {
    console.warn("Settings section data failed to load", {
      error: error instanceof Error ? error.message : "unknown_error",
      section: label,
      workspaceId,
    });

    return fallback;
  });
}

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
  const needsDeveloperMockInquiries =
    selectedSection === "developer" &&
    selectedPanel === "mock-inquiries" &&
    isDeveloperAccount;
  const needsDeveloperOperationalSettings =
    selectedSection === "developer" &&
    selectedPanel !== "mock-inquiries" &&
    isDeveloperAccount;
  const needsPhoneSettings =
    selectedSection === "integrations" &&
    activeIntegrationPanel === "phone-sms";
  const needsInboundInquirySettings =
    selectedSection === "integrations" &&
    activeIntegrationPanel === "inbound-inquiry-handling";
  const needsGeneralSettings =
    selectedSection === "general" ||
    selectedSection === "usage" ||
    selectedSection === "calendar" ||
    selectedSection === "notifications" ||
    needsDeveloperOperationalSettings ||
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
    ? optionalLoad("general settings", workspace.id, getWorkspaceGeneralSettings(supabase, workspace.id), null)
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
    developerMockEmailConnectionResult,
  ] = await Promise.all([
    needsCommunicationSettings
      ? optionalLoad(
          "communication settings",
          workspace.id,
          getCommunicationSettings(supabase, workspace.id),
          null,
        )
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
      ? optionalLoad(
          "calendar settings",
          workspace.id,
          getCalendarSettings(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    generalSettingsPromise,
    needsEmailProviderOverview
      ? optionalLoad(
          "google integration",
          workspace.id,
          getGoogleIntegrationOverview(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    needsEmailProviderOverview
      ? optionalLoad(
          "microsoft integration",
          workspace.id,
          getMicrosoftIntegrationOverview(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "integrations" &&
    activeIntegrationPanel === "inbound-email"
      ? optionalLoad(
          "inbound email settings",
          workspace.id,
          getInboundEmailSettings(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "integrations" &&
    activeIntegrationPanel === "inbound-email"
      ? optionalLoad(
          "inbound email summary",
          workspace.id,
          getInboundEmailOperationalSummary(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "notifications"
      ? optionalLoad(
          "notification settings",
          workspace.id,
          getNotificationSettings(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    needsPhoneSettings
      ? optionalLoad(
          "twilio telephony",
          workspace.id,
          getTwilioTelephonyOverview(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "integrations" && activeIntegrationPanel === "stripe"
      ? optionalLoad(
          "stripe payments",
          workspace.id,
          getWorkspaceStripePaymentOverview(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "integrations" && activeIntegrationPanel === "stripe"
      ? optionalLoad(
          "document templates",
          workspace.id,
          getDocumentTemplateSettings(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "voice" && selectedPanel === "pronunciation"
      ? optionalLoad(
          "pronunciation entries",
          workspace.id,
          getPronunciationEntries(supabase, workspace.id),
          [],
        )
      : Promise.resolve([]),
    needsAssignedPhoneNumbers
      ? optionalLoad(
          "assigned phone numbers",
          workspace.id,
          getWorkspaceAssignedPhoneNumbers(supabase, workspace.id),
          [],
        )
      : Promise.resolve([]),
    selectedSection === "usage"
      ? optionalLoad(
          "usage report",
          workspace.id,
          getUsageReport(supabase, workspace.id, activeWindow),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "voice" ||
    needsInboundInquirySettings ||
    needsDeveloperOperationalSettings ||
    needsPhoneSettings
      ? optionalLoad(
          "voice settings",
          workspace.id,
          getVoiceSettings(supabase, workspace.id),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "usage"
      ? optionalLoad(
          "kyro billing overview",
          workspace.id,
          getKyroUserBillingOverview(getServiceSupabase(), workspace.id),
          null,
        )
      : Promise.resolve(null),
    selectedSection === "usage" || needsDeveloperOperationalSettings
      ? optionalLoad(
          "billing engine overview",
          workspace.id,
          getKyroBillingEngineOverview(getServiceSupabase(), workspace.id),
          null,
        )
      : Promise.resolve(null),
    needsDeveloperOperationalSettings
      ? optionalLoad(
          "dashboard tutorial state",
          workspace.id,
          getDashboardTutorialState(supabase, workspace.id),
          { forceShow: false },
        )
      : Promise.resolve({ forceShow: false }),
    needsDeveloperMockInquiries
      ? supabase
          .from("integration_connections")
          .select("id,provider,account_email")
          .eq("workspace_id", workspace.id)
          .eq("status", "connected")
          .in("provider", ["google", "microsoft"])
          .order("last_connected_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const developerMockEmailConnections = (
    developerMockEmailConnectionResult.data ?? []
  )
    .filter(
      (connection) =>
        connection.provider === "google" || connection.provider === "microsoft",
    )
    .map((connection) => ({
      accountEmail: connection.account_email,
      id: String(connection.id),
      provider: connection.provider as "google" | "microsoft",
    }));

  return {
    activeIntegrationPanel,
    activeWindow,
    assignedPhoneNumbers,
    availablePhoneNumbers,
    calendarSettings,
    communicationSettings,
    dashboardTutorialState,
    developerMockEmailConnections,
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
