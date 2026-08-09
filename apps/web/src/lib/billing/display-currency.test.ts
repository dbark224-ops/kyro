import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DISPLAY_CURRENCY_SETTINGS,
  convertDisplayMoney,
  formatCurrencyAmount,
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

describe("money reads as money", () => {
  // Reported from the live dashboard: a week's usage showed "$0.098239".
  // Anything under a dollar was given six decimal places.
  it("gives an ordinary amount two decimals", () => {
    assert.equal(formatCurrencyAmount(0.098239, "USD"), "$0.10");
    assert.equal(formatCurrencyAmount(18.4531, "USD"), "$18.45");
    assert.equal(formatCurrencyAmount(4.34, "USD"), "$4.34");
    assert.equal(formatCurrencyAmount(1234.5, "USD"), "$1,234.50");
  });

  it("says less than a cent rather than nothing", () => {
    // The worry behind the six decimals was right: showing $0.00 for a real
    // charge is the same fault as recording Twilio's messages as free. This
    // keeps that honesty without inventing digits nobody reads.
    assert.equal(formatCurrencyAmount(0.0000823, "USD"), "<$0.01");
    assert.equal(formatCurrencyAmount(0.004, "USD"), "<$0.01");
  });

  it("still shows a true zero as zero", () => {
    assert.equal(formatCurrencyAmount(0, "USD"), "$0.00");
  });

  it("rounds at the half cent", () => {
    assert.equal(formatCurrencyAmount(0.005, "USD"), "$0.01");
  });

  it("keeps a credit negative", () => {
    assert.equal(formatCurrencyAmount(-4.34, "USD"), "-$4.34");
    assert.equal(formatCurrencyAmount(-0.0001, "USD"), "-$0.01");
  });
});
