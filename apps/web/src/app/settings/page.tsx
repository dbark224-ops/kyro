import {
  developerMockMode,
  displayUserFirstName,
  displayUserLastName,
  integrationStatusLabel,
  workplaceContactsWithVoiceNumbers,
} from "./shared";
import { AppFrame } from "../components/app-frame";
import {
} from "./actions";
import {
} from "../../lib/assistant/voice-settings";
import {
} from "../../lib/assistant/pronunciation";
import {
} from "../../lib/communication/settings";
import {
} from "../../lib/billing/display-currency";
import {
} from "../../lib/usage/queries";
import {
} from "../../lib/integrations/google";
import {
} from "../../lib/integrations/inbound-email-settings";
import {
} from "../../lib/integrations/microsoft";
import {
} from "../../lib/calendar/settings";
import {
} from "../../lib/notifications/settings";
import { isKyroEmailVerified } from "../../lib/auth/email-verification";
import {
  quoteTemplateCatalog,
} from "../../lib/documents/templates";
import {
  DEFAULT_WORKSPACE_GENERAL_SETTINGS,
} from "../../lib/workspace/general-settings";
import {
} from "../../lib/workspace/operating-countries";
import { SettingsShell } from "./settings-shell";
import {
} from "./settings-navigation";
import {
  buildSettingsMenuItems,
  buildSettingsNestedItems,
} from "./settings-menu";
import {
  loadSettingsPageData,
  type SettingsPageQuery,
} from "./settings-page-loader";
import {
} from "../developer/mock-inquiry-forms";
import {
} from "./shared";
import { CalendarSettingsDetail } from "./sections/calendar-settings";
import { DeveloperMockInquirySettingsDetail } from "./sections/developer-mock-inquiry";
import { DeveloperSettingsDetail } from "./sections/developer-settings";
import { GeneralSettingsDetail } from "./sections/general-settings";
import { EmptySettingsDetail } from "./sections/empty-settings";
import { WorkspaceIntegrationsSettings } from "./sections/workspace-integrations";
import { VoiceSettingsDetail } from "./sections/voice-settings";
import { KyroBillingSettingsDetail } from "./sections/kyro-billing-settings";
import { NotificationSettingsDetail } from "./sections/notification-settings";
import { UsageSettingsDetail } from "./sections/usage-settings";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams?: Promise<SettingsPageQuery>;
};

