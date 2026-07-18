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
  voicemailGreeting: string;
};

type VapiWorkplaceContact = {
  name?: string | null;
  phoneNumber?: string | null;
  privatePhoneNumber?: string | null;
  role?: string | null;
  tradeSpecialty?: string | null;
};

function normalizedPhone(value: string | null | undefined) {
  return normalizeContactPhoneForRegion(value, null);
}

export function buildVapiInternalNumberDetails(input: {
  voiceNumberDetails: PhoneAgentUserNumberDetail[];
  voiceNumbers: string[];
  workplaceContacts: VapiWorkplaceContact[];
}) {
  const rows: PhoneAgentUserNumberDetail[] = [];
  const seen = new Set<string>();
  const add = (
    phoneNumber: string | null | undefined,
    name: string | null | undefined,
    role: string | null | undefined,
  ) => {
    const cleanPhone = phoneNumber?.trim() ?? "";
    const identity = normalizedPhone(cleanPhone) ?? cleanPhone;

    if (!cleanPhone || !identity || seen.has(identity)) {
      return;
    }

    seen.add(identity);
    rows.push({
      name: name?.trim() || null,
      phoneNumber: cleanPhone,
      role: role?.trim() || null,
    });
  };

  for (const contact of input.workplaceContacts) {
    const role = contact.role || contact.tradeSpecialty;
    add(contact.phoneNumber, contact.name, role);
    add(contact.privatePhoneNumber, contact.name, role);
  }

  for (const detail of input.voiceNumberDetails) {
    add(detail.phoneNumber, detail.name, detail.role);
  }

  for (const phoneNumber of input.voiceNumbers) {
    add(phoneNumber, null, null);
  }

  return rows;
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

function voicemailGreeting(businessName: string, firstName: string) {
  return firstName
    ? `Hey ${firstName}, you've reached ${businessName}. No one was able to answer, but I can help or take a message.`
    : `Hi, you've reached ${businessName}. You're speaking with Kyro. No one was able to answer, but I can help or take a message.`;
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
    voicemailGreeting: voicemailGreeting(input.businessName, firstName),
  };
}
