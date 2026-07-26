import {
} from "../shared";
import {
  DeveloperMockInquiryForms,
  type DeveloperMockMode,
} from "../../developer/mock-inquiry-forms";
import {
} from "../../../lib/assistant/voice-settings";
import {
} from "../../../lib/workspace/general-settings";
import {
  type WorkspacePhoneNumberPoolRow,
} from "../../../lib/voice/phone-number-pool";
/**
 * The developer mock-inquiry section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function DeveloperMockInquirySettingsDetail({
  assignedPhoneNumbers,
  emailConnections,
  initialMode,
}: Readonly<{
  assignedPhoneNumbers: WorkspacePhoneNumberPoolRow[];
  emailConnections: Array<{
    accountEmail: string | null;
    id: string;
    provider: "google" | "microsoft";
  }>;
  initialMode: DeveloperMockMode;
}>) {
  const phoneNumbers = assignedPhoneNumbers
    .filter((number) => number.status === "active")
    .map((number) => ({
      friendlyName: number.friendlyName,
      id: number.id,
      phoneNumber: number.phoneNumber,
    }));
  const redirectBase = "/settings?section=developer&panel=mock-inquiries";

  return (
    <div className="settings-form">
      <article className="panel embedded-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inbound testing</p>
            <h2>Mock inquiry</h2>
          </div>
          <span className="pill">Developer only</span>
        </div>
        <DeveloperMockInquiryForms
          emailConnections={emailConnections}
          initialMode={initialMode}
          phoneNumbers={phoneNumbers}
          redirectPaths={{
            email: `${redirectBase}&mock=email`,
            manual: `${redirectBase}&mock=manual`,
            sms: `${redirectBase}&mock=sms`,
          }}
          submissionKeys={{
            email: crypto.randomUUID(),
            manual: crypto.randomUUID(),
            sms: crypto.randomUUID(),
          }}
        />
      </article>
    </div>
  );
}
