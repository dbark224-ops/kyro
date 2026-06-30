import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  envSecret,
  hasValidRequestSecret,
  requestBearerToken,
  requestSecret,
  secretMatches,
} from "./request-secret";

function request(headers: HeadersInit = {}, url = "https://kyro.test/api") {
  return new Request(url, { headers });
}

describe("request secret helpers", () => {
  it("reads bearer tokens without accepting partial auth schemes", () => {
    assert.equal(
      requestBearerToken(request({ authorization: "Bearer abc123" })),
      "abc123",
    );
    assert.equal(
      requestBearerToken(request({ authorization: "Basic abc123" })),
      null,
    );
  });

  it("falls back to configured headers and optional query params", () => {
    assert.equal(
      requestSecret(request({ "x-kyro-sync-secret": " header-secret " })),
      "header-secret",
    );
    assert.equal(
      requestSecret(
        request({}, "https://kyro.test/api?secret=query-secret"),
        { queryParamNames: ["secret"] },
      ),
      "query-secret",
    );
  });

  it("compares secrets with exact matching only", () => {
    assert.equal(secretMatches("same", "same"), true);
    assert.equal(secretMatches("same", "different"), false);
    assert.equal(secretMatches(null, "same"), false);
  });

  it("validates a request against the expected secret", () => {
    assert.equal(
      hasValidRequestSecret(
        request({ authorization: "Bearer expected" }),
        "expected",
      ),
      true,
    );
    assert.equal(
      hasValidRequestSecret(
        request({ authorization: "Bearer wrong" }),
        "expected",
      ),
      false,
    );
  });

  it("returns the first configured environment secret", () => {
    const previousA = process.env.KYRO_TEST_SECRET_A;
    const previousB = process.env.KYRO_TEST_SECRET_B;

    delete process.env.KYRO_TEST_SECRET_A;
    process.env.KYRO_TEST_SECRET_B = " fallback ";

    try {
      assert.equal(
        envSecret("KYRO_TEST_SECRET_A", "KYRO_TEST_SECRET_B"),
        "fallback",
      );
    } finally {
      if (previousA === undefined) {
        delete process.env.KYRO_TEST_SECRET_A;
      } else {
        process.env.KYRO_TEST_SECRET_A = previousA;
      }

      if (previousB === undefined) {
        delete process.env.KYRO_TEST_SECRET_B;
      } else {
        process.env.KYRO_TEST_SECRET_B = previousB;
      }
    }
  });
});
