import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createQuoteApprovalToken,
  hashQuoteApprovalToken,
  isQuoteApprovalLinkExpired,
  quoteApprovalPublicUrl,
} from "./approval";

describe("quote approval links", () => {
  it("creates URL-safe bearer tokens and hashes them for storage", () => {
    const token = createQuoteApprovalToken();
    const hash = hashQuoteApprovalToken(token);

    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(hash.length, 64);
    assert.equal(hashQuoteApprovalToken(token), hash);
    assert.notEqual(hash, token);
  });

  it("uses the configured public app URL for customer approval links", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;

    process.env.NEXT_PUBLIC_APP_URL = "https://kyro.example.com/";

    assert.equal(
      quoteApprovalPublicUrl("abc_123"),
      "https://kyro.example.com/quote/approve/abc_123",
    );

    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it("detects expired approval links", () => {
    assert.equal(
      isQuoteApprovalLinkExpired(
        { expiresAt: "2026-05-23T00:00:00.000Z" },
        new Date("2026-05-24T00:00:00.000Z"),
      ),
      true,
    );
    assert.equal(
      isQuoteApprovalLinkExpired(
        { expiresAt: "2026-05-25T00:00:00.000Z" },
        new Date("2026-05-24T00:00:00.000Z"),
      ),
      false,
    );
    assert.equal(isQuoteApprovalLinkExpired({ expiresAt: null }), false);
  });
});
