import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AddressColumnUpdates } from "../addresses/types";
import { addressWorthLearning } from "../addresses/replace";
import {
  associatedContactContextLine,
  findContactByAssociatedPhone,
} from "../crm/associated-contact";
import { runStubAiTriage } from "../ai/triage";
import { hasRepeatContactPressure } from "../crm/repeat-contact";
import { normalizeContactType } from "../crm/contact-types";
import {
  isDialablePhoneNumber,
  normalizeCompanyName,
  normalizeContactEmail,
  normalizeContactPhoneForRegion,
  type PhoneRegion,
} from "../crm/identity";
import { insertAuditLog } from "../engine/event-action-audit";
import { createUrgentEscalationIncident } from "../escalation/urgent-escalation";
import { getWorkspaceGeneralSettings } from "../workspace/general-settings";
import { classifyEmergency } from "../escalation/emergency-classifier";
import {
  decideSameJob,
  mergeTradeLabels,
  sameJobNote,
  SAME_JOB_WINDOW_MS,
} from "./same-job";

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
  addressValidationStatus: string | null;
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
  address_validation_status?: unknown;
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
    addressValidationStatus: contact.address_validation_status
      ? String(contact.address_validation_status)
      : null,
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
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  );

  if (contactIds.length === 0) {
    return "Potential profile match conflict. Email matched none; phone matched none.";
  }

  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id,name,email,phone,company,normalized_email,normalized_phone,normalized_company,contact_type,address,address_validation_status",
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
    ? (contactsById.get(match.emailMatchedContactId) ?? "Unknown contact")
    : "none";
  const phoneMatch = match.phoneMatchedContactId
    ? (contactsById.get(match.phoneMatchedContactId) ?? "Unknown contact")
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
      "id,name,email,phone,company,normalized_email,normalized_phone,normalized_company,contact_type,address,address_validation_status",
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

/**
 * A better name than the one a contact currently has, or null.
 *
 * A contact named after its own phone number has no name yet. Inbound SMS
 * names a new contact `existingContact?.name ?? input.from`, so every texter
 * starts life called "+1505...". That is a placeholder, but the check here
 * only ever filled a blank, so the placeholder counted as a real name and beat
 * every later chance to learn one.
 *
 * Measured: a customer texted "Hi, it's Thaddeus Brightwater" with his email in
 * the same sentence. The email was extracted and stored; the name was not. He
 * then emailed, the message correctly attached to that same contact, the ingest
 * supplied the name outright -- and the card still read "+15055550137".
 *
 * Narrow on purpose. Only a name identical to the contact's own number counts
 * as absent, so a name the owner typed is never overwritten, and the candidate
 * has to be something other than that number or nothing is gained.
 */
export function nameWorthLearning(
  contact: Pick<ContactCandidate, "name" | "phone" | "normalizedPhone">,
  candidateName: string,
) {
  const candidate = candidateName.trim();

  if (!candidate) {
    return null;
  }

  // Compared as digits, not as strings. "+1 505 555 0137" and "+15055550137"
  // are the same number wearing different punctuation, and an early version of
  // this happily replaced one with the other -- still not a name. Its own test
  // caught that.
  const digits = (value: string | null | undefined) =>
    value ? value.replace(/\D/g, "") : "";
  const ownNumbers = new Set(
    [digits(contact.phone), digits(contact.normalizedPhone)].filter(Boolean),
  );
  const isOwnNumber = (value: string | null) => {
    const asDigits = digits(value);

    if (!asDigits) {
      return false;
    }

    // An exact digit match was not enough. The stored number carries a country
    // code and what people type usually does not, so "5055550137" against a
    // stored "+15055550137" is ten digits against eleven and read as a name.
    // The test that was meant to cover this compared two formats of the same
    // eleven digits and passed throughout.
    return [...ownNumbers].some(
      (own) => own === asDigits || own.endsWith(asDigits) || asDigits.endsWith(own),
    );
  };

  // A name is not a number and not an address. Whatever the extractor hands
  // over, seven digits in a row is somebody's phone and an @ is their email,
  // and either one written into the name field is worse than leaving it as it
  // was -- it looks deliberate on the contact card.
  const looksLikeContactDetails = (value: string) =>
    value.includes("@") || /\d{7,}/.test(value.replace(/\D/g, ""));

  if (contact.name && !isOwnNumber(contact.name)) {
    return null;
  }

  return isOwnNumber(candidate) || looksLikeContactDetails(candidate)
    ? null
    : candidate;
}

