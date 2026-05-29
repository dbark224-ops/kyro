import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSkippedEmailSummaryItems, contactSearchFilter } from "./queries";

describe("contactSearchFilter", () => {
  it("builds a bounded multi-field contact typeahead filter", () => {
    assert.equal(
      contactSearchFilter("  Daniel Barker  "),
      [
        "name.ilike.%Daniel Barker%",
        "company.ilike.%Daniel Barker%",
        "email.ilike.%Daniel Barker%",
        "phone.ilike.%Daniel Barker%",
        "address.ilike.%Daniel Barker%",
        "normalized_company.ilike.%daniel barker%",
      ].join(","),
    );
  });

  it("requires enough text and strips filter delimiters", () => {
    assert.equal(contactSearchFilter("d"), null);
    assert.equal(
      contactSearchFilter("daniel,barker%_"),
      [
        "name.ilike.%daniel barker%",
        "company.ilike.%daniel barker%",
        "email.ilike.%daniel barker%",
        "phone.ilike.%daniel barker%",
        "address.ilike.%daniel barker%",
        "normalized_company.ilike.%daniel barker%",
      ].join(","),
    );
  });

  it("adds normalized identity filters where possible", () => {
    assert.equal(
      contactSearchFilter("0474 783 952"),
      [
        "name.ilike.%0474 783 952%",
        "company.ilike.%0474 783 952%",
        "email.ilike.%0474 783 952%",
        "phone.ilike.%0474 783 952%",
        "address.ilike.%0474 783 952%",
        "normalized_phone.eq.+61474783952",
        "normalized_company.ilike.%0474 783 952%",
      ].join(","),
    );
  });
});

describe("buildSkippedEmailSummaryItems", () => {
  it("maps skipped email classification into reviewable summary rows", () => {
    const [item] = buildSkippedEmailSummaryItems([
      {
        created_at: "2026-05-21T00:00:00.000Z",
        id: "evt_1",
        payload: {
          classification: {
            category: "newsletter_or_automated",
            confidence: 0.82,
            providerUsed: "heuristic",
            reason: "Automated billing email.",
            summary: "Canva payment failed.",
          },
          accountEmail: "owner@example.com",
          externalMessageId: "gmail_msg_1",
          fromEmail: "billing@example.com",
          provider: "google",
          receivedAt: "2026-05-21T01:00:00.000Z",
          subject: "Action required",
        },
        processed_at: "2026-05-21T01:01:00.000Z",
        source: "gmail",
      },
    ]);

    assert.equal(item.accountEmail, "owner@example.com");
    assert.equal(item.category, "newsletter_or_automated");
    assert.equal(item.classificationProvider, "heuristic");
    assert.equal(item.confidence, 0.82);
    assert.equal(item.externalMessageId, "gmail_msg_1");
    assert.equal(item.fromEmail, "billing@example.com");
    assert.equal(item.provider, "google");
    assert.equal(item.reason, "Automated billing email.");
    assert.equal(item.summary, "Canva payment failed.");
    assert.equal(item.replyCount, 0);
  });

  it("merges Kyro reply logs without relying on Gmail sent state", () => {
    const [item] = buildSkippedEmailSummaryItems(
      [
        {
          id: "evt_1",
          payload: {
            classification: { category: "business_reference" },
            subject: "Product update",
          },
          processed_at: "2026-05-21T01:01:00.000Z",
          source: "gmail",
        },
      ],
      [
        {
          id: "reply_2",
          payload: {
            originalEventId: "evt_1",
            sentAt: "2026-05-21T02:00:00.000Z",
            subject: "Re: Product update latest",
          },
          processed_at: "2026-05-21T02:00:00.000Z",
        },
        {
          id: "reply_1",
          payload: {
            originalEventId: "evt_1",
            sentAt: "2026-05-21T01:30:00.000Z",
            subject: "Re: Product update older",
          },
          processed_at: "2026-05-21T01:30:00.000Z",
        },
        {
          id: "reply_other",
          payload: { originalEventId: "evt_other" },
          processed_at: "2026-05-21T03:00:00.000Z",
        },
      ],
    );

    assert.equal(item.replyCount, 2);
    assert.equal(item.lastReplySubject, "Re: Product update latest");
    assert.equal(item.lastRepliedAt, "2026-05-21T02:00:00.000Z");
  });
});
