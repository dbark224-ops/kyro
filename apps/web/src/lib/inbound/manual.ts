import type { SupabaseClient, User } from "@supabase/supabase-js";
import { runStubAiTriage } from "../ai/triage";
import { normalizeContactType } from "../crm/contact-types";
import { insertAuditLog } from "../engine/event-action-audit";

export type ManualInboundInput = {
  submissionKey?: string;
  contactName: string;
  email?: string;
  phone?: string;
  company?: string;
  contactType?: string;
  address?: string;
  serviceType?: string;
  message: string;
};

function nullableText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value?: string | null) {
  return nullableText(value)?.toLowerCase() ?? null;
}

function normalizePhone(value?: string | null) {
  const trimmed = nullableText(value);

  if (!trimmed) {
    return null;
  }

  const digits = trimmed.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

type ContactCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
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
  contact_type: unknown;
  address: unknown;
}): ContactCandidate {
  return {
    id: String(contact.id),
    name: contact.name ? String(contact.name) : null,
    email: contact.email ? String(contact.email) : null,
    phone: contact.phone ? String(contact.phone) : null,
    company: contact.company ? String(contact.company) : null,
    contactType: contact.contact_type ? String(contact.contact_type) : null,
    address: contact.address ? String(contact.address) : null
  };
}

async function loadContactCandidates(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id,name,email,phone,company,contact_type,address")
    .eq("workspace_id", workspaceId)
    .limit(500);

  if (error) {
    throw new Error(`Unable to look up contacts: ${error.message}`);
  }

  return (data ?? []).map(toContactCandidate);
}

async function patchMissingContactFields(
  supabase: SupabaseClient,
  workspaceId: string,
  contact: ContactCandidate,
  input: ManualInboundInput
) {
  const updates: Record<string, string> = {};
  const email = normalizeEmail(input.email);
  const phone = nullableText(input.phone);
  const company = nullableText(input.company);
  const address = nullableText(input.address);
  const contactType = normalizeContactType(input.contactType);

  if (!contact.name && input.contactName.trim()) {
    updates.name = input.contactName.trim();
  }

  if (!contact.email && email) {
    updates.email = email;
  }

  if (!contact.phone && phone) {
    updates.phone = phone;
  }

  if (!contact.company && company) {
    updates.company = company;
  }

  if (!contact.address && address) {
    updates.address = address;
  }

  if ((!contact.contactType || contact.contactType === "client") && contactType !== "client") {
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
  match: ContactMatchResult["match"]
) {
  const email = normalizeEmail(input.email);
  const phone = nullableText(input.phone);
  const contactType = normalizeContactType(input.contactType);
  const tags =
    match.status === "conflict_created"
      ? ["manual_inbound", "profile_match_conflict"]
      : ["manual_inbound"];

  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      name: input.contactName,
      email,
      phone,
      company: nullableText(input.company),
      contact_type: contactType,
      address: nullableText(input.address),
      source: "manual_inbound",
      notes:
        match.status === "conflict_created"
          ? `Potential profile match conflict. Email matched ${match.emailMatchedContactId ?? "none"}; phone matched ${match.phoneMatchedContactId ?? "none"}.`
          : null,
      tags
    })
    .select("id")
    .single();

  if (error || !contact) {
    throw new Error(`Unable to create contact: ${error?.message ?? "unknown error"}`);
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
      source: "manual_inbound",
      email,
      phone,
      contactType,
      address: nullableText(input.address),
      profileMatch: match
    }
  });

  return String(contact.id);
}

async function resolveContactProfile(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string,
  input: ManualInboundInput
): Promise<ContactMatchResult> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const contacts = await loadContactCandidates(supabase, workspaceId);
  const emailMatch = email
    ? contacts.find((contact) => normalizeEmail(contact.email) === email) ?? null
    : null;
  const phoneMatch = phone
    ? contacts.find((contact) => normalizePhone(contact.phone) === phone) ?? null
    : null;
  const baseMatch = {
    emailMatchedContactId: emailMatch?.id ?? null,
    phoneMatchedContactId: phoneMatch?.id ?? null
  };

  if (email && phone && emailMatch && phoneMatch && emailMatch.id !== phoneMatch.id) {
    const match = {
      ...baseMatch,
      conflictContactIds: [emailMatch.id, phoneMatch.id],
      reason: "email_and_phone_match_different_profiles",
      status: "conflict_created" as const
    };

    return {
      contactId: await createContactProfile(supabase, user, workspaceId, input, match),
      match
    };
  }

  if (emailMatch) {
    const inputPhoneConflictsWithProfile =
      Boolean(phone) &&
      Boolean(emailMatch.phone) &&
      normalizePhone(emailMatch.phone) !== phone;

    if (inputPhoneConflictsWithProfile) {
      const match = {
        ...baseMatch,
        conflictContactIds: [emailMatch.id],
        reason: "email_matches_profile_but_phone_differs",
        status: "conflict_created" as const
      };

      return {
        contactId: await createContactProfile(supabase, user, workspaceId, input, match),
        match
      };
    }

    await patchMissingContactFields(supabase, workspaceId, emailMatch, input);

    const match = {
      ...baseMatch,
      conflictContactIds: [],
      reason: phone ? "email_profile_match" : "email_only_profile_match",
      status: "attached" as const
    };

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      actorId: user.id,
      action: "contact.profile_matched",
      entityType: "contact",
      entityId: emailMatch.id,
      after: match
    });

    return {
      contactId: emailMatch.id,
      match
    };
  }

  if (phoneMatch) {
    const inputEmailConflictsWithProfile =
      Boolean(email) &&
      Boolean(phoneMatch.email) &&
      normalizeEmail(phoneMatch.email) !== email;

    if (inputEmailConflictsWithProfile) {
      const match = {
        ...baseMatch,
        conflictContactIds: [phoneMatch.id],
        reason: "phone_matches_profile_but_email_differs",
        status: "conflict_created" as const
      };

      return {
        contactId: await createContactProfile(supabase, user, workspaceId, input, match),
        match
      };
    }

    await patchMissingContactFields(supabase, workspaceId, phoneMatch, input);

    const match = {
      ...baseMatch,
      conflictContactIds: [],
      reason: email ? "phone_profile_match" : "phone_only_profile_match",
      status: "attached" as const
    };

    await insertAuditLog(supabase, {
      workspaceId,
      actorType: "system",
      actorId: user.id,
      action: "contact.profile_matched",
      entityType: "contact",
      entityId: phoneMatch.id,
      after: match
    });

    return {
      contactId: phoneMatch.id,
      match
    };
  }

  const match = {
    ...baseMatch,
    conflictContactIds: [],
    reason: "no_existing_profile_match",
    status: "created" as const
  };

  return {
    contactId: await createContactProfile(supabase, user, workspaceId, input, match),
    match
  };
}

