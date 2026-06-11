import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AddressColumnUpdates } from "../addresses/types";
import { runStubAiTriage } from "../ai/triage";
import { normalizeContactType } from "../crm/contact-types";
import {
  normalizeCompanyName,
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "../crm/identity";
import { insertAuditLog } from "../engine/event-action-audit";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";

export type ManualInboundInput = {
  submissionKey?: string;
  contactName: string;
  email?: string;
  phone?: string;
  company?: string;
  contactType?: string;
  address?: string;
  addressFields?: AddressColumnUpdates;
  serviceType?: string;
  message: string;
  channel?: {
    displayName: string;
    externalId?: string | null;
    settings?: Record<string, unknown>;
    type: string;
  };
  eventSource?: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
  source?: string;
};

function nullableText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

type ContactCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  normalizedCompany: string | null;
  contactType: string | null;
  address: string | null;
};

type ContactMatchResult = {
  contactId: string;
  match: {
    status: "created" | "attached" | "conflict_created";
    reason: string;
    emailMatchedContactId: string | null;
    phoneMatchedContactId: string | null;
    conflictContactIds: string[];
  };
};

function toContactCandidate(contact: {
  id: unknown;
  name: unknown;
  email: unknown;
  phone: unknown;
  company: unknown;
  normalized_email?: unknown;
  normalized_phone?: unknown;
  normalized_company?: unknown;
  contact_type: unknown;
  address: unknown;
}): ContactCandidate {
  return {
    id: String(contact.id),
    name: contact.name ? String(contact.name) : null,
    email: contact.email ? String(contact.email) : null,
    phone: contact.phone ? String(contact.phone) : null,
    company: contact.company ? String(contact.company) : null,
    normalizedEmail: contact.normalized_email
      ? String(contact.normalized_email)
      : null,
    normalizedPhone: contact.normalized_phone
      ? String(contact.normalized_phone)
      : null,
    normalizedCompany: contact.normalized_company
      ? String(contact.normalized_company)
      : null,
    contactType: contact.contact_type ? String(contact.contact_type) : null,
    address: contact.address ? String(contact.address) : null,
  };
}

function contactReferenceLabel(contact: ContactCandidate) {
  const title =
    contact.name?.trim() ||
    contact.company?.trim() ||
    contact.email?.trim() ||
    contact.phone?.trim() ||
    "Unnamed contact";
  const details = [contact.phone, contact.email].filter(Boolean).join(" - ");

  return details ? `${title} - ${details}` : title;
}

async function profileConflictNote(
  supabase: SupabaseClient,
  workspaceId: string,
  match: ContactMatchResult["match"],
) {
  if (match.status !== "conflict_created") {
    return null;
  }

  const contactIds = Array.from(
    new Set(
      [match.emailMatchedContactId, match.phoneMatchedContactId].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ),
    ),
  );

  if (contactIds.length === 0) {
    return "Potential profile match conflict. Email matched none; phone matched none.";
  }

  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id,name,email,phone,company,normalized_email,normalized_phone,normalized_company,contact_type,address",
    )
    .eq("workspace_id", workspaceId)
    .in("id", contactIds);

  if (error) {
    throw new Error(`Unable to describe profile conflict: ${error.message}`);
  }

  const contactsById = new Map(
    (data ?? []).map((contact) => [
      String(contact.id),
      contactReferenceLabel(toContactCandidate(contact)),
    ]),
  );
  const emailMatch = match.emailMatchedContactId
    ? contactsById.get(match.emailMatchedContactId) ?? "Unknown contact"
    : "none";
  const phoneMatch = match.phoneMatchedContactId
    ? contactsById.get(match.phoneMatchedContactId) ?? "Unknown contact"
    : "none";

  return `Potential profile match conflict. Email matched ${emailMatch}; phone matched ${phoneMatch}.`;
}

