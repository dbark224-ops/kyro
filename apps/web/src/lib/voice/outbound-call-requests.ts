import type { SupabaseClient } from "@supabase/supabase-js";
import { getContactList, type ContactListItem } from "../crm/queries";

export type OutboundCallRequestResolution =
  | {
      contactId: string | null;
      contactName: string | null;
      conversationId: string | null;
      instructions: string;
      leadId: string | null;
      matches: [];
      phoneNumber: string;
      status: "ready";
    }
  | {
      contactId: string | null;
      contactName: string | null;
      conversationId: string | null;
      instructions: string | null;
      leadId: string | null;
      matches: Array<{
        company: string | null;
        email: string | null;
        id: string;
        name: string | null;
        phone: string | null;
      }>;
      phoneNumber: string | null;
      reason: string;
      status: "ambiguous" | "missing_instructions" | "missing_phone" | "not_found";
    };

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function directPhoneFromPrompt(prompt: string) {
  const match = prompt.match(/(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,14}\d/);

  return match?.[0]?.replace(/[^\d+]/g, "") ?? null;
}

function stripPhone(value: string) {
  return value.replace(/(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,14}\d/g, " ");
}

export function looksLikeOutboundCallRequest(prompt: string) {
  const text = normalized(prompt);
  const hasCallVerb = /\b(call|phone|ring|dial)\b/.test(text);
  const hasOutboundAction =
    /\b(tell|say|ask|let|notify|remind|confirm|book|schedule|follow up|followup|call back|callback|message)\b/.test(
      text,
    );

  return hasCallVerb && hasOutboundAction;
}

export function outboundCallInstructionsFromPrompt(prompt: string) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:tell|say to|let)\b(?:\s+(?:him|her|them|the customer|the client|the contact|that person|this guy|this person|[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?))?(?:\s+(?:know|that|to))?\s+(.+)$/i,
    /\bask\b(?:\s+(?:him|her|them|the customer|the client|the contact|that person|this guy|this person|[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?))?(?:\s+(?:if|whether|to|about))?\s+(.+)$/i,
    /\b(?:confirm|remind|notify)\b(?:\s+(?:him|her|them|the customer|the client|the contact|that person|this guy|this person|[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?))?(?:\s+(?:that|about|to))?\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    const captured = match?.[1]?.trim();

    if (captured && captured.length >= 4) {
      return captured;
    }
  }

  const afterCall = clean.match(
    /\b(?:call|phone|ring|dial)\b(?:\s+(?:the customer|the client|the contact|this guy|this person|him|her|them|[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?|\+?\d[\d\s().-]{6,}\d))?\s+(?:and\s+)?(.+)$/i,
  )?.[1];

  if (afterCall && afterCall.trim().length >= 8) {
    return afterCall.trim();
  }

  return null;
}

function scoreContact(prompt: string, contact: ContactListItem) {
  const promptText = normalized(stripPhone(prompt));
  const promptLower = prompt.toLowerCase();
  const promptDigits = prompt.replace(/\D/g, "");
  const name = contact.name ? normalized(contact.name) : "";
  const company = contact.company ? normalized(contact.company) : "";
  const email = contact.email?.toLowerCase().trim() ?? "";
  const phoneDigits = contact.phone?.replace(/\D/g, "") ?? "";
  let score = 0;

  if (email && promptLower.includes(email)) {
    score += 160;
  }

  if (phoneDigits.length >= 6 && promptDigits.includes(phoneDigits)) {
    score += 150;
  }

  if (name && promptText.includes(name)) {
    score += 120;
  }

  if (company && promptText.includes(company)) {
    score += 100;
  }

  const nameParts = name.split(" ").filter((part) => part.length >= 3);
  const matchingParts = nameParts.filter((part) =>
    promptText.split(" ").includes(part),
  );

  if (matchingParts.length > 0) {
    score += Math.min(80, matchingParts.length * 35);
  }

  return score;
}

function contactOptions(contacts: readonly ContactListItem[]) {
  return contacts.slice(0, 5).map((contact) => ({
    company: contact.company ?? null,
    email: contact.email ?? null,
    id: contact.id,
    name: contact.name ?? null,
    phone: contact.phone ?? null,
  }));
}

function rankedContacts(prompt: string, contacts: readonly ContactListItem[]) {
  return contacts
    .map((contact) => ({ contact, score: scoreContact(prompt, contact) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

export async function resolveOutboundCallRequest({
  contactId,
  contacts,
  conversationId = null,
  instructions,
  leadId = null,
  phoneNumber,
  prompt,
  supabase,
  workspaceId,
}: {
  contactId?: string | null;
  contacts?: readonly ContactListItem[];
  conversationId?: string | null;
  instructions?: string | null;
  leadId?: string | null;
  phoneNumber?: string | null;
  prompt: string;
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<OutboundCallRequestResolution> {
  const loadedContacts = contacts ?? (await getContactList(supabase, workspaceId));
  const requestedPhone = textValue(phoneNumber) ?? directPhoneFromPrompt(prompt);
  const requestedInstructions =
    textValue(instructions) ?? outboundCallInstructionsFromPrompt(prompt);
  const explicitContact =
    contactId && loadedContacts.find((contact) => contact.id === contactId);
  const ranked = explicitContact
    ? [{ contact: explicitContact, score: 200 }]
    : rankedContacts(prompt, loadedContacts);
  const best = ranked[0];
  const selectedContact =
    best && best.score >= 80
      ? best.contact
      : requestedPhone
        ? null
        : undefined;
  const tied = best
    ? ranked.filter((item) => item.score === best.score && item.score >= 80)
    : [];

  if (!requestedPhone && tied.length > 1) {
    return {
      contactId: null,
      contactName: null,
      conversationId,
      instructions: requestedInstructions,
      leadId,
      matches: contactOptions(tied.map((item) => item.contact)),
      phoneNumber: null,
      reason: "Multiple contacts match that call request.",
      status: "ambiguous",
    };
  }

  const resolvedPhone = requestedPhone ?? textValue(selectedContact?.phone);

  if (!resolvedPhone) {
    return {
      contactId: selectedContact?.id ?? null,
      contactName: selectedContact?.name ?? selectedContact?.company ?? null,
      conversationId,
      instructions: requestedInstructions,
      leadId,
      matches: contactOptions(ranked.map((item) => item.contact)),
      phoneNumber: null,
      reason: selectedContact
        ? "That contact does not have a phone number."
        : "Kyro could not find a matching contact or phone number.",
      status: selectedContact ? "missing_phone" : "not_found",
    };
  }

  if (!requestedInstructions) {
    return {
      contactId: selectedContact?.id ?? contactId ?? null,
      contactName: selectedContact?.name ?? selectedContact?.company ?? null,
      conversationId,
      instructions: null,
      leadId,
      matches: selectedContact ? contactOptions([selectedContact]) : [],
      phoneNumber: resolvedPhone,
      reason: "Kyro needs to know what to say on the outbound call.",
      status: "missing_instructions",
    };
  }

  return {
    contactId: selectedContact?.id ?? contactId ?? null,
    contactName: selectedContact?.name ?? selectedContact?.company ?? null,
    conversationId,
    instructions: requestedInstructions,
    leadId,
    matches: [],
    phoneNumber: resolvedPhone,
    status: "ready",
  };
}
