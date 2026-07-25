import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  StripeRequestError,
  createStripePaymentIntent,
  findSucceededPaymentIntentForInvoice,
  kyroInvoiceIdempotencyKey,
  stripeApiRequest,
} from "./stripe";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.STRIPE_SECRET_KEY;

type FetchCall = { init: RequestInit | undefined; url: string };

function stubFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
  calls: FetchCall[],
) {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call = { init, url: String(input) };
    calls.push(call);

    return handler(call);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function headerValue(call: FetchCall | undefined, name: string) {
  const headers = (call?.init?.headers ?? {}) as Record<string, string>;

  return headers[name];
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_stub";
});

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalSecret === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = originalSecret;
  }
});

describe("kyroInvoiceIdempotencyKey", () => {
  it("is stable for the same invoice and attempt", () => {
    assert.equal(
      kyroInvoiceIdempotencyKey("inv-1", 0),
      kyroInvoiceIdempotencyKey("inv-1", 0),
    );
  });

  it("differs per invoice and per attempt", () => {
    assert.notEqual(
      kyroInvoiceIdempotencyKey("inv-1", 0),
      kyroInvoiceIdempotencyKey("inv-2", 0),
    );
    assert.notEqual(
      kyroInvoiceIdempotencyKey("inv-1", 0),
      kyroInvoiceIdempotencyKey("inv-1", 1),
    );
  });

  it("never emits a negative or fractional attempt", () => {
    assert.equal(
      kyroInvoiceIdempotencyKey("inv-1", -3),
      "kyro-invoice-inv-1-0",
    );
    assert.equal(
      kyroInvoiceIdempotencyKey("inv-1", 2.7),
      "kyro-invoice-inv-1-2",
    );
  });
});

describe("stripeApiRequest", () => {
  it("sends the Idempotency-Key header when one is supplied", async () => {
    const calls: FetchCall[] = [];
    stubFetch(() => jsonResponse({ id: "pi_1" }), calls);

    await stripeApiRequest(
      "/v1/payment_intents",
      { amount: 100 },
      { idempotencyKey: "kyro-invoice-inv-1-0" },
    );

    assert.equal(
      headerValue(calls[0], "Idempotency-Key"),
      "kyro-invoice-inv-1-0",
    );
  });

  it("omits the header when no key is supplied", async () => {
    const calls: FetchCall[] = [];
    stubFetch(() => jsonResponse({ id: "pi_1" }), calls);

    await stripeApiRequest("/v1/payment_intents", { amount: 100 });

    assert.equal(headerValue(calls[0], "Idempotency-Key"), undefined);
  });

  it("treats a 4xx as a known outcome, so the charge definitively did not happen", async () => {
    stubFetch(
      () =>
        jsonResponse({ error: { message: "Your card was declined." } }, 402),
      [],
    );

    await assert.rejects(
      () => stripeApiRequest("/v1/payment_intents", { amount: 100 }),
      (error: unknown) => {
        assert.ok(error instanceof StripeRequestError);
        assert.equal(error.outcomeKnown, true);
        assert.equal(error.status, 402);
        assert.match(error.message, /declined/i);

        return true;
      },
    );
  });

  it("treats a 5xx as an unknown outcome, because it may have been applied", async () => {
    stubFetch(
      () => jsonResponse({ error: { message: "server error" } }, 500),
      [],
    );

    await assert.rejects(
      () => stripeApiRequest("/v1/payment_intents", { amount: 100 }),
      (error: unknown) => {
        assert.ok(error instanceof StripeRequestError);
        assert.equal(error.outcomeKnown, false);
        assert.equal(error.status, 500);

        return true;
      },
    );
  });

  it("treats a network failure as an unknown outcome", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;

    await assert.rejects(
      () => stripeApiRequest("/v1/payment_intents", { amount: 100 }),
      (error: unknown) => {
        assert.ok(error instanceof StripeRequestError);
        assert.equal(error.outcomeKnown, false);
        assert.equal(error.status, null);

        return true;
      },
    );
  });
});

describe("createStripePaymentIntent", () => {
  it("forwards the idempotency key onto the charge request", async () => {
    const calls: FetchCall[] = [];
    stubFetch(() => jsonResponse({ id: "pi_1", status: "succeeded" }), calls);

    await createStripePaymentIntent({
      amountCents: 1234,
      currency: "AUD",
      customerId: "cus_1",
      description: "Kyro invoice INV-1",
      idempotencyKey: "kyro-invoice-inv-1-0",
      metadata: { invoiceId: "inv-1" },
      paymentMethodId: "pm_1",
    });

    assert.equal(
      headerValue(calls[0], "Idempotency-Key"),
      "kyro-invoice-inv-1-0",
    );
    assert.match(String(calls[0]?.init?.body), /off_session=true/);
    assert.match(String(calls[0]?.init?.body), /confirm=true/);
  });
});

describe("findSucceededPaymentIntentForInvoice", () => {
  it("returns a succeeded intent so a re-charge can be skipped", async () => {
    const calls: FetchCall[] = [];
    stubFetch(
      () =>
        jsonResponse({
          data: [
            { id: "pi_failed", status: "requires_payment_method" },
            { id: "pi_ok", status: "succeeded" },
          ],
        }),
      calls,
    );

    const found = await findSucceededPaymentIntentForInvoice("inv-1");

    assert.equal(found?.id, "pi_ok");
    assert.match(calls[0]?.url ?? "", /payment_intents\/search/);
    assert.match(
      decodeURIComponent(calls[0]?.url ?? ""),
      /metadata\['invoiceId'\]:'inv-1'/,
    );
  });

  it("returns null when nothing has succeeded, so the charge proceeds", async () => {
    stubFetch(
      () => jsonResponse({ data: [{ id: "pi_1", status: "canceled" }] }),
      [],
    );

    assert.equal(await findSucceededPaymentIntentForInvoice("inv-1"), null);
  });

  it("returns null on an empty result set", async () => {
    stubFetch(() => jsonResponse({ data: [] }), []);

    assert.equal(await findSucceededPaymentIntentForInvoice("inv-1"), null);
  });

  it("strips quote characters so the search query cannot be broken out of", async () => {
    const calls: FetchCall[] = [];
    stubFetch(() => jsonResponse({ data: [] }), calls);

    await findSucceededPaymentIntentForInvoice("inv-1' OR status:'succeeded");

    const url = decodeURIComponent(calls[0]?.url ?? "");
    assert.match(url, /metadata\['invoiceId'\]:'inv-1 OR status:succeeded'/);
  });

  it("does not call Stripe for an id that sanitises to nothing", async () => {
    const calls: FetchCall[] = [];
    stubFetch(() => jsonResponse({ data: [] }), calls);

    assert.equal(await findSucceededPaymentIntentForInvoice("''"), null);
    assert.equal(calls.length, 0);
  });
});