async function loadContactCandidatesByIdentity(
  supabase: SupabaseClient,
  workspaceId: string,
  identity: {
    email: string | null;
    phone: string | null;
  },
) {
  const filters = [];

  if (identity.email) {
    filters.push(`normalized_email.eq.${identity.email}`);
  }

  if (identity.phone) {
    filters.push(`normalized_phone.eq.${identity.phone}`);
  }

  if (filters.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id,name,email,phone,company,normalized_email,normalized_phone,normalized_company,contact_type,address",
    )
    .eq("workspace_id", workspaceId)
    .or(filters.join(","))
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Unable to look up contacts: ${error.message}`);
  }

  return (data ?? []).map(toContactCandidate);
}

async function patchMissingContactFields(
  supabase: SupabaseClient,
  workspaceId: string,
  contact: ContactCandidate,
  input: ManualInboundInput,
  defaultPhoneRegion: PhoneRegion,
) {
  const updates: Record<string, unknown> = {};
  const email = normalizeContactEmail(input.email);
  const phone = nullableText(input.phone);
  const normalizedPhone = normalizeContactPhoneForRegion(
    input.phone,
    defaultPhoneRegion,
  );
  const company = nullableText(input.company);
  const normalizedCompany = normalizeCompanyName(input.company);
  const address = nullableText(input.address);
  const addressFields = input.addressFields;
  const contactType = normalizeContactType(input.contactType);

  if (!contact.name && input.contactName.trim()) {
    updates.name = input.contactName.trim();
  }

  if (!contact.email && email) {
    updates.email = email;
    updates.normalized_email = email;
  }

  if (!contact.phone && phone) {
    updates.phone = phone;
    if (normalizedPhone) {
      updates.normalized_phone = normalizedPhone;
    }
  }

  if (!contact.company && company) {
    updates.company = company;
    if (normalizedCompany) {
      updates.normalized_company = normalizedCompany;
    }
  }

  if (!contact.address && address) {
    Object.assign(updates, addressFields ?? { address });
  }

  if (
    (!contact.contactType || contact.contactType === "client") &&
    contactType !== "client"
  ) {
    updates.contact_type = contactType;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  const { error } = await supabase
    .from("contacts")
    .update(updates)
    .eq("workspace_id", workspaceId)
    .eq("id", contact.id);

  if (error) {
    throw new Error(`Unable to update contact profile: ${error.message}`);
  }
}

async function createContactProfile(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string,
  input: ManualInboundInput,
  match: ContactMatchResult["match"],
  defaultPhoneRegion: PhoneRegion,
) {
  const email = normalizeContactEmail(input.email);
  const phone = nullableText(input.phone);
  const normalizedPhone = normalizeContactPhoneForRegion(
    input.phone,
    defaultPhoneRegion,
  );
  const normalizedCompany = normalizeCompanyName(input.company);
  const contactType = normalizeContactType(input.contactType);
  const source = nullableText(input.source) ?? "manual_inbound";
  const tags =
    match.status === "conflict_created"
      ? [source, "profile_match_conflict"]
      : [source];
  const conflictNote = await profileConflictNote(supabase, workspaceId, match);

  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      name: input.contactName,
      email,
      phone,
      normalized_email: email,
      normalized_phone: normalizedPhone,
      company: nullableText(input.company),
      normalized_company: normalizedCompany,
      contact_type: contactType,
      ...(input.addressFields ?? { address: nullableText(input.address) }),
      source,
      notes: conflictNote,
      profile_resolution_status:
        match.status === "conflict_created" ? "needs_review" : "clear",
      profile_resolution_reason:
        match.status === "conflict_created" ? match.reason : null,
      profile_conflict_contact_ids:
        match.status === "conflict_created" ? match.conflictContactIds : [],
      tags,
    })
    .select("id")
    .single();

  if (error || !contact) {
    throw new Error(
      `Unable to create contact: ${error?.message ?? "unknown error"}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action:
      match.status === "conflict_created"
        ? "contact.profile_conflict_created"
        : "contact.created",
    entityType: "contact",
    entityId: String(contact.id),
    after: {
      source,
      email,
      phone,
      normalizedEmail: email,
      normalizedPhone,
      normalizedCompany,
      contactType,
      address: nullableText(input.address),
      structuredAddress: input.addressFields?.address_structured ?? null,
      profileMatch: match,
    },
  });

  return String(contact.id);
}