/** The most recent lead this contact raised in the last half hour, if any. */

async function findRecentLeadForContact(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
) {
  const { data, error } = await supabase
    .from("leads")
    .select("id,title,created_at,status,service_type")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .gte("created_at", new Date(Date.now() - SAME_JOB_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Never fatal, and it fails towards raising a separate job. Losing this
    // lookup costs the owner a tidy inbox; failing the ingest over it would
    // cost them the enquiry.
    console.warn("Open-job lookup failed", {
      code: error.code,
      workspaceId,
    });

    return null;
  }

  return data
    ? {
        createdAt: String(data.created_at),
        id: String(data.id),
        serviceType: data.service_type ? String(data.service_type) : null,
        status: data.status ? String(data.status) : null,
        title: String(data.title),
      }
    : null;
}

/** How the second thread reads to the owner: "by SMS", "by email". */
function sourceChannelLabel(source: string) {
  const text = source.toLowerCase();

  if (text.includes("sms") || text.includes("twilio")) {
    return "SMS";
  }

  if (text.includes("whatsapp")) {
    return "WhatsApp";
  }

  if (text.includes("mail")) {
    return "email";
  }

  if (text.includes("voice") || text.includes("call") || text.includes("vapi")) {
    return "phone";
  }

  return "another channel";
}

async function raiseNewJob(
  supabase: SupabaseClient,
  input: {
    contactId: string;
    hasProfileConflict: boolean;
    leadTitle: string;
    message: string;
    recentLead: { title: string } | null;
    serviceType: string | null;
    source: string;
    workspaceId: string;
  },
) {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      workspace_id: input.workspaceId,
      contact_id: input.contactId,
      source: input.source,
      title: input.leadTitle,
      description: input.message,
      status: "new",
      priority: input.hasProfileConflict ? "high" : "normal",
      service_type: input.serviceType,
      // Carried in next_step rather than a metadata column, because leads has
      // no metadata column. The first version of this added one and broke lead
      // creation outright -- and lint:db passed, because it validates select()
      // against the schema snapshot and not insert(). The live run caught it.
      next_step: input.hasProfileConflict
        ? "Resolve contact profile match before replying"
        : input.recentLead
          ? `Raised separately from "${input.recentLead.title}" -- different work, or the same person could not be confirmed`
          : "Review AI proposed reply",
    })
    .select("id,title")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to create lead: ${error?.message ?? "unknown error"}`,
    );
  }

  return data;
}

/**
 * Join a second thread onto the job already open.
 *
 * The note is the point of this: the owner opens one job and can see it came
 * in twice. Failing to write the note must not lose the enquiry, so a failed
 * update is reported and the attachment stands.
 */
async function attachToOpenJob(
  supabase: SupabaseClient,
  input: { channelLabel: string; leadId: string; workspaceId: string },
) {
  const { data, error } = await supabase
    .from("leads")
    .update({ next_step: sameJobNote(input.channelLabel) })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.leadId)
    .select("id,title")
    .single();

  if (error || !data) {
    console.warn("Could not annotate the job a second thread joined", {
      code: error?.code,
      leadId: input.leadId,
    });

    return { id: input.leadId, title: "" };
  }

  return data;
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

  const learnedName = nameWorthLearning(contact, input.contactName);

  if (learnedName) {
    updates.name = learnedName;
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

  if (addressWorthLearning(contact, address)) {
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
  // A number can be stored but not dialled -- normalization is deliberately
  // lenient so contacts are never lost. Surface the difference at intake so an
  // undialable number becomes visible CRM work instead of a silent dead letter
  // the first time Kyro tries to reply.
  const undialablePhone = Boolean(
    phone && !isDialablePhoneNumber(phone, defaultPhoneRegion),
  );
  const tags = [
    source,
    ...(match.status === "conflict_created" ? ["profile_match_conflict"] : []),
    ...(undialablePhone ? ["undialable_phone"] : []),
  ];
  const conflictNote = await profileConflictNote(supabase, workspaceId, match);
  const resolutionReason =
    match.status === "conflict_created"
      ? match.reason
      : undialablePhone
        ? `${phone} isn't a valid phone number, so Kyro can't text or call it.`
        : null;

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
        match.status === "conflict_created" || undialablePhone
          ? "needs_review"
          : "clear",
      profile_resolution_reason: resolutionReason,
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

  // One customer reaching out twice at once is two jobs for one problem.
  //
  // Measured: the same person texted and filled in the web form seconds apart
  // about the same broken immersion heater. The contact deduplicated correctly
  // to one -- identity across channels works -- but two leads were raised, and
  // the owner sees two jobs. The risk is quoting twice, or sending somebody to
  // a job already done.
  //
  // A threaded reply raises no second job, and a repeated webhook delivery
  // raises none either; both were checked. The gap is only same-contact,
  // near-simultaneous, DIFFERENT channels, where there is no thread and no
  // shared message id to key on.
  //
  // This only annotates. Merging two leads automatically would be worse than
  // showing two, because sometimes they genuinely are two jobs -- so the owner
  // decides, and the flag is what lets them.
  const recentLead = await findRecentLeadForContact(
    supabase,
    workspaceId,
    contactId,
  );
  // A customer who emails and then texts about the same problem has one job.
  // Raising a second one and labelling it "possible duplicate" left the owner
  // to sort it out; the decision is that Kyro should join them where it can
  // tell they belong together, and leave them apart where it cannot.
  const sameJob = decideSameJob({
    hasProfileConflict,
    openLead: recentLead,
  });

  const lead = sameJob.attach
    ? await attachToOpenJob(supabase, {
        channelLabel: sourceChannelLabel(source),
        leadId: sameJob.leadId,
        workspaceId,
      })
    : await raiseNewJob(supabase, {
        contactId,
        hasProfileConflict,
        leadTitle,
        message: input.message,
        recentLead,
        serviceType: nullableText(input.serviceType),
        source,
        workspaceId,
      });

  await insertAuditLog(supabase, {
    workspaceId,
    actorType: "user",
    actorId: user.id,
    // Says which of the two happened, because "created" on a job that already
    // existed would misread the history later.
    action: sameJob.attach ? "lead.thread_attached" : "lead.created",
    entityType: "lead",
    entityId: String(lead.id),
    after: {
      title: lead.title,
      source,
      profileMatch: contactResolution.match,
      sameJobReason: sameJob.reason,
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

  // Only when the sender is not a contact in their own right. A primary match
  // is the stronger signal and must not be second-guessed by a secondary one --
  // the same guard the voice path uses.
  const associatedContact =
    contactResolution.match.status === "attached"
      ? null
      : await findContactByAssociatedPhone(
          supabase,
          workspaceId,
          nullableText(input.phone),
        ).catch(() => null);
  const aiResult = await runStubAiTriage(supabase, user, workspaceId, {
    source,
    sourceEventId: String(event.id),
    associatedContactContext: associatedContact
      ? associatedContactContextLine(associatedContact)
      : null,
    contactId,
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    messageId: String(message.id),
    leadTitle: String(lead.title),
    serviceType: nullableText(input.serviceType),
    contactAddress: nullableText(input.address),
    contactEmail: nullableText(input.email),
    contactPhone: nullableText(input.phone),
    defaultPhoneRegion: generalSettings.defaultPhoneRegion,
    inboundChannelType: input.channel?.type ?? "manual_inbound",
    summary: `${
      source === "twilio_sms" ? "Inbound SMS" : "Manual inbound enquiry"
    } from ${input.contactName}: ${input.message.slice(0, 180)}`,
  });

  // A contact whose name is blank, or is just the number they texted from,
  // gets the name they gave in the message itself.
  //
  // 8 of 213 contacts had no name at all, including the customer owed a $450
  // refund -- an inbound email with no display name has nothing to use, and an
  // SMS never does. nameWorthLearning decides whether the candidate is an
  // improvement; it refuses to overwrite a name a human typed.
  if (aiResult?.customerName) {
    const { data: current } = await supabase
      .from("contacts")
      .select("name,phone,normalized_phone")
      .eq("workspace_id", workspaceId)
      .eq("id", contactId)
      .maybeSingle();
    const learned = nameWorthLearning(
      {
        name: current?.name ? String(current.name) : null,
        normalizedPhone: current?.normalized_phone
          ? String(current.normalized_phone)
          : null,
        phone: current?.phone ? String(current.phone) : null,
      },
      aiResult.customerName,
    );

    if (learned) {
      const { error: nameError } = await supabase
        .from("contacts")
        .update({ name: learned })
        .eq("workspace_id", workspaceId)
        .eq("id", contactId);

      if (nameError) {
        // Not fatal. Losing the name costs a tidier contact list; failing the
        // ingest over it would cost the enquiry.
        console.warn("Unable to store extracted contact name", {
          code: nameError.code,
          workspaceId,
        });
      }
    }
  }

  // What kind of work this is, from what the customer wrote.
  //
  // Email has always done this: it classifies the message and stores a real
  // trade, which is why email leads read Plumbing, Tiling, Bathroom
  // Renovation. This path never did. Inbound SMS passed the literal string
  // "SMS", so all 97 text enquiries were filed under the channel they arrived
  // on rather than the job -- and removing that left them null, which is
  // tidier and no more useful.
  //
  // Triage already works it out and the answer was being thrown away: the lead
  // is created before triage runs, so jobType was computed moments later and
  // never written back. No extra call, no extra cost.
  //
  // Only ever fills a blank. A trade the owner or the caller set is left
  // alone, and a job that has been attached to an existing one keeps the trade
  // that job already had.
  // One call, two answers: whether this needs the owner tonight, and what kind
  // of work it is. Both come from reading the same message, so asking twice
  // would be paying twice.
  const classified = await classifyEmergency(input.message, {
    supabase,
    userId: user.id,
    workspaceId,
  });

  // Triage was the obvious source and turned out to be the wrong one: it only
  // extracts trade facts when it decides a message is starting a service job,
  // and for these it returned jobType null with mode simple_business_message.
  // The classifier that already runs on every inquiry answers it instead.
  const learnedJobType =
    nullableText(classified.trade) ??
    nullableText(aiResult?.inquiryFacts?.jobType);

  if (learnedJobType && !nullableText(input.serviceType)) {
    // Two paths, because a new job and a job being joined want opposite things.
    //
    // A new job takes the trade only if it has none, so nothing already known
    // gets overwritten by a guess. A job being joined accumulates instead: the
    // owner's decision is that one customer asking about two trades is one
    // visit carrying both labels, so a text about a socket that lands on this
    // afternoon's plumbing job makes it "Plumbing + Electrical" rather than a
    // second job the owner has to reconcile.
    const merged = sameJob.attach
      ? mergeTradeLabels(recentLead?.serviceType, learnedJobType)
      : learnedJobType;
    const unchanged =
      sameJob.attach && merged === nullableText(recentLead?.serviceType);

    if (merged && !unchanged) {
      const update = supabase
        .from("leads")
        .update({ service_type: merged })
        .eq("workspace_id", workspaceId)
        .eq("id", lead.id);
      // Only the new-job path insists the column is still empty; the joined
      // path is deliberately adding to what is already there.
      const { error: serviceTypeError } = await (sameJob.attach
        ? update
        : update.is("service_type", null));

      if (serviceTypeError) {
        // Not fatal, for the same reason as the name above: losing this costs a
        // less useful report, not the enquiry.
        console.warn("Unable to store the classified job type", {
          code: serviceTypeError.code,
          workspaceId,
        });
      }
    }
  }

  await createUrgentEscalationIncident(supabase, workspaceId, {
    contactId,
    content: input.message,
    conversationId: String(conversation.id),
    existingCustomer: contactResolution.match.status === "attached",
    leadId: String(lead.id),
    // Two readings of the same message, and the keywords are a third. The
    // dedicated call does the work; the triage field is kept because it costs
    // nothing. Both are checked against input.message before either can raise
    // anything, so an unsupported one costs nothing either.
    modelSignals: [...(aiResult?.escalationSignals ?? []), ...classified.signals],
    metadata: {
      channelType: input.channel?.type ?? "manual_inbound",
      eventId: String(event.id),
      // Counted across channels, which is the point of the trigger: someone who
      // emailed, heard nothing, and has now texted.
      repeatContact: await hasRepeatContactPressure(supabase, {
        contactId,
        workspaceId,
      }),
      source,
    },
    priority: hasProfileConflict ? "high" : "normal",
    sourceId: String(event.id),
    sourceKey: `${source}:${event.id}`,
    sourceType: source === "twilio_sms" ? "sms" : "manual",
    summary: `${source === "twilio_sms" ? "Inbound SMS" : "Inbound enquiry"} from ${input.contactName}: ${input.message.slice(0, 500)}`,
    title: String(lead.title),
  }).catch((escalationError) => {
    console.error("Unable to evaluate manual inbound escalation", {
      error:
        escalationError instanceof Error
          ? escalationError.message
          : "Unknown escalation error",
      eventId: String(event.id),
      workspaceId,
    });
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
    inquiryFacts: aiResult.inquiryFacts,
    ownerQuestion: aiResult.ownerQuestion,
    replyDraft: aiResult.replyDraft,
    responseMode: aiResult.responseMode,
    triageSummary: aiResult.summary,
  };
}