function SettingsDetailShell({
  children,
  eyebrow,
  title,
}: Readonly<{
  children: React.ReactNode;
  eyebrow: string;
  title: string;
}>) {
  return (
    <section className="panel settings-detail-panel">
      <header className="assistant-preview-header settings-detail-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </header>
      <div className="settings-detail-body">{children}</div>
    </section>
  );
}

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const {
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
    usageReport,
    user,
    voiceSettings,
    workspace,
  } = await loadSettingsPageData(searchParams);
  const documentTemplates = documentTemplateSettings
    ? quoteTemplateCatalog(documentTemplateSettings.customTemplates)
    : [];
  const defaultInvoiceTemplateKey =
    documentTemplateSettings?.defaultInvoiceTemplateKey ??
    documentTemplates.find((template) => /invoice/i.test(template.label))
      ?.key ??
    documentTemplates[0]?.key ??
    null;
  const googleStatus = googleOverview
    ? integrationStatusLabel(googleOverview)
    : "Open";
  const microsoftStatus = microsoftOverview
    ? integrationStatusLabel(microsoftOverview)
    : "Open";
  const settingsItems = buildSettingsMenuItems({
    activeWindow,
    generalSettings,
    isDeveloperAccount,
    usageReport,
    voiceSettings,
  });
  const nestedItems = buildSettingsNestedItems({
    activeIntegrationPanel,
    activeWindow,
    selectedPanel,
    selectedSection,
  });
  const selectedNestedTitle =
    nestedItems.find((item) => item.selected)?.title ?? null;
  const selectedDetail =
    selectedSection === "general" && generalSettings ? (
      <SettingsDetailShell
        eyebrow="Profile"
        title={selectedNestedTitle ?? "Business profile"}
      >
        <GeneralSettingsDetail
          activePanel={selectedPanel}
          communicationSettings={communicationSettings}
          emailVerified={isKyroEmailVerified(user)}
          operationalPhoneNumbers={assignedPhoneNumbers}
          settings={generalSettings}
          userEmail={user.email ?? ""}
          userFirstName={displayUserFirstName(user)}
          userLastName={displayUserLastName(user)}
          workspaceName={workspace.name}
        />
      </SettingsDetailShell>
    ) : selectedSection === "integrations" ? (
      <SettingsDetailShell
        eyebrow="Integrations"
        title={selectedNestedTitle ?? "Connected accounts"}
      >
        <WorkspaceIntegrationsSettings
          activePanel={activeIntegrationPanel}
          communicationSettings={communicationSettings}
          defaultInvoiceTemplateKey={defaultInvoiceTemplateKey}
          documentTemplates={documentTemplates}
          googleOverview={googleOverview}
          googleStatus={googleStatus}
          inboundEmailSettings={inboundEmailSettings}
          inboundEmailSummary={inboundEmailSummary}
          microsoftOverview={microsoftOverview}
          microsoftStatus={microsoftStatus}
          settingsFocus={settingsFocus}
          showInboundTrace={showInboundTrace}
          showSenderRules={showSenderRules}
          availablePhoneNumbers={availablePhoneNumbers}
          generalSettings={generalSettings}
          stripeOverview={stripeOverview}
          twilioOverview={twilioOverview}
          voiceSettings={voiceSettings}
          workspaceName={workspace.name}
        />
      </SettingsDetailShell>
    ) : selectedSection === "calendar" &&
      calendarSettings &&
      generalSettings ? (
      <SettingsDetailShell
        eyebrow="Calendar"
        title={selectedNestedTitle ?? "Calendar"}
      >
        <CalendarSettingsDetail
          activePanel={selectedPanel}
          googleOverview={googleOverview}
          microsoftOverview={microsoftOverview}
          settings={calendarSettings}
          timeZone={generalSettings.timeZone}
        />
      </SettingsDetailShell>
    ) : selectedSection === "notifications" &&
      notificationSettings &&
      generalSettings ? (
      <SettingsDetailShell
        eyebrow="Notifications"
        title={selectedNestedTitle ?? "Notifications"}
      >
        <NotificationSettingsDetail
          generalSettings={generalSettings}
          settings={notificationSettings}
        />
      </SettingsDetailShell>
    ) : selectedSection === "usage" &&
      usageReport &&
      generalSettings &&
      kyroBillingOverview &&
      kyroBillingEngineOverview ? (
      <SettingsDetailShell
        eyebrow="Usage"
        title={selectedNestedTitle ?? "Usage and billing"}
      >
        {selectedPanel === "payment-method" ? (
          <KyroBillingSettingsDetail
            billingEngineOverview={kyroBillingEngineOverview}
            billingOverview={kyroBillingOverview}
          />
        ) : (
          <UsageSettingsDetail
            activeWindow={activeWindow}
            displayCurrencySettings={generalSettings}
            usageReport={usageReport}
          />
        )}
      </SettingsDetailShell>
    ) : selectedSection === "voice" && voiceSettings ? (
      <SettingsDetailShell
        eyebrow="Voice"
        title={selectedNestedTitle ?? "Voice assistant"}
      >
        <VoiceSettingsDetail
          activePanel={selectedPanel}
          assignedPhoneNumbers={assignedPhoneNumbers}
          businessWorkingHoursSchedule={
            generalSettings?.businessProfile.workingHoursSchedule ??
            DEFAULT_WORKSPACE_GENERAL_SETTINGS.businessProfile
              .workingHoursSchedule
          }
          defaultPhoneRegion={
            generalSettings?.defaultPhoneRegion ??
            DEFAULT_WORKSPACE_GENERAL_SETTINGS.defaultPhoneRegion
          }
          pronunciationEntries={pronunciationEntries}
          userEmail={user.email ?? ""}
          workplaceContacts={workplaceContactsWithVoiceNumbers(
            generalSettings?.businessProfile.workplaceContacts ?? [],
            voiceSettings,
          )}
          voiceSettings={voiceSettings}
        />
      </SettingsDetailShell>
    ) : selectedSection === "developer" &&
      selectedPanel === "mock-inquiries" &&
      isDeveloperAccount ? (
      <SettingsDetailShell
        eyebrow="Developer"
        title={selectedNestedTitle ?? "Mock inquiries"}
      >
        <DeveloperMockInquirySettingsDetail
          assignedPhoneNumbers={assignedPhoneNumbers}
          emailConnections={developerMockEmailConnections}
          initialMode={developerMockMode(query?.mock)}
        />
      </SettingsDetailShell>
    ) : selectedSection === "developer" &&
      isDeveloperAccount &&
      generalSettings &&
      voiceSettings &&
      kyroBillingEngineOverview ? (
      <SettingsDetailShell
        eyebrow="Developer"
        title={selectedNestedTitle ?? "Developer settings"}
      >
        <DeveloperSettingsDetail
          assignedPhoneNumbers={assignedPhoneNumbers}
          billingEngineOverview={kyroBillingEngineOverview}
          dashboardTutorialForceShow={dashboardTutorialState.forceShow}
          generalSettings={generalSettings}
          voiceSettings={voiceSettings}
        />
      </SettingsDetailShell>
    ) : null;

  return (
    <AppFrame active="Settings">
      <header className="topbar settings-topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Settings</h1>
        </div>
      </header>

      {query?.engine_error ? (
        <p className="form-alert error">{query.engine_error}</p>
      ) : null}
      {query?.engine_message ? (
        <p className="form-alert">{query.engine_message}</p>
      ) : null}

      <SettingsShell
        detail={selectedDetail}
        empty={<EmptySettingsDetail />}
        items={settingsItems}
        nestedItems={nestedItems}
        selectedSection={selectedSection}
      />
    </AppFrame>
  );
}
