import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteLineItem, type QuoteTemplate } from "../documents/templates";
import { outboundCallInstructionsFromPrompt } from "../voice/outbound-call-requests";
import {
  assistantSmsBodyFromPrompt,
  assistantDate,
  calendarDateRangeFromPrompt,
  calendarConversationReferenceFromRecentMessages,
  calendarLinkIntentFromPrompt,
  cleanCalendarTitle,
  documentTemplateControlIntent,
  looksLikeCalendarFollowUpRequest,
  looksLikeWebSearchRequest,
  looksLikeImageFollowUpRequest,
  looksLikeActionExecutionRequest,
  looksLikeInboundEmailAwarenessRequest,
  looksLikeQuoteHistoryRequest,
  looksLikeQuoteSendReadyListRequest,
  looksLikeQuoteSendRequest,
  looksLikeDirectWorkplaceSmsRequest,
  parseAssistantCalendarTime,
  parseAssistantCalendarTimeFromPrompts,
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

describe("assistant calendar helpers", () => {
  it("does not infer contact links from ordinary event titles", () => {
    assert.deepEqual(
      calendarLinkIntentFromPrompt(
        "can you create an event for a meeting with Starbucks on Friday at 10am",
      ),
      {
        allowNamedContact: false,
        allowRecentConversation: false,
      },
    );
    assert.deepEqual(
      calendarLinkIntentFromPrompt("create an event for David Barker tomorrow"),
      {
        allowNamedContact: false,
        allowRecentConversation: false,
      },
    );
  });

  it("allows calendar links only when the user explicitly asks for CRM context", () => {
    assert.deepEqual(
      calendarLinkIntentFromPrompt(
        "create a quote visit for this customer tomorrow at 10",
      ),
      {
        allowNamedContact: false,
        allowRecentConversation: true,
      },
    );
    assert.deepEqual(
      calendarLinkIntentFromPrompt(
        "create an event and attach it to contact David Barker",
      ),
      {
        allowNamedContact: true,
        allowRecentConversation: false,
      },
    );
    assert.deepEqual(
      calendarLinkIntentFromPrompt("link this event to the current conversation"),
      {
        allowNamedContact: false,
        allowRecentConversation: true,
      },
    );
  });

  it("only treats fresh conversation cards as implicit calendar context", () => {
    const conversationCard: AssistantRecentMessage = {
      content: "Here is the current inquiry.",
      createdAt: "2026-07-12T10:00:00.000Z",
      role: "assistant",
      uiBlocks: [
        {
          links: [
            {
              href: "/inbox/conversation-1",
              label: "David Barker",
            },
          ],
          title: "Inquiry",
          type: "link_cards",
        },
      ],
    };

    assert.deepEqual(
      calendarConversationReferenceFromRecentMessages([
        conversationCard,
        {
          content: "Book this customer for tomorrow at 10am",
          createdAt: "2026-07-12T10:20:00.000Z",
          role: "user",
        },
      ]),
      {
        conversationId: "conversation-1",
        createdAt: "2026-07-12T10:00:00.000Z",
        label: "David Barker",
      },
    );

    assert.equal(
      calendarConversationReferenceFromRecentMessages([
        conversationCard,
        {
          content: "Book this customer for tomorrow at 10am",
          createdAt: "2026-07-12T12:00:00.000Z",
          role: "user",
        },
      ]),
      null,
    );
  });

  it("only finalizes calendar drafts when a recent calendar card exists", () => {
    const calendarCard: AssistantRecentMessage = {
      content: "I drafted the event.",
      createdAt: "2026-07-12T10:00:00.000Z",
      role: "assistant",
      uiBlocks: [
        {
          links: [
            {
              href: "/calendar?event=event-1",
              label: "Meeting with Starbucks",
            },
          ],
          title: "Calendar draft",
          type: "link_cards",
        },
      ],
    };

    assert.equal(
      looksLikeCalendarFollowUpRequest("finalize it", [calendarCard]),
      true,
    );
    assert.equal(looksLikeCalendarFollowUpRequest("finalize it", []), false);
    assert.equal(
      looksLikeCalendarFollowUpRequest(
        "create an event for a meeting with Starbucks on Friday at 10am",
        [calendarCard],
      ),
      false,
    );
  });

  it("cleans command wording from assistant-created calendar titles", () => {
    assert.equal(
      cleanCalendarTitle(
        "can you create an event for a meeting with Starbucks on Friday at 10am",
        null,
      ),
      "Meeting - Starbucks",
    );
    assert.equal(
      cleanCalendarTitle(
        "can you add a meeting with NMSU on the 2nd August at 10am",
        null,
      ),
      "Meeting - NMSU",
    );
    assert.equal(
      cleanCalendarTitle(
        "can you add a calendar event a meeting at the NM MVD on the 2nd of August at 2pm",
        null,
      ),
      "Meeting - NM MVD",
    );
    assert.equal(
      cleanCalendarTitle(
        "please schedule a quote visit with David next Tuesday at 2pm",
        null,
      ),
      "Quote visit with David",
    );
    assert.equal(
      cleanCalendarTitle(
        "book a site inspection for Jane on July 14 2026 at 2pm",
        null,
      ),
      "Site inspection for Jane",
    );
    assert.equal(
      cleanCalendarTitle(
        'Create a calendar event for Saturday July 25 2026 at 9:00 am titled "Sponsor event"',
        null,
      ),
      "Sponsor event",
    );
    assert.equal(
      cleanCalendarTitle(
        "Can you create a calendar event Saturday 25th of July at 9am, it's a sponsor event",
        null,
      ),
      "Sponsor event",
    );
  });

  it("resolves exact calendar lookup days in the workspace timezone", () => {
    assert.deepEqual(
      calendarDateRangeFromPrompt("Do I have any events on 2nd of August?", {
        now: new Date("2026-07-17T18:00:00.000Z"),
        timeZone: "America/Denver",
      }),
      {
        dateLabel: "Sunday, August 2, 2026",
        from: "2026-08-02T06:00:00.000Z",
        timeZone: "America/Denver",
        to: "2026-08-03T06:00:00.000Z",
      },
    );
    assert.deepEqual(
      calendarDateRangeFromPrompt("What is on my calendar August 3?", {
        now: new Date("2026-07-17T18:00:00.000Z"),
        timeZone: "America/Denver",
      }),
      {
        dateLabel: "Monday, August 3, 2026",
        from: "2026-08-03T06:00:00.000Z",
        timeZone: "America/Denver",
        to: "2026-08-04T06:00:00.000Z",
      },
    );
  });

  it("resolves tomorrow from the workspace date across UTC midnight", () => {
    const now = new Date("2026-07-19T03:31:00.000Z");
    const prompt = "Add an event tomorrow 19th July 2026 at 9am";
    const parsed = parseAssistantCalendarTime(prompt, {
      defaultDurationMinutes: 60,
      now,
      timeZone: "America/Denver",
    });
    const range = calendarDateRangeFromPrompt(prompt, {
      now,
      timeZone: "America/Denver",
    });

    assert.equal(parsed?.startsAt, "2026-07-19T15:00:00.000Z");
    assert.equal(parsed?.endsAt, "2026-07-19T16:00:00.000Z");
    assert.equal(range?.dateLabel, "Sunday, July 19, 2026");
    assert.equal(range?.from, "2026-07-19T06:00:00.000Z");
    assert.equal(range?.to, "2026-07-20T06:00:00.000Z");
  });

  it("falls back to the linked contact when the prompt only contains generic calendar words", () => {
    assert.equal(
      cleanCalendarTitle(
        "put an appointment in the calendar tomorrow at 10am",
        contact({ name: "Daryl" }),
      ),
      "Appointment with Daryl",
    );
  });

  it("parses explicit local calendar dates in the workspace timezone", () => {
    const parsed = parseAssistantCalendarTime(
      "Add a quote visit on July 14 2026 at 2pm",
      {
        defaultDurationMinutes: 90,
        timeZone: "America/Denver",
      },
    );

    assert.equal(parsed?.startsAt, "2026-07-14T20:00:00.000Z");
    assert.equal(parsed?.endsAt, "2026-07-14T21:30:00.000Z");
    assert.equal(parsed?.timeZone, "America/Denver");
  });

  it("formats assistant calendar confirmations in the workspace timezone", () => {
    const formatted = assistantDate(
      "2026-08-03T15:00:00.000Z",
      "America/Denver",
    );

    assert.match(formatted, /9:00\sAM/);
    assert.doesNotMatch(formatted, /3:00\sPM/);
  });

  it("falls back to the original user prompt when planner cleanup drops calendar timing", () => {
    const parsed = parseAssistantCalendarTimeFromPrompts(
      "meeting with NMSU",
      "can you add a meeting with NMSU on the 2nd August 2026 at 10am",
      {
        defaultDurationMinutes: 60,
        timeZone: "America/Denver",
      },
    );

    assert.equal(parsed?.startsAt, "2026-08-02T16:00:00.000Z");
    assert.equal(parsed?.endsAt, "2026-08-02T17:00:00.000Z");
  });

  it("treats bare early afternoon hours as PM for natural scheduling prompts", () => {
    const parsed = parseAssistantCalendarTime(
      "Book the site visit on July 14 2026 at 2",
      {
        defaultDurationMinutes: 60,
        timeZone: "America/Denver",
      },
    );

    assert.equal(parsed?.startsAt, "2026-07-14T20:00:00.000Z");
    assert.equal(parsed?.assumedMeridiem, "pm");
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
  it("detects clear follow-up requests to execute listed work queue actions", () => {
    const positivePrompts = [
      "please action both",
      "send them",
      "approve all the pending replies",
      "can you handle these leads",
      "deal with the queue",
    ];

    const negativePrompts = [
      "what action should I take",
      "show me the leads that need replies",
      "which messages are pending",
      "can you send the primary workplace contact an sms, i want to test if that functionality is working",
    ];

    for (const prompt of positivePrompts) {
      assert.equal(looksLikeActionExecutionRequest(prompt), true, prompt);
    }

    for (const prompt of negativePrompts) {
      assert.equal(looksLikeActionExecutionRequest(prompt), false, prompt);
    }
  });

  it("recognizes direct workplace SMS instructions without treating them as pending replies", () => {
    const prompts = [
      "can you send the primary workplace contact an sms, i want to test if that functionality is working",
      "can you send the primary workplace escalation contact an sms, i want to test if that functionality is working",
      "text the primary escalation workplace contact to test SMS",
      "send our internal staff contact a text message",
    ];

    for (const prompt of prompts) {
      assert.equal(looksLikeDirectWorkplaceSmsRequest(prompt), true, prompt);
      assert.equal(looksLikeActionExecutionRequest(prompt), false, prompt);
    }

    assert.equal(
      assistantSmsBodyFromPrompt(prompts[0]),
      "This is a test SMS from Kyro.",
    );
    assert.equal(
      assistantSmsBodyFromPrompt(
        'Send the primary workplace contact an SMS saying "The supplier is here."',
      ),
      "The supplier is here.",
    );
  });

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
