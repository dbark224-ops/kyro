import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteLineItem, type QuoteTemplate } from "../documents/templates";
import { outboundCallInstructionsFromPrompt } from "../voice/outbound-call-requests";
import {
  documentTemplateControlIntent,
  looksLikeWebSearchRequest,
  looksLikeImageFollowUpRequest,
  looksLikeInboundEmailAwarenessRequest,
  looksLikeQuoteHistoryRequest,
  looksLikeQuoteSendReadyListRequest,
  looksLikeQuoteSendRequest,
  resolveAssistantCommand,
  selectContactForAssistantPrompt,
  selectQuoteDraftForAssistantPrompt,
  selectQuoteTemplateForAssistantPrompt,
} from "./commands";
import type { ContactListItem, QuoteDraftListItem } from "../crm/queries";
import type { AssistantRecentMessage } from "./types";

function emptySupabase() {
  const query = {
    eq() {
      return this;
    },
    in() {
      return this;
    },
    limit() {
      return Promise.resolve({ data: [], error: null });
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    order() {
      return this;
    },
    select() {
      return this;
    },
    single() {
      return Promise.resolve({ data: null, error: null });
    },
  };

  return {
    from() {
      return query;
    },
  } as never;
}

function template(overrides: Partial<QuoteTemplate>): QuoteTemplate {
  return {
    description: "Reusable customer document",
    key: "template",
    label: "Template",
    lineItems: [quoteLineItem("Line item")],
    notes: "",
    ...overrides,
  };
}

function contact(overrides: Partial<ContactListItem>): ContactListItem {
  return {
    address: null,
    company: null,
    contactType: "customer",
    duplicateWarnings: [],
    email: null,
    id: "contact-1",
    lastMessageAt: null,
    lifecycleReason: null,
    lifecycleReviewedAt: null,
    lifecycleSource: "system",
    lifecycleStage: "lead",
    mergedIntoContactId: null,
    messageCount: 0,
    name: null,
    notes: null,
    phone: null,
    profileConflictContactIds: [],
    profileResolutionReason: null,
    profileResolutionStatus: "clear",
    source: null,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteDraftListItem>): QuoteDraftListItem {
  return {
    contact: null,
    conversation: null,
    createdAt: new Date(0).toISOString(),
    id: "quote-1",
    inquiryFacts: null,
    lead: null,
    lineItemCount: 1,
    lineItems: [quoteLineItem("Line item")],
    metadata: {},
    notes: null,
    status: "draft",
    title: "General Quote",
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("assistant document command helpers", () => {
  it("routes create/edit template prompts without stealing document settings prompts", () => {
    assert.equal(
      documentTemplateControlIntent("Create a premium invoice template"),
      "create",
    );
    assert.equal(
      documentTemplateControlIntent("Make the invoice template more premium"),
      "update",
    );
    assert.equal(
      documentTemplateControlIntent("Set quote template direction to premium"),
      null,
    );
  });

  it("selects a saved custom template by label rather than falling back to the first template", () => {
    const invoice = template({
      description: "Progress claim and payment request",
      key: "custom_invoice",
      label: "Invoice",
    });
    const bathroom = template({
      description: "Renovation quote structure",
      key: "bathroom_renovation",
      label: "Bathroom Renovation",
    });

    const selected = selectQuoteTemplateForAssistantPrompt(
      "Create an invoice document for Mikel",
      [bathroom, invoice],
    );

    assert.equal(selected.kind, "selected");
    assert.equal(selected.template?.key, "custom_invoice");
  });

  it("asks the user to choose when several templates exist and the request is generic", () => {
    const selected = selectQuoteTemplateForAssistantPrompt("Create a quote", [
      template({ key: "invoice", label: "Invoice" }),
      template({ key: "service_quote", label: "Service Quote" }),
    ]);

    assert.equal(selected.kind, "ambiguous");
    assert.equal(selected.template, null);
    assert.equal(selected.candidates.length, 2);
  });

  it("uses the only saved template for a generic create request", () => {
    const selected = selectQuoteTemplateForAssistantPrompt("Create a quote", [
      template({ key: "only_template", label: "Standard Quote" }),
    ]);

    assert.equal(selected.kind, "selected");
    assert.equal(selected.template?.key, "only_template");
  });

  it("matches an existing contact by name, company, or email when creating a document", () => {
    const contacts = [
      contact({
        company: "Brightside Plumbing",
        email: "hello@brightside.test",
        id: "brightside",
        name: "Mikel Bright",
      }),
      contact({
        company: "Canva",
        email: "accounts@canva.test",
        id: "canva",
        name: "Accounts",
      }),
    ];

    assert.equal(
      selectContactForAssistantPrompt(
        "Create an invoice document for Mikel Bright",
        contacts,
      )?.id,
      "brightside",
    );
    assert.equal(
      selectContactForAssistantPrompt(
        "Create a quote for accounts@canva.test",
        contacts,
      )?.id,
      "canva",
    );
  });

  it("recognises quote send and ready-list prompts without confusing ordinary quote creation", () => {
    assert.equal(
      looksLikeQuoteSendRequest("Send the bathroom quote to Sarah"),
      true,
    );
    assert.equal(
      looksLikeQuoteSendRequest(
        "Draft an email for this quote but do not send it",
      ),
      true,
    );
    assert.equal(looksLikeQuoteSendRequest("Create a quote for Sarah"), false);
    assert.equal(
      looksLikeQuoteSendRequest("Has the bathroom quote been sent?"),
      false,
    );
    assert.equal(
      looksLikeQuoteHistoryRequest("Has the bathroom quote been sent?"),
      true,
    );
    assert.equal(
      looksLikeQuoteHistoryRequest("Has Sarah approved the bathroom quote?"),
      true,
    );
    assert.equal(
      looksLikeQuoteHistoryRequest(
        "Did Sarah request changes to the bathroom quote?",
      ),
      true,
    );
    assert.equal(
      looksLikeQuoteSendReadyListRequest("What quotes are ready to send?"),
      true,
    );
  });

  it("recognises explicit public web search prompts without treating Kyro app data as web search", () => {
    assert.equal(
      looksLikeWebSearchRequest("Search the web for the latest QLD plumbing rule"),
      true,
    );
    assert.equal(
      looksLikeWebSearchRequest("What is the latest news about Brisbane weather?"),
      true,
    );
    assert.equal(
      looksLikeWebSearchRequest("What is the latest Kyro inbox status?"),
      false,
    );
  });

  it("selects the quote to send by customer, title, or email", () => {
    const quotes = [
      quote({
        contact: {
          address: null,
          company: null,
          email: "mikel@example.test",
          id: "contact-1",
          name: "Mikel",
          phone: null,
        },
        conversation: {
          id: "conversation-1",
          lastMessageAt: null,
          status: "open",
        },
        id: "quote-mikel",
        status: "ready",
        title: "Bathroom renovation quote",
      }),
      quote({
        contact: {
          address: null,
          company: "Canva",
          email: "accounts@canva.test",
          id: "contact-2",
          name: "Accounts",
          phone: null,
        },
        conversation: {
          id: "conversation-2",
          lastMessageAt: null,
          status: "open",
        },
        id: "quote-canva",
        status: "ready",
        title: "Subscription support quote",
      }),
    ];

    assert.equal(
      selectQuoteDraftForAssistantPrompt("Send the quote to Mikel", quotes)
        .quote?.id,
      "quote-mikel",
    );
    assert.equal(
      selectQuoteDraftForAssistantPrompt(
        "Prepare the quote email for accounts@canva.test",
        quotes,
      ).quote?.id,
      "quote-canva",
    );
  });

  it("asks the user to choose when a quote send request has no unique target", () => {
    const selection = selectQuoteDraftForAssistantPrompt("Send this quote", [
      quote({ id: "quote-1", title: "One" }),
      quote({ id: "quote-2", title: "Two" }),
    ]);

    assert.equal(selection.kind, "ambiguous");
    assert.equal(selection.quote, null);
    assert.equal(selection.candidates.length, 2);
  });
});

describe("assistant inbound email routing helpers", () => {
  it("routes email awareness questions without stealing work queue requests", () => {
    assert.equal(
      looksLikeInboundEmailAwarenessRequest("Did anyone email back today?"),
      true,
    );
    assert.equal(
      looksLikeInboundEmailAwarenessRequest("Show skipped emails from today"),
      true,
    );
    assert.equal(
      looksLikeInboundEmailAwarenessRequest("Show me leads needing reply"),
      false,
    );
  });
});

describe("assistant generated image follow-up helpers", () => {
  const recentImageMessages: AssistantRecentMessage[] = [
    {
      content: "I generated the image and saved it to Kyro files.",
      intent: "image_generation",
      role: "assistant",
      uiBlocks: [
        {
          images: [
            {
              alt: "Generated image",
              contentType: "image/png",
              downloadHref: "/api/files/11111111-1111-4111-8111-111111111111",
              editMode: false,
              fileId: "11111111-1111-4111-8111-111111111111",
              filename: "bathroom.png",
              href: "/api/files/11111111-1111-4111-8111-111111111111?disposition=inline",
              meta: "openai gpt-image-1",
              model: "gpt-image-1",
              prompt: "Create a luxury bathroom overlooking Sydney Harbour",
              provider: "openai",
              quality: "medium",
              referenceCount: 0,
              size: "1024x1024",
            },
          ],
          title: "Generated image",
          type: "generated_image",
        },
      ],
    },
  ];

  it("routes visual follow-ups against the previous generated image", () => {
    assert.equal(
      looksLikeImageFollowUpRequest(
        "can you make it night time",
        recentImageMessages,
      ),
      true,
    );
    assert.equal(
      looksLikeImageFollowUpRequest(
        "edit the image so it has warmer lighting",
        recentImageMessages,
      ),
      true,
    );
    assert.equal(
      looksLikeImageFollowUpRequest("where is it", recentImageMessages),
      false,
    );
  });
});

describe("outbound call request parsing", () => {
  it("strips the leading say verb from follow-up call instructions", () => {
    assert.equal(
      outboundCallInstructionsFromPrompt(
        "alright can you call david again and say we've actually moved it to monday 10:30 am",
      ),
      "we've actually moved it to monday 10:30 am",
    );
  });
});

describe("assistant LLM-first command routing", () => {
  it("treats a successful no-tool planner decision as general chat", async () => {
    const command = await resolveAssistantCommand({
      prompt: "do you think image generation will matter for trades businesses?",
      supabase: emptySupabase(),
      toolPlanModelPlanned: true,
      toolSelection: null,
      user: { id: "user-1" } as never,
      workspace: { id: "workspace-1", name: "WFA Plumbing" },
    });

    assert.equal(command.intent, "general_chat");
  });

  it("routes natural lead response requests to the work queue", async () => {
    const prompts = [
      "Do I have any open leads that need responding to?",
      "Show me my pending leads and inquiries that need a response",
      "What leads do I have that need responding to? Show me any pending or unresponsive leads in my CRM.",
    ];

    for (const prompt of prompts) {
      const command = await resolveAssistantCommand({
        prompt,
        supabase: emptySupabase(),
        user: { id: "user-1" } as never,
        workspace: { id: "workspace-1", name: "WFA Plumbing" },
      });

      assert.equal(command.intent, "work_queue");
    }
  });

  it("lets high-confidence work queue language override an incorrect general planner result", async () => {
    const command = await resolveAssistantCommand({
      prompt: "Have I got any leads that need responding to?",
      supabase: emptySupabase(),
      toolPlanModelPlanned: true,
      toolSelection: { name: "general_chat", prompt: "" },
      user: { id: "user-1" } as never,
      workspace: { id: "workspace-1", name: "WFA Plumbing" },
    });

    assert.equal(command.intent, "work_queue");
  });
});
