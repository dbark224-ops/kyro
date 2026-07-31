import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteLineItem, type QuoteTemplate } from "../documents/templates";
import { outboundCallInstructionsFromPrompt } from "../voice/outbound-call-requests";
import {
  calendarConversationReferenceFromRecentMessages,
  calendarDateRangeFromPrompt,
  calendarDateRangeFromPrompts,
  calendarLinkIntentFromPrompt,
  calendarOperationFromPrompts,
  looksLikeCalendarRequest,
  cleanCalendarTitle,
  looksLikeCalendarFollowUpRequest,
  parseAssistantCalendarTime,
  parseAssistantCalendarTimeFromPrompts,
} from "./calendar-intent";
import {
  documentTemplateControlIntent,
  looksLikeQuoteHistoryRequest,
  looksLikeQuoteSendReadyListRequest,
  looksLikeQuoteSendRequest,
  selectQuoteDraftForAssistantPrompt,
  selectQuoteTemplateForAssistantPrompt,
} from "./quote-intent";
import {
  inquiryLookupFallbackAnswerForAssistant,
  inquiryRecordForAssistant,
  looksLikeContextualInquiryReplyRequest,
  looksLikeInquiryAvailabilityOfferRequest,
  recentInquiryConversationForPrompt,
} from "./inquiry-intent";
import { looksLikeImageFollowUpRequest } from "./generated-image-intent";
import {
  assistantSmsBodyFromPrompt,
  looksLikeDirectWorkplaceSmsRequest,
} from "./sms-intent";
import {
  assistantDate,
  looksLikeWebSearchRequest,
  looksLikeActionExecutionRequest,
  looksLikeInboundEmailAwarenessRequest,
  resolveAssistantCommand,
  selfCallRecipientForAssistant,
  selectContactForAssistantPrompt,
} from "./commands";
import type {
  ContactListItem,
  ConversationListItem,
  QuoteDraftListItem,
} from "../crm/queries";
import type { AssistantRecentMessage } from "./types";

