import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactListItem } from "../crm/queries";
import {
  looksLikeOutboundCallRequest,
  looksLikeSelfOutboundCallRequest,
  resolveOutboundCallRequest,
} from "./outbound-call-requests";

function contact(overrides: Partial<ContactListItem>): ContactListItem {
  return {
    address: null,
    addressValidationStatus: null,
    company: null,
    contactType: "client",
    duplicateWarnings: [],
    email: null,
    id: "contact-1",
    lastMessageAt: null,
    lifecycleReason: null,
    lifecycleReviewedAt: null,
    lifecycleSource: "manual",
    lifecycleStage: "lead",
    mergedIntoContactId: null,
    messageCount: 0,
    name: null,
    notes: null,
    phone: null,
    profileConflictContactIds: [],
    profileResolutionReason: null,
    profileResolutionStatus: "resolved",
    source: "manual",
    updatedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("outbound call recipient resolution", () => {
  it("recognizes a direct request to call the current sender", () => {
    assert.equal(looksLikeSelfOutboundCallRequest("Can you ring me"), true);
    assert.equal(looksLikeOutboundCallRequest("Can you ring me"), true);
  });

  it("keeps the trusted sender authoritative over a matching CRM name", async () => {
    const resolution = await resolveOutboundCallRequest({
      authoritativeRecipient: true,
      contactName: "David Barker",
      contacts: [
        contact({
          id: "overlapping-crm-contact",
          name: "David Barker",
          phone: "+15855221939",
        }),
      ],
      instructions: "Call the Kyro user and continue the conversation.",
      phoneNumber: "+15755712705",
      prompt: "Ring me - David your user",
      supabase: {} as SupabaseClient,
      workspaceId: "workspace-1",
    });

    assert.equal(resolution.status, "ready");
    assert.equal(resolution.contactId, null);
    assert.equal(resolution.contactName, "David Barker");
    assert.equal(resolution.phoneNumber, "+15755712705");
  });

  it("continues using CRM matching for a named external recipient", async () => {
    const resolution = await resolveOutboundCallRequest({
      contacts: [
        contact({
          id: "customer-david",
          name: "David Smith",
          phone: "+15855221939",
        }),
      ],
      instructions: "Ask whether Tuesday works for the quote.",
      prompt: "Call David Smith and ask whether Tuesday works for the quote",
      supabase: {} as SupabaseClient,
      workspaceId: "workspace-1",
    });

    assert.equal(resolution.status, "ready");
    assert.equal(resolution.contactId, "customer-david");
    assert.equal(resolution.phoneNumber, "+15855221939");
  });
});
