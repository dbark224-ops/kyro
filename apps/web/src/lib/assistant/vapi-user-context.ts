import type { SupabaseClient, User } from "@supabase/supabase-js";

export type VapiUserIdentity = {
  email: string;
  id: string;
  name: string;
  phone: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value);

    if (text) {
      return text;
    }
  }

  return "";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function emailName(value: string) {
  const localPart = value.split("@")[0]?.trim();

  return localPart ? localPart.replace(/[._-]+/g, " ") : "";
}

export function vapiUserIdentityFromUser(user: User): VapiUserIdentity {
  const metadata = objectRecord(user.user_metadata);
  const email = textValue(user.email);
  const name =
    firstText(
      metadata.name,
      metadata.full_name,
      metadata.fullName,
      metadata.display_name,
      metadata.displayName,
    ) || emailName(email);
  const phone = firstText(
    user.phone,
    metadata.kyroMobileNumber,
    metadata.phone,
    metadata.mobileNumber,
    metadata.mobile,
    metadata.publicPhoneNumber,
  );

  return {
    email,
    id: user.id,
    name,
    phone,
  };
}

export async function loadVapiUserIdentity(
  supabase: SupabaseClient,
  userId: string | null | undefined,
) {
  const cleanUserId = textValue(userId);

  if (!cleanUserId) {
    return emptyVapiUserIdentity();
  }

  const profilePromise = (async () => {
    try {
      const { data } = await supabase
        .from("users")
        .select("id,name,email")
        .eq("id", cleanUserId)
        .maybeSingle();

      return data;
    } catch {
      return null;
    }
  })();
  const authPromise = supabase.auth.admin
    .getUserById(cleanUserId)
    .catch(() => ({ data: { user: null } }));
  const [profile, authResult] = await Promise.all([
    profilePromise,
    authPromise,
  ]);
  const authUser = authResult.data.user;
  const authIdentity = authUser ? vapiUserIdentityFromUser(authUser) : null;
  const profileRecord = objectRecord(profile);
  const email = firstText(profileRecord.email, authIdentity?.email);
  const name =
    firstText(profileRecord.name, authIdentity?.name) || emailName(email);

  return {
    email,
    id: cleanUserId,
    name,
    phone: authIdentity?.phone ?? "",
  } satisfies VapiUserIdentity;
}

export function emptyVapiUserIdentity(): VapiUserIdentity {
  return {
    email: "",
    id: "",
    name: "",
    phone: "",
  };
}

export function vapiUserVariableValues(identity: VapiUserIdentity) {
  return {
    kyro_user_email: identity.email,
    kyro_user_id: identity.id,
    kyro_user_name: identity.name,
    kyro_user_phone: identity.phone,
    user_email: identity.email,
    user_name: identity.name,
    user_phone: identity.phone,
  };
}

export function vapiUserContextLine(
  identity: VapiUserIdentity,
  label = "Kyro account user",
) {
  const parts = [
    identity.name ? `name ${identity.name}` : null,
    identity.email ? `email ${identity.email}` : null,
    identity.phone ? `phone ${identity.phone}` : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    return `${label}: no account contact details are available.`;
  }

  return `${label}: ${parts.join("; ")}.`;
}
