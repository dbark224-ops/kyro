export const VAPI_EXTERNAL_CALLER_REFUSAL =
  "I'm sorry, I can't help with that over this phone line. If you're part of the business, please use the Kyro app.";

type VapiToolAuthorizationInput = {
  callerRole?: string | null;
  purpose?: string | null;
  source?: string | null;
  toolName?: string | null;
};

export type VapiToolAuthorization = {
  allowed: boolean;
  trustedInternal: boolean;
};

function normalized(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function resolveVapiToolAuthorization(
  input: VapiToolAuthorizationInput,
): VapiToolAuthorization {
  const trustedInternal =
    normalized(input.callerRole) === "internal_user" ||
    normalized(input.purpose) === "inbound_user" ||
    normalized(input.source) === "kyro.vapi_internal_voice";

  if (trustedInternal) {
    return { allowed: true, trustedInternal: true };
  }

  return {
    allowed: ["kyro_record_call_note", "kyro_request_booking"].includes(
      normalized(input.toolName),
    ),
    trustedInternal: false,
  };
}