function emptySupabase() {
  const query = {
    eq() {
      return this;
    },
    in() {
      return this;
    },
    is() {
      return this;
    },
    limit() {
      return Promise.resolve({ data: [], error: null });
    },
    // Workspace lists page with .range() rather than a flat .limit().
    range() {
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
    addressValidationStatus: null,
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

function conversation(
  overrides: Partial<ConversationListItem>,
): ConversationListItem {
  return {
    activeActionTypes: [],
    approvedActionCount: 0,
    completedActionTypes: [],
    contactName: null,
    deletedAt: null,
    followUpDueAt: null,
    followUpIsDue: false,
    followUpTaskId: null,
    id: "conversation-1",
    inquiryFacts: null,
    lastMessageAt: new Date(0).toISOString(),
    latestActionStatus: null,
    latestActionType: null,
    latestBody: null,
    latestDirection: "inbound",
    latestSubject: null,
    leadNextStep: null,
    leadPriority: null,
    leadServiceType: null,
    leadTitle: null,
    nextActionLabel: "Reply to customer",
    originalInquiryAt: new Date(0).toISOString(),
    originalInquiryBody: null,
    pendingApprovalCount: 0,
    quoteDraftCount: 0,
    senderAddress: null,
    status: "new",
    workflowBucket: "needs_reply",
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
      looksLikeWebSearchRequest(
        "Search the web for the latest QLD plumbing rule",
      ),
      true,
    );
    assert.equal(
      looksLikeWebSearchRequest(
        "What is the latest news about Brisbane weather?",
      ),
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
  it("keeps the original calendar mutation after planner cleanup", () => {
    assert.equal(
      calendarOperationFromPrompts(
        "go to Home Depot and pay the account on Sunday 19 July 2026 at 11:00 AM, titled Home Depot - Pay account",
        "Can you create an event for me to go to Home Depot and pay that account too at 11am",
      ),
      "create",
    );
    assert.equal(
      calendarOperationFromPrompts(
        "Home Depot - Pay account on Sunday 19 July 2026 at 12:00 PM",
        "Move the Home Depot event to midday",
      ),
      "update",
    );
    assert.equal(
      calendarOperationFromPrompts(
        "Home Depot - Pay account on Sunday 19 July 2026",
        "Delete the Home Depot event",
      ),
      "delete",
    );
  });

  it("preserves a model-resolved create operation across short follow-ups", () => {
    assert.equal(
      calendarOperationFromPrompts(
        "Half day off on Friday, July 24, 2026 from 9:00 AM to 1:00 PM",
        "Between 9 and 1 as you said",
        [],
        "create",
      ),
      "create",
    );
  });

  it("recognizes natural time-blocking language as a create request", () => {
    assert.equal(
      calendarOperationFromPrompts(
        "Block out 4 hours on Friday for me",
        "Block out 4 hours on Friday for me",
      ),
      "create",
    );
  });

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
      calendarLinkIntentFromPrompt(
        "link this event to the current conversation",
      ),
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

  it("resolves calendar week and month ranges in the workspace timezone", () => {
    const now = new Date("2026-07-23T23:40:00.000Z");
    const options = { now, timeZone: "America/Denver" };

    assert.deepEqual(
      calendarDateRangeFromPrompt(
        "What's on the calendar for the rest of this week?",
        options,
      ),
      {
        dateLabel:
          "Thursday, July 23, 2026 through Sunday, July 26, 2026",
        from: "2026-07-23T06:00:00.000Z",
        timeZone: "America/Denver",
        to: "2026-07-27T06:00:00.000Z",
      },
    );
    assert.deepEqual(calendarDateRangeFromPrompt("this week", options), {
      dateLabel: "Monday, July 20, 2026 through Sunday, July 26, 2026",
      from: "2026-07-20T06:00:00.000Z",
      timeZone: "America/Denver",
      to: "2026-07-27T06:00:00.000Z",
    });
    assert.deepEqual(calendarDateRangeFromPrompt("next week", options), {
      dateLabel: "Monday, July 27, 2026 through Sunday, August 2, 2026",
      from: "2026-07-27T06:00:00.000Z",
      timeZone: "America/Denver",
      to: "2026-08-03T06:00:00.000Z",
    });
    assert.deepEqual(
      calendarDateRangeFromPrompt("the rest of this month", options),
      {
        dateLabel:
          "Thursday, July 23, 2026 through Friday, July 31, 2026",
        from: "2026-07-23T06:00:00.000Z",
        timeZone: "America/Denver",
        to: "2026-08-01T06:00:00.000Z",
      },
    );
    assert.deepEqual(calendarDateRangeFromPrompt("this month", options), {
      dateLabel: "Wednesday, July 1, 2026 through Friday, July 31, 2026",
      from: "2026-07-01T06:00:00.000Z",
      timeZone: "America/Denver",
      to: "2026-08-01T06:00:00.000Z",
    });
    assert.deepEqual(calendarDateRangeFromPrompt("next month", options), {
      dateLabel: "Saturday, August 1, 2026 through Monday, August 31, 2026",
      from: "2026-08-01T06:00:00.000Z",
      timeZone: "America/Denver",
      to: "2026-09-01T06:00:00.000Z",
    });
    assert.deepEqual(calendarDateRangeFromPrompt("during August", options), {
      dateLabel: "Saturday, August 1, 2026 through Monday, August 31, 2026",
      from: "2026-08-01T06:00:00.000Z",
      timeZone: "America/Denver",
      to: "2026-09-01T06:00:00.000Z",
    });
  });

  it("keeps the user's calendar range when a tool plan rewrites it as today", () => {
    assert.deepEqual(
      calendarDateRangeFromPrompts(
        "Show calendar events today",
        "What about the rest of the week?",
        "America/Denver",
        new Date("2026-07-23T23:40:00.000Z"),
      ),
      {
        dateLabel:
          "Thursday, July 23, 2026 through Sunday, July 26, 2026",
        from: "2026-07-23T06:00:00.000Z",
        timeZone: "America/Denver",
        to: "2026-07-27T06:00:00.000Z",
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
    assert.equal(parsed?.durationMinutes, 90);
    assert.equal(parsed?.durationSource, "default");
    assert.equal(parsed?.timeZone, "America/Denver");
  });

  it("uses an explicit calendar duration instead of the workspace default", () => {
    const parsed = parseAssistantCalendarTime(
      "Add a supplier call on July 14 2026 at 2pm for 30 minutes",
      {
        defaultDurationMinutes: 60,
        timeZone: "America/Denver",
      },
    );

    assert.equal(parsed?.startsAt, "2026-07-14T20:00:00.000Z");
    assert.equal(parsed?.endsAt, "2026-07-14T20:30:00.000Z");
    assert.equal(parsed?.durationMinutes, 30);
    assert.equal(parsed?.durationSource, "prompt");
  });

  it("understands natural hour durations without requiring a location", () => {
    const parsed = parseAssistantCalendarTime(
      "Create a planning meeting tomorrow at 10am for an hour and a half",
      {
        defaultDurationMinutes: 60,
        now: new Date("2026-07-18T18:00:00.000Z"),
        timeZone: "America/Denver",
      },
    );

    assert.equal(parsed?.startsAt, "2026-07-19T16:00:00.000Z");
    assert.equal(parsed?.endsAt, "2026-07-19T17:30:00.000Z");
    assert.equal(parsed?.durationMinutes, 90);
    assert.equal(parsed?.durationSource, "prompt");
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

  it("resolves call me to the signed-in account user's saved phone", () => {
    const recipient = selfCallRecipientForAssistant({
      prompt: "Can you call me",
      user: {
        id: "user-1",
        user_metadata: {
          first_name: "David",
          last_name: "Barker",
          phone: "+15755712705",
        },
      } as never,
    });

    assert.deepEqual(recipient, {
      displayName: "David Barker",
      firstName: "David",
      phoneNumber: "+15755712705",
    });
  });

  it("keeps the authenticated messaging sender authoritative for call me", () => {
    const recipient = selfCallRecipientForAssistant({
      actor: {
        displayName: "David Barker",
        firstName: "David",
        kind: "trusted_internal_messaging_sender",
        phoneNumber: "+15755712705",
        role: "Owner",
        userId: "user-1",
      },
      prompt: "Ring me",
      user: {
        id: "user-1",
        user_metadata: {
          phone: "+15855221939",
        },
      } as never,
    });

    assert.equal(recipient?.phoneNumber, "+15755712705");
  });
});

describe("assistant LLM-first command routing", () => {
  it("passes the real inbound inquiry text into exact-match assistant context", () => {
    const item = conversation({
      contactName: "+1575855239",
      latestBody: "Hi - Where are you guys based?",
      latestSubject: "SMS enquiry from +1575855239",
      originalInquiryBody: "Hi - Where are you guys based?",
      senderAddress: "+1575855239",
    });

    assert.deepEqual(inquiryRecordForAssistant(item), {
      customer: "+1575855239",
      inquiryMessage: "Hi - Where are you guys based?",
      job: "General inquiry",
      latestMessage: "Hi - Where are you guys based?",
      latestMessageDirection: "inbound",
      nextAction: "Reply to customer",
      operatorSummary:
        "The +1575855239 inquiry has an inbound message and still needs a reply.",
      replyStatus: "needs_reply",
      senderAddress: "+1575855239",
      status: "new",
      subject: "SMS enquiry from +1575855239",
      workflowBucket: "needs_reply",
    });
    assert.equal(
      inquiryLookupFallbackAnswerForAssistant(item),
      'The inquiry says: "Hi - Where are you guys based?" The +1575855239 inquiry has an inbound message and still needs a reply.',
    );
  });

  it("selects the named inquiry from a recently listed work queue", () => {
    assert.deepEqual(
      recentInquiryConversationForPrompt({
        conversationIds: ["mikel", "jason"],
        conversations: [
          { contactName: "Mikelmerino", id: "mikel" },
          { contactName: "Jason123", id: "jason" },
        ],
        prompt: "Reply to Mikelmerino saying we can come by Tuesday at 10am",
      }),
      {
        ambiguous: false,
        conversationId: "mikel",
        matches: ["mikel"],
      },
    );
  });

  it("matches an email-backed inquiry by its local part without inventing a contact name", () => {
    assert.deepEqual(
      recentInquiryConversationForPrompt({
        conversationIds: ["mikel", "jason"],
        conversations: [
          { contactName: "mikelmarino@gmail.com", id: "mikel" },
          { contactName: "jason123@gmail.com", id: "jason" },
        ],
        prompt: "Reply to Mikelmarino saying we can come Tuesday at 10am",
      }),
      {
        ambiguous: false,
        conversationId: "mikel",
        matches: ["mikel"],
      },
    );
  });

  it("does not guess when the named customer has several recent inquiries", () => {
    assert.deepEqual(
      recentInquiryConversationForPrompt({
        conversationIds: ["mikel-one", "mikel-two"],
        conversations: [
          { contactName: "Mikelmerino", id: "mikel-one" },
          { contactName: "Mikelmerino", id: "mikel-two" },
        ],
        prompt: "Reply to Mikelmerino saying Tuesday at 10am works",
      }),
      {
        ambiguous: true,
        conversationId: null,
        matches: ["mikel-one", "mikel-two"],
      },
    );
  });

  it("recognizes a natural reply instruction after a fresh inquiry briefing", () => {
    const recentMessages: AssistantRecentMessage[] = [
      {
        content: "New email inquiry from Mikel.",
        createdAt: new Date().toISOString(),
        intent: "work_queue",
        links: [
          {
            href: "/inbox?conversationId=conversation-1",
            label: "Mikel",
          },
        ],
        role: "assistant",
      },
    ];

    assert.equal(
      looksLikeContextualInquiryReplyRequest(
        "Can you reply for me, tell him we can come around 10am Tuesday",
        recentMessages,
      ),
      true,
    );
    assert.equal(
      looksLikeContextualInquiryReplyRequest(
        "What should I reply to him?",
        recentMessages,
      ),
      false,
    );
  });

  it("does not bind pronouns to an old inquiry briefing", () => {
    const recentMessages: AssistantRecentMessage[] = [
      {
        content: "New email inquiry from Mikel.",
        createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
        intent: "work_queue",
        links: [
          {
            href: "/inbox?conversationId=conversation-1",
            label: "Mikel",
          },
        ],
        role: "assistant",
      },
    ];

    assert.equal(
      looksLikeContextualInquiryReplyRequest(
        "Can you reply for me and tell him Tuesday works?",
        recentMessages,
      ),
      false,
    );
  });

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

  it("keeps calendar availability offers out of generic action execution", () => {
    const prompts = [
      "Yes we can do that - just offer a time next week we have free",
      "Check our availability for next week and identify a free time we can offer.",
      "Propose an available slot to the customer.",
    ];

    for (const prompt of prompts) {
      assert.equal(
        looksLikeInquiryAvailabilityOfferRequest(prompt),
        true,
        prompt,
      );
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
      prompt:
        "do you think image generation will matter for trades businesses?",
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

/**
 * Measured on seventeen fresh ways of asking for each calendar operation, and
 * eight routed correctly.
 *
 * Six of the misses fell through to "read", which is the safe way to be wrong
 * -- Kyro looks at the calendar instead of changing it. One did not: "put the
 * appointment back an hour" routed to CREATE, because "put" is a create word
 * and create is tested before update. A customer asking to move a visit would
 * have been given a second visit alongside the first.
 *
 * That is the whole reason the reposition check runs first: moving something
 * that already exists is an update however it is phrased.
 */
describe("what a customer means by a calendar request", () => {
  const op = (prompt: string) =>
    calendarOperationFromPrompts(prompt, prompt, [], null);

  it("moves an existing appointment rather than making a second one", () => {
    for (const prompt of [
      "put the appointment back an hour",
      "can you move my appointment to Thursday",
      "I need to push Tuesday back a week",
      "can we shift the visit to the afternoon",
      "change my booking to Friday please",
      "something's come up, can we do another day",
      "bring it forward if you can",
    ]) {
      assert.equal(op(prompt), "update", prompt);
    }
  });

  it("hears a visit being called off", () => {
    for (const prompt of [
      "cancel my appointment please",
      "I need to call off Thursday's visit",
      "scrap the Tuesday booking",
      "we won't need you on Friday after all",
      "it's not going ahead I'm afraid",
    ]) {
      assert.equal(op(prompt), "delete", prompt);
    }
  });

  it("still books when booking is what was asked for", () => {
    // "Book another day next month as well" is the counterweight to the
    // "another day" rule added for rescheduling: it is a second booking, not
    // a move, and must not become an update.
    for (const prompt of [
      "book me in for Tuesday morning",
      "can you put me down for the 14th",
      "stick me in the diary for next week",
      "I'd like to arrange a visit",
      "could you pencil me in for Friday",
      "book another day next month as well",
    ]) {
      assert.equal(op(prompt), "create", prompt);
    }
  });

  it("only reads when nothing is being changed", () => {
    for (const prompt of [
      "what have I got on Thursday",
      "what's in the diary tomorrow",
      "read me my appointments",
      "is Tuesday free",
      "how many jobs have I got this week",
    ]) {
      assert.equal(op(prompt), "read", prompt);
    }
  });
});

/**
 * The fallback that decides a message is about the diary, measured on sixteen
 * fresh calendar requests: it caught four.
 *
 * Worth stating plainly, because the number reads worse than it is: this is
 * NOT the gate it looks like. resolveAssistantCommand runs the planned command
 * first and only reaches this when the planner selected no tool, so a miss
 * costs a backstop rather than the calendar path.
 *
 * The second clause is why it scored so low: it wants a calendar VERB and a
 * calendar NOUN in the same sentence, and half of what people say has only
 * one. "Is Tuesday free" has no verb, "clear my afternoon" has no noun, and
 * "when are you coming out" has neither.
 *
 * Widened rather than loosened. It had no false positives to begin with, and
 * that is the half worth protecting -- a wrong hit sends a boiler question to
 * the diary.
 */
describe("recognising a message about the diary without the planner", () => {
  it("hears the request however it is phrased", () => {
    for (const prompt of [
      "book me in for Tuesday morning",
      "stick me in the diary for next week",
      "could you pencil me in for Friday",
      "I'd like to arrange a visit",
      "is Tuesday free",
      "is the 14th free",
      "are you free tomorrow",
      "am I free at 3 on Wednesday",
      "what's in the diary tomorrow",
      "what have I got on Thursday",
      "when are you coming out",
      "what time is the visit",
      "can we do another day",
      "clear my afternoon",
    ]) {
      assert.equal(looksLikeCalendarRequest(prompt), true, prompt);
    }
  });

  it("does not send everything else to the calendar", () => {
    // "Free" is the word that made this hard: availability and price share it.
    // "The estimate is free" is the same four words as "is Tuesday free" with
    // a different subject, and only the presence of a day tells them apart --
    // which is why "delivery is free on orders over 50" needed the date rule
    // tightened to require an ordinal, or "50" read as the fiftieth.
    for (const prompt of [
      "how much for a new boiler",
      "what's your number",
      "the tap is still dripping",
      "can you send me the invoice",
      "who did the work last time",
      "do you cover Rio Rancho",
      "I'd like a quote for a bathroom",
      "the boiler is free of leaks now",
      "is the part free of charge",
      "the estimate is free",
      "is the quote free",
      "delivery is free on orders over 50",
      "the callout is free if you go ahead",
      "can you clear the blockage",
      "my kitchen is flooding",
    ]) {
      assert.equal(looksLikeCalendarRequest(prompt), false, prompt);
    }
  });
});

/**
 * The router that approves and sends every pending draft reply, measured on
 * six real instructions and ten sentences that are not.
 *
 * Three of the six missed, including "send the approved replies" -- the
 * plainest way to ask -- because "approved" was not an allowed adjective in
 * the target pattern. Only "pending" was, in the router whose command is
 * called executeApprovedWorkQueueReplies.
 *
 * The one that mattered ran the other way. "Don't send those yet" FIRED, and
 * this path calls approveAction and then executeAction on every pending item.
 * The one sentence whose entire purpose is to stop a send was the sentence
 * that performed it -- an explicit refusal carried out as a command, on the
 * highest-consequence router in the assistant.
 */
describe("sending the approved replies, and being told not to", () => {
  it("acts on a real instruction", () => {
    for (const prompt of [
      "send the approved replies",
      "go ahead and send them",
      "action the work queue",
      "handle the approved items",
      "send them all out please",
      "deal with the approved replies now",
      "approve and send the pending drafts",
      "sort the outstanding replies",
      "take care of the pending replies",
      "send all the queued messages",
      "do it",
    ]) {
      assert.equal(looksLikeActionExecutionRequest(prompt), true, prompt);
    }
  });

  it("never sends when told not to", () => {
    // The half worth keeping. Every one of these either refuses the send or
    // asks about it, and every one of them would have been a message to a
    // customer.
    for (const prompt of [
      "don't send those yet",
      "hold off on the approved replies",
      "wait before you send anything",
      "not yet please",
      "let me check them before you send",
      "I'll review the approved replies first",
    ]) {
      assert.equal(looksLikeActionExecutionRequest(prompt), false, prompt);
    }
  });

  it("does not treat a question as an instruction", () => {
    for (const prompt of [
      "did you send the approved replies",
      "have the approved replies gone out",
      "was that reply sent to the customer",
      "why were those replies approved",
      "what's in the work queue",
      "show me the approved replies",
      "how many are waiting to be sent",
    ]) {
      assert.equal(looksLikeActionExecutionRequest(prompt), false, prompt);
    }
  });
});

/**
 * "Yes, but not yet" is not yes.
 *
 * The last of the three paths in the assistant that send without approval --
 * this one calls approveAction and then executeAction on a draft reply, so
 * whatever it decides goes to the customer.
 *
 * Outright refusals were already handled: "don't reply", "hold off", "wait
 * before you reply" and "did you reply" all fall through correctly. What
 * nothing read was a reply asked for CONDITIONALLY. Three of nine measured
 * sent the message:
 *
 *   "reply to him but let me see it first"
 *   "can you reply to him later, not now"
 *   "can you reply to him once I've checked it"
 *
 * That phrasing is what an owner says while they are still learning to trust
 * the thing, which makes it the worst possible sentence to get wrong.
 */
describe("replying to a customer, and being asked to wait", () => {
  const recentMessages: AssistantRecentMessage[] = [
    {
      content: "New email inquiry from Mikel.",
      createdAt: new Date().toISOString(),
      intent: "work_queue",
      links: [{ href: "/inbox?conversationId=conversation-1", label: "Mikel" }],
      role: "assistant",
    },
  ];
  const call = (prompt: string) =>
    looksLikeContextualInquiryReplyRequest(prompt, recentMessages);

  it("still sends when plainly told to", () => {
    for (const prompt of [
      "Can you reply for me, tell him we can come around 10am Tuesday",
      "please reply and say we'll be there Thursday",
      "reply for me",
      "can you respond to him saying yes",
      "tell him we can do it next week",
    ]) {
      assert.equal(call(prompt), true, prompt);
    }
  });

  it("never sends when the owner wants to see it first", () => {
    for (const prompt of [
      "reply to him but let me see it first",
      "can you reply to him later, not now",
      "can you reply to him once I've checked it",
      "reply to him after I've reviewed it",
    ]) {
      assert.equal(call(prompt), false, prompt);
    }
  });

  it("keeps refusing the outright refusals it already refused", () => {
    for (const prompt of [
      "don't reply to him yet",
      "please don't respond to that one",
      "never reply to him without asking me",
      "hold off, don't email him back",
      "wait before you reply",
      "did you reply to him",
      "what should I reply to him",
    ]) {
      assert.equal(call(prompt), false, prompt);
    }
  });
});

/**
 * "No worries I will sort it out" would have sent every pending reply.
 *
 * Found by replaying this router over 291 real owner prompts rather than over
 * phrasings I invented. "Sort it" is an execution target and nothing read who
 * was doing the sorting, so the owner standing down to handle it themselves
 * was read as instructing Kyro to handle it -- and this path approves and
 * executes every pending draft reply to customers.
 *
 * The counterweight sweep that found it is worth repeating after any widening:
 * replay the changed router over the real corpus and read every prompt it now
 * catches. Four of the 291 fire, and all four are genuine.
 */
describe("the owner saying they will do it themselves", () => {
  it("never executes on the owner's behalf", () => {
    for (const prompt of [
      "No worries I will sort it out",
      "I'll sort it out",
      "I'll handle it",
      "we'll deal with those",
      "I can take care of it",
      "I'm going to reply myself",
    ]) {
      assert.equal(looksLikeActionExecutionRequest(prompt), false, prompt);
    }
  });

  it("still acts on the real instructions from the same corpus", () => {
    // These four are every prompt out of 291 that fires, verbatim.
    for (const prompt of [
      "Send it.",
      "Yeah send it",
      "can you action both of those",
      "can you action both please",
    ]) {
      assert.equal(looksLikeActionExecutionRequest(prompt), true, prompt);
    }
  });
});