async function findOrCreateManualChannel(supabase: SupabaseClient, workspaceId: string) {
  const { data: existing, error: existingError } = await supabase
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("type", "manual_inbound")
    .eq("display_name", "Manual inbound")
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to look up manual channel: ${existingError.message}`);
  }

  if (existing) {
    return String(existing.id);
  }

  const { data: channel, error } = await supabase
    .from("channels")
    .insert({
      workspace_id: workspaceId,
      type: "manual_inbound",
      display_name: "Manual inbound",
      status: "active",
      settings: {
        createdBy: "manual_enquiry_form"
      }
    })
    .select("id")
    .single();

  if (error || !channel) {
    throw new Error(`Unable to create manual channel: ${error?.message ?? "unknown error"}`);
  }

  return String(channel.id);
}

export async function ingestManualInbound(
  supabase: SupabaseClient,
  user: User,
  workspaceId: string,
  input: ManualInboundInput
) {
  const idempotencyKey = `manual.inbound.${input.submissionKey ?? crypto.randomUUID()}`;
  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      workspace_id: workspaceId,
      type: "inbound.manual_enquiry.received",
      source: "web.dashboard",
      idempotency_key: idempotencyKey,
      payload: {
        stage: "received",
        contactName: input.contactName,
        email: nullableText(input.email),
        phone: nullableText(input.phone),
        contactType: normalizeContactType(input.contactType),
        address: nullableText(input.address),
        serviceType: nullableText(input.serviceType)
      },
      status: "processing"
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
        eventId: existingEvent ? String(existingEvent.id) : null
      };
    }

    throw new Error(`Unable to record inbound event: ${eventError?.message ?? "unknown error"}`);
  }

  const contactResolution = await resolveContactProfile(supabase, user, workspaceId, input);
  const contactId = contactResolution.contactId;
  const channelId = await findOrCreateManualChannel(supabase, workspaceId);
  const hasProfileConflict = contactResolution.match.status === "conflict_created";
  const leadTitle = input.serviceType?.trim()
    ? `${input.serviceType.trim()} enquiry from ${input.contactName}`
    : `New enquiry from ${input.contactName}`;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      source: "manual_inbound",
      title: leadTitle,
      description: input.message,
      status: "new",
      priority: hasProfileConflict ? "high" : "normal",
      service_type: nullableText(input.serviceType),
      next_step: hasProfileConflict
        ? "Resolve contact profile match before replying"
        : "Review AI proposed reply"
    })
    .select("id,title")
    .single();

  if (leadError || !lead) {
    throw new Error(`Unable to create lead: ${leadError?.message ?? "unknown error"}`);
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
      source: "manual_inbound",
      profileMatch: contactResolution.match
    }
  });

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({
      workspace_id: workspaceId,
      channel_id: channelId,
      contact_id: contactId,
      lead_id: lead.id,
      status: "open",
      last_message_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (conversationError || !conversation) {
    throw new Error(`Unable to create conversation: ${conversationError?.message ?? "unknown error"}`);
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
        source: "manual_inbound",
        company: nullableText(input.company)
      }
    })
    .select("id")
    .single();

  if (messageError || !message) {
    throw new Error(`Unable to create message: ${messageError?.message ?? "unknown error"}`);
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
        profileMatch: contactResolution.match
      },
      status: "processed",
      processed_at: new Date().toISOString()
    })
    .eq("id", event.id);

  if (eventUpdateError) {
    throw new Error(`Unable to update inbound event: ${eventUpdateError.message}`);
  }

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    action: "inbound.manual_enquiry.ingested",
    entityType: "event",
    entityId: String(event.id),
    after: {
      type: event.type,
      status: "processed",
      contactId,
      leadId: lead.id,
      conversationId: conversation.id,
      messageId: message.id,
      profileMatch: contactResolution.match
    }
  });

  const aiResult = await runStubAiTriage(supabase, user, workspaceId, {
    source: "manual_inbound",
    sourceEventId: String(event.id),
    contactId,
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    messageId: String(message.id),
    leadTitle: String(lead.title),
    serviceType: nullableText(input.serviceType),
    contactAddress: nullableText(input.address),
    summary: `Manual inbound enquiry from ${input.contactName}: ${input.message.slice(0, 180)}`
  });

  return {
    duplicate: false,
    contactId,
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    messageId: String(message.id),
    eventId: String(event.id),
    aiRunId: aiResult.aiRunId,
    actionId: aiResult.actionId
  };
}