async function resolveContactProfile(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string,
  input: ManualInboundInput,
  defaultPhoneRegion: PhoneRegion,
): Promise<ContactMatchResult> {
  const email = normalizeContactEmail(input.email);
  const phone = normalizeContactPhoneForRegion(input.phone, defaultPhoneRegion);
  const contacts = await loadContactCandidatesByIdentity(
    supabase,
    workspaceId,
    {
      email,
      phone,
    },
  );
  const emailMatch = email
    ? (contacts.find((contact) => contact.normalizedEmail === email) ?? null)
    : null;
  const phoneMatch = phone
    ? (contacts.find((contact) => contact.normalizedPhone === phone) ?? null)
    : null;
  const baseMatch = {
    emailMatchedContactId: emailMatch?.id ?? null,
    phoneMatchedContactId: phoneMatch?.id ?? null,
  };

  if (
    email &&
    phone &&
    emailMatch &&
    phoneMatch &&
    emailMatch.id !== phoneMatch.id
  ) {
    const match = {
      ...baseMatch,
      conflictContactIds: [emailMatch.id, phoneMatch.id],
      reason: "email_and_phone_match_different_profiles",
      status: "conflict_created" as const,
    };

    return {
      contactId: await createContactProfile(
        supabase,
        user,
        workspaceId,
        input,
        match,
        defaultPhoneRegion,
      ),
      match,
    };
  }

  if (emailMatch) {
    const inputPhoneConflictsWithProfile =
      Boolean(phone) &&
      Boolean(emailMatch.normalizedPhone) &&
      emailMatch.normalizedPhone !== phone;

    if (inputPhoneConflictsWithProfile) {
      const match = {
        ...baseMatch,
        conflictContactIds: [emailMatch.id],
        reason: "email_matches_profile_but_phone_differs",
        status: "conflict_created" as const,
      };

      return {
        contactId: await createContactProfile(
          supabase,
          user,
          workspaceId,
          input,
          match,
          defaultPhoneRegion,
        ),
        match,
      };
    }

    await patchMissingContactFields(
      supabase,
      workspaceId,
      emailMatch,
      input,
      defaultPhoneRegion,
    );

    const match = {
      ...baseMatch,
      conflictContactIds: [],
      reason: phone ? "email_profile_match" : "email_only_profile_match",
      status: "attached" as const,
    };

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      actorId: user.id,
      action: "contact.profile_matched",
      entityType: "contact",
      entityId: emailMatch.id,
      after: match,
    });

    return {
      contactId: emailMatch.id,
      match,
    };
  }

  if (phoneMatch) {
    const inputEmailConflictsWithProfile =
      Boolean(email) &&
      Boolean(phoneMatch.normalizedEmail) &&
      phoneMatch.normalizedEmail !== email;

    if (inputEmailConflictsWithProfile) {
      const match = {
        ...baseMatch,
        conflictContactIds: [phoneMatch.id],
        reason: "phone_matches_profile_but_email_differs",
        status: "conflict_created" as const,
      };

      return {
        contactId: await createContactProfile(
          supabase,
          user,
          workspaceId,
          input,
          match,
          defaultPhoneRegion,
        ),
        match,
      };
    }

    await patchMissingContactFields(
      supabase,
      workspaceId,
      phoneMatch,
      input,
      defaultPhoneRegion,
    );

    const match = {
      ...baseMatch,
      conflictContactIds: [],
      reason: email ? "phone_profile_match" : "phone_only_profile_match",
      status: "attached" as const,
    };

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      actorId: user.id,
      action: "contact.profile_matched",
      entityType: "contact",
      entityId: phoneMatch.id,
      after: match,
    });

    return {
      contactId: phoneMatch.id,
      match,
    };
  }

  const match = {
    ...baseMatch,
    conflictContactIds: [],
    reason: "no_existing_profile_match",
    status: "created" as const,
  };

  return {
    contactId: await createContactProfile(
      supabase,
      user,
      workspaceId,
      input,
      match,
      defaultPhoneRegion,
    ),
    match,
  };
}

