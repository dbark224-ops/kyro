import { normalizeContactPhoneForRegion } from "../crm/identity";
import type { PhoneAgentUserNumberDetail } from "./voice-settings";
import type { VapiUserIdentity } from "./vapi-user-context";

export type VapiInboundCrmContact = {
  company: string | null;
  contactType: string | null;
  id: string;
  name: string | null;
};

export type VapiCallerRecognition = {
  company: string;
  contactId: string | null;
  contactType: string | null;
  firstName: string;
  greeting: string;
  kind: "crm_contact" | "internal_user" | "unknown";
  name: string;
  recognized: boolean;
};

function normalizedPhone(value: string | null | undefined) {
  return normalizeContactPhoneForRegion(value, null);
}

function usableFirstName(value: string | null | undefined) {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";

  if (
    !clean ||
    clean.includes("@") ||
    !/[A-Za-z]/.test(clean) ||
    ["caller", "customer", "unknown", "unknown caller"].includes(
      clean.toLowerCase(),
    )
  ) {
    return "";
  }

  return clean.split(" ")[0]?.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "") ?? "";
}

function matchingInternalNumberDetail(
  callerNumber: string | null,
  details: PhoneAgentUserNumberDetail[],
) {
  const caller = normalizedPhone(callerNumber);

  if (!caller) {
    return null;
  }

  return (
    details.find((entry) => normalizedPhone(entry.phoneNumber) === caller) ??
    null
  );
}

function callerMatchesUserIdentity(
  callerNumber: string | null,
  userIdentity: VapiUserIdentity,
) {
  const caller = normalizedPhone(callerNumber);
  const userPhone = normalizedPhone(userIdentity.phone);

  return Boolean(caller && userPhone && caller === userPhone);
}

function genericGreeting(businessName: string) {
  return `Hi, this is ${businessName}. You're speaking with Kyro!`;
}

export function buildVapiCallerRecognition(input: {
  businessName: string;
  callerNumber: string | null;
  crmContact: VapiInboundCrmContact | null;
  internalCaller: boolean;
  internalNumberDetails: PhoneAgentUserNumberDetail[];
  userIdentity: VapiUserIdentity;
}): VapiCallerRecognition {
  const internalDetail = matchingInternalNumberDetail(
    input.callerNumber,
    input.internalNumberDetails,
  );
  const internalName = internalDetail?.name?.trim() ?? "";
  const accountUserName = callerMatchesUserIdentity(
    input.callerNumber,
    input.userIdentity,
  )
    ? input.userIdentity.name
    : "";
  const name = input.internalCaller
    ? internalName || accountUserName || input.crmContact?.name?.trim() || ""
    : (input.crmContact?.name?.trim() ?? "");
  const firstName = usableFirstName(name);
  const kind = input.internalCaller
    ? "internal_user"
    : input.crmContact
      ? "crm_contact"
      : "unknown";

  return {
    company: input.crmContact?.company ?? "",
    contactId: input.crmContact?.id ?? null,
    contactType: input.crmContact?.contactType ?? null,
    firstName,
    greeting: firstName
      ? `Hey ${firstName}`
      : genericGreeting(input.businessName),
    kind,
    name,
    recognized: kind !== "unknown",
  };
}
