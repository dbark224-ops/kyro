import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AI_PROVIDER_TIMEOUT_MS,
  FetchTimeoutError,
  PROVIDER_TIMEOUT_MS,
  fetchWithTimeout,
} from "./fetch-with-timeout";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A fetch that never settles until its signal aborts - i.e. a hung connection. */
function hangingFetch() {
  globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(
          Object.assign(new Error("The operation was aborted."), {
            name: "AbortError",
          }),
        );
      });
    })) as typeof fetch;
}

describe("fetchWithTimeout", () => {
  it("returns the response when the provider answers in time", async () => {
    globalThis.fetch = (async () => new Response("ok")) as typeof fetch;

    const response = await fetchWithTimeout("https://example.test/ok");

    assert.equal(await response.text(), "ok");
  });

  it("throws FetchTimeoutError when the connection hangs", async () => {
    hangingFetch();

    await assert.rejects(
      () => fetchWithTimeout("https://example.test/hang", undefined, 25),
      (error: unknown) => {
        assert.ok(error instanceof FetchTimeoutError);
        assert.equal(error.timeoutMs, 25);
        assert.match(error.message, /timed out after 25ms/);

        return true;
      },
    );
  });

  it("passes the caller's init through to fetch", async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seen = init;

      return new Response("ok");
    }) as typeof fetch;

    await fetchWithTimeout("https://example.test", {
      body: "payload",
      headers: { "X-Test": "1" },
      method: "POST",
    });

    assert.equal(seen?.method, "POST");
    assert.equal(seen?.body, "payload");
    assert.deepEqual(seen?.headers, { "X-Test": "1" });
  });

  it("always attaches a signal even when the caller supplies none", async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seen = init;

      return new Response("ok");
    }) as typeof fetch;

    await fetchWithTimeout("https://example.test");

    assert.ok(seen?.signal instanceof AbortSignal);
  });

  it("still honours a caller's own abort, and does not relabel it as a timeout", async () => {
    hangingFetch();

    const controller = new AbortController();
    const pending = fetchWithTimeout(
      "https://example.test/hang",
      { signal: controller.signal },
      60_000,
    );

    controller.abort();

    await assert.rejects(pending, (error: unknown) => {
      assert.ok(!(error instanceof FetchTimeoutError));
      assert.equal((error as Error).name, "AbortError");

      return true;
    });
  });

  it("times out a caller-cancellable request the caller never cancels", async () => {
    hangingFetch();

    const controller = new AbortController();

    await assert.rejects(
      () =>
        fetchWithTimeout(
          "https://example.test/hang",
          { signal: controller.signal },
          25,
        ),
      (error: unknown) => {
        assert.ok(error instanceof FetchTimeoutError);

        return true;
      },
    );
  });

  it("reports the target url on a Request input", async () => {
    hangingFetch();

    await assert.rejects(
      () =>
        fetchWithTimeout(
          new Request("https://example.test/from-request"),
          undefined,
          25,
        ),
      (error: unknown) => {
        assert.ok(error instanceof FetchTimeoutError);
        assert.equal(error.url, "https://example.test/from-request");

        return true;
      },
    );
  });

  it("keeps the AI ceiling well above the general provider ceiling", () => {
    // Model calls are slow by nature; a shared 30s default would break image
    // generation. This guards against someone collapsing the two constants.
    assert.ok(AI_PROVIDER_TIMEOUT_MS > PROVIDER_TIMEOUT_MS);
    assert.ok(PROVIDER_TIMEOUT_MS >= 10_000);
  });
});