async function findOrCreateInboundChannel(
  supabase: SupabaseClient,
  workspaceId: string,
  input: ManualInboundInput,
) {
  const channel = input.channel ?? {
    displayName: "Manual inbound",
    externalId: null,
    settings: {
      createdBy: "manual_enquiry_form",
    },
    type: "manual_inbound",
  };
  let existingQuery = supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("type", channel.type);

  existingQuery = channel.externalId
    ? existingQuery.eq("external_id", channel.externalId)
    : existingQuery.eq("display_name", channel.displayName);

  const { data: existing, error: existingError } = await existingQuery
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to look up manual channel: ${existingError.message}`,
    );
  }

  if (existing) {
    return String(existing.id);
  }

  const { data: createdChannel, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: workspaceId,
      type: channel.type,
      display_name: channel.displayName,
      external_id: channel.externalId ?? null,
      status: "active",
      settings: channel.settings ?? {},
    })
    .select("id")
    .single();

  if (error || !createdChannel) {
    throw new Error(
      `Unable to create manual channel: ${error?.message ?? "unknown error"}`,
    );
  }

  return String(createdChannel.id);
}

export async function ingestManualInbound(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string,
  input: ManualInboundInput,
) {
  const source = nullableText(input.source) ?? "manual_inbound";
  const eventSource = nullableText(input.eventSource) ?? "web.dashboard";
  const eventType =
    nullableText(input.eventType) ?? "inbound.manual_enquiry.received";
  const extraMetadata = input.metadata ?? {};
  const idempotencyKey = `${source}.inbound.${
    input.submissionKey ?? crypto.randomUUID()
  }`;
  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      type: eventType,
      source: eventSource,
      idempotency_key: idempotencyKey,
      payload: {
        ...extraMetadata,
        stage: "received",
        contactName: input.contactName,
        email: nullableText(input.email),
        phone: nullableText(input.phone),
        contactType: normalizeContactType(input.contactType),
        address: nullableText(input.address),
        serviceType: nullableText(input.serviceType),
      },
      status: "processing",
    })
    .select("id,type,status")
    .single();

  if (eventError || !event) {
    if (eventError?.code === "23505") {
      const { data: existingEvent } = await supabase
        .from("events")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      return {
        duplicate: true,
        eventId: existingEvent ? String(existingEvent.id) : null,
      };
    }

    throw new Error(
      `Unable to record inbound event: ${eventError?.message ?? "unknown error"}`,
    );
  }

  const generalSettings = await getWorkspaceGeneralSettings(
    supabase,
    workspaceId,
  );
  const contactResolution = await resolveContactProfile(
    supabase,
    user,
    workspaceId,
    input,
    generalSettings.defaultPhoneRegion,
  );
  const contactId = contactResolution.contactId;
  const channelId = await findOrCreateInboundChannel(
    supabase,
    workspaceId,
    input,
  );
  const hasProfileConflict =
    contactResolution.match.status === "conflict_created";
  const leadTitle = input.serviceType?.trim()
    ? `${input.serviceType.trim()} enquiry from ${input.contactName}`
    : `New enquiry from ${input.contactName}`;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      source,
      title: leadTitle,
      description: input.message,
      status: "new",
      priority: hasProfileConflict ? "high" : "normal",
      service_type: nullableText(input.serviceType),
      next_step: hasProfileConflict
        ? "Resolve contact profile match before replying"
        : "Review AI proposed reply",
    })
    .select("id,title")
    .single();

  if (leadError || !lead) {
    throw new Error(
      `Unable to create lead: ${leadError?.message ?? "unknown error"}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "lead.created",
    entityType: "lead",
    entityId: String(lead.id),
    after: {
      title: lead.title,
      source,
      profileMatch: contactResolution.match,
    },
  });

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({
      workspace_id: workspaceId,
      channel_id: channelId,
      contact_id: contactId,
      lead_id: lead.id,
      status: "open",
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (conversationError || !conversation) {
    throw new Error(
      `Unable to create conversation: ${conversationError?.message ?? "unknown error"}`,
    );
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      workspace_id: workspaceId,
      conversation_id: conversation.id,
      channel_id: channelId,
      contact_id: contactId,
      direction: "inbound",
      subject: leadTitle,
      body_text: input.message,
      received_at: new Date().toISOString(),
      metadata: {
        ...extraMetadata,
        source,
        company: nullableText(input.company),
      },
    })
    .select("id")
    .single();

  if (messageError || !message) {
    throw new Error(
      `Unable to create message: ${messageError?.message ?? "unknown error"}`,
    );
  }

  const { error: eventUpdateError } = await supabase
    .from("events")
    .update({
      payload: {
        contactId,
        leadId: lead.id,
        conversationId: conversation.id,
        messageId: message.id,
        serviceType: nullableText(input.serviceType),
        profileMatch: contactResolution.match,
      },
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .eq("id", event.id);

  if (eventUpdateError) {
    throw new Error(
      `Unable to update inbound event: ${eventUpdateError.message}`,
    );
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action:
      source === "twilio_sms"
        ? "inbound.twilio_sms.ingested"
        : "inbound.manual_enquiry.ingested",
    entityType: "event",
    entityId: String(event.id),
    after: {
      type: event.type,
      status: "processed",
      contactId,
      leadId: lead.id,
      conversationId: conversation.id,
      messageId: message.id,
      profileMatch: contactResolution.match,
    },
  });

  const aiResult = await runStubAiTriage(supabase, user, workspaceId, {
    source,
    sourceEventId: String(event.id),
    contactId,
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    messageId: String(message.id),
    leadTitle: String(lead.title),
    serviceType: nullableText(input.serviceType),
    contactAddress: nullableText(input.address),
    summary: `${
      source === "twilio_sms" ? "Inbound SMS" : "Manual inbound enquiry"
    } from ${input.contactName}: ${input.message.slice(0, 180)}`,
  });

  return {
    duplicate: false,
    contactId,
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    messageId: String(message.id),
    eventId: String(event.id),
    aiRunId: aiResult.aiRunId,
    actionId: aiResult.actionId,
  };
}
