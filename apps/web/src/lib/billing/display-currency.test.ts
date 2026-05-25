import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  convertDisplayMoney,
  formatDisplayMoney,
  normalizeDisplayCurrency,
} from "./display-currency";

describe("display currency helpers", () => {
  it("normalizes supported display currencies case-insensitively", () => {
    assert.equal(normalizeDisplayCurrency("aud"), "AUD");
    assert.equal(normalizeDisplayCurrency("DOGE"), "USD");
  });

  it("converts stored USD values into the preferred display currency", () => {
    const converted = convertDisplayMoney("10", "USD", {
      ...DEFAULT_DISPLAY_CURRENCY_SETTINGS,
      displayCurrency: "AUD",
    });

    assert.equal(converted?.currency, "AUD");
    assert.equal(converted?.amount, 15.2);
    assert.equal(converted?.isConverted, true);
    assert.equal(converted?.sourceCurrency, "USD");
  });

  it("keeps the original amount when source and display currencies match", () => {
    const converted = convertDisplayMoney(10, "USD", {
      ...DEFAULT_DISPLAY_CURRENCY_SETTINGS,
      displayCurrency: "USD",
    });

    assert.equal(converted?.currency, "USD");
    assert.equal(converted?.amount, 10);
    assert.equal(converted?.isConverted, false);
  });

  it("formats invalid money values as a dash", () => {
    assert.equal(
      formatDisplayMoney("not a number", "USD", DEFAULT_DISPLAY_CURRENCY_SETTINGS),
      "-",
    );
  });
});
