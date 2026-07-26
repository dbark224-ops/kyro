import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  billablePeriodStart,
  invoiceNumber,
  nextRetryAt,
  previousMonthlyBillingPeriod,
  proratedBasePlanAmount,
  roundMoney,
  toMinorUnits,
} from "./kyro-billing-engine";

/**
 * This engine charges customer cards off-session on a cron and had no tests.
 * The functions below decide how much money moves and when, so they are the
 * ones worth pinning: everything else in the file is IO around these answers.
 */

function billingOverview(trialEndsAt: string | null) {
  return { settings: { trialEndsAt } } as Parameters<
    typeof billablePeriodStart
  >[0]["billingOverview"];
}

describe("previousMonthlyBillingPeriod", () => {
  it("bills the whole month before the anchor", () => {
    const period = previousMonthlyBillingPeriod(
      new Date("2026-07-14T09:30:00.000Z"),
    );

    assert.equal(period.start, "2026-06-01T00:00:00.000Z");
    assert.equal(period.end, "2026-07-01T00:00:00.000Z");
  });

  it("rolls back across a year boundary", () => {
    const period = previousMonthlyBillingPeriod(
      new Date("2026-01-03T00:00:00.000Z"),
    );

    assert.equal(period.start, "2025-12-01T00:00:00.000Z");
    assert.equal(period.end, "2026-01-01T00:00:00.000Z");
  });

  it("is half-open, so no day is billed twice", () => {
    const june = previousMonthlyBillingPeriod(new Date("2026-07-14T00:00:00Z"));
    const july = previousMonthlyBillingPeriod(new Date("2026-08-14T00:00:00Z"));

    // June's end is July's start: the boundary instant belongs to one period.
    assert.equal(june.end, july.start);
  });

  it("handles a short month and a leap February", () => {
    assert.equal(
      previousMonthlyBillingPeriod(new Date("2024-03-31T00:00:00Z")).start,
      "2024-02-01T00:00:00.000Z",
    );
    assert.equal(
      previousMonthlyBillingPeriod(new Date("2026-03-31T00:00:00Z")).end,
      "2026-03-01T00:00:00.000Z",
    );
  });
});

describe("money conversion", () => {
  it("keeps eight decimal places for per-unit usage pricing", () => {
    assert.equal(roundMoney(0.000012345678), 0.00001235);
    assert.equal(roundMoney(1 / 3), 0.33333333);
  });

  it("clears floating point noise rather than carrying it into a charge", () => {
    assert.equal(roundMoney(0.1 + 0.2), 0.3);
  });

  it("converts to whole cents, because Stripe takes minor units", () => {
    assert.equal(toMinorUnits(10), 1000);
    assert.equal(toMinorUnits(10.994), 1099);
    assert.equal(toMinorUnits(10.995), 1100);
    assert.equal(toMinorUnits(0), 0);
  });

  it("never asks Stripe for a negative charge", () => {
    assert.equal(toMinorUnits(-5), 0);
    assert.equal(toMinorUnits(-0.004), 0);
  });

  it("rounds a sub-cent amount to zero rather than to a stray cent", () => {
    assert.equal(toMinorUnits(0.004), 0);
    assert.equal(toMinorUnits(0.005), 1);
  });
});

describe("billablePeriodStart", () => {
  const periodStart = "2026-06-01T00:00:00.000Z";
  const periodEnd = "2026-07-01T00:00:00.000Z";

  it("bills the whole period when there is no trial", () => {
    assert.equal(
      billablePeriodStart({
        billingOverview: billingOverview(null),
        periodEnd,
        periodStart,
      }),
      periodStart,
    );
  });

  it("bills the whole period when the trial ended before it began", () => {
    assert.equal(
      billablePeriodStart({
        billingOverview: billingOverview("2026-05-20T00:00:00.000Z"),
        periodEnd,
        periodStart,
      }),
      periodStart,
    );
  });

  it("bills nothing when the trial covers the whole period", () => {
    // Billable start equals the period end, so there is no billable window.
    assert.equal(
      billablePeriodStart({
        billingOverview: billingOverview("2026-08-01T00:00:00.000Z"),
        periodEnd,
        periodStart,
      }),
      periodEnd,
    );
  });

  it("starts billing the moment a mid-period trial ends", () => {
    assert.equal(
      billablePeriodStart({
        billingOverview: billingOverview("2026-06-15T00:00:00.000Z"),
        periodEnd,
        periodStart,
      }),
      "2026-06-15T00:00:00.000Z",
    );
  });

  it("bills the whole period rather than nothing when the trial date is junk", () => {
    // Failing open to "no trial" is the safe direction: a malformed date must
    // not silently hand out a free month.
    assert.equal(
      billablePeriodStart({
        billingOverview: billingOverview("not a date"),
        periodEnd,
        periodStart,
      }),
      periodStart,
    );
  });
});

describe("proratedBasePlanAmount", () => {
  // June: 30 days, so the halfway point is the 16th.
  const periodStart = "2026-06-01T00:00:00.000Z";
  const periodEnd = "2026-07-01T00:00:00.000Z";

  function withMonthlyPrice<T>(priceUsd: string | null, run: () => T): T {
    const previousUsd = process.env.KYRO_BASE_MONTHLY_PRICE_USD;
    const previousCents = process.env.KYRO_BASE_MONTHLY_PRICE_CENTS;

    delete process.env.KYRO_BASE_MONTHLY_PRICE_CENTS;

    if (priceUsd === null) {
      delete process.env.KYRO_BASE_MONTHLY_PRICE_USD;
    } else {
      process.env.KYRO_BASE_MONTHLY_PRICE_USD = priceUsd;
    }

    try {
      return run();
    } finally {
      if (previousUsd === undefined) {
        delete process.env.KYRO_BASE_MONTHLY_PRICE_USD;
      } else {
        process.env.KYRO_BASE_MONTHLY_PRICE_USD = previousUsd;
      }

      if (previousCents !== undefined) {
        process.env.KYRO_BASE_MONTHLY_PRICE_CENTS = previousCents;
      }
    }
  }

  it("charges the full price for a full period", () => {
    withMonthlyPrice("60", () => {
      assert.equal(
        proratedBasePlanAmount({
          billableStart: periodStart,
          periodEnd,
          periodStart,
        }),
        60,
      );
    });
  });

  it("charges half for a trial that ended halfway through", () => {
    withMonthlyPrice("60", () => {
      assert.equal(
        proratedBasePlanAmount({
          billableStart: "2026-06-16T00:00:00.000Z",
          periodEnd,
          periodStart,
        }),
        30,
      );
    });
  });

  it("charges one day's worth for a trial ending the day before period end", () => {
    withMonthlyPrice("30", () => {
      assert.equal(
        proratedBasePlanAmount({
          billableStart: "2026-06-30T00:00:00.000Z",
          periodEnd,
          periodStart,
        }),
        1,
      );
    });
  });

  it("charges nothing when no base price is configured", () => {
    withMonthlyPrice(null, () => {
      assert.equal(
        proratedBasePlanAmount({
          billableStart: periodStart,
          periodEnd,
          periodStart,
        }),
        0,
      );
    });
  });

  it("charges nothing when the billable window is empty", () => {
    withMonthlyPrice("60", () => {
      assert.equal(
        proratedBasePlanAmount({
          billableStart: periodEnd,
          periodEnd,
          periodStart,
        }),
        0,
      );
    });
  });

  it("never charges for time before the period started", () => {
    withMonthlyPrice("60", () => {
      // A billable start earlier than the period must not inflate the charge
      // beyond one full period.
      assert.equal(
        proratedBasePlanAmount({
          billableStart: "2026-05-01T00:00:00.000Z",
          periodEnd,
          periodStart,
        }),
        60,
      );
    });
  });
});

describe("invoiceNumber", () => {
  it("is stable for the same workspace and period", () => {
    const first = invoiceNumber("abcdef12-3456-7890", "2026-06-01T00:00:00Z");
    const second = invoiceNumber("abcdef12-3456-7890", "2026-06-01T00:00:00Z");

    assert.equal(first, second);
    assert.equal(first, "KYRO-202606-ABCDEF12");
  });

  it("zero-pads the month so numbers sort correctly", () => {
    assert.match(
      invoiceNumber("abcdef12-3456-7890", "2026-01-01T00:00:00Z"),
      /KYRO-202601-/,
    );
  });

  it("differs by workspace and by period", () => {
    const a = invoiceNumber("aaaaaaaa-0000", "2026-06-01T00:00:00Z");
    const b = invoiceNumber("bbbbbbbb-0000", "2026-06-01T00:00:00Z");
    const c = invoiceNumber("aaaaaaaa-0000", "2026-07-01T00:00:00Z");

    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
});

describe("nextRetryAt", () => {
  function hoursFromNow(iso: string) {
    return Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  }

  it("backs off further with each failure", () => {
    assert.equal(hoursFromNow(nextRetryAt(1)), 24);
    assert.equal(hoursFromNow(nextRetryAt(2)), 48);
    assert.equal(hoursFromNow(nextRetryAt(3)), 72);
  });

  it("caps the wait at a week so a card is never retried forever apart", () => {
    assert.equal(hoursFromNow(nextRetryAt(30)), 24 * 7);
    assert.equal(hoursFromNow(nextRetryAt(1000)), 24 * 7);
  });

  it("still waits a day when the failure count is zero or negative", () => {
    // Guards against an immediate retry loop against the customer's card.
    assert.equal(hoursFromNow(nextRetryAt(0)), 24);
    assert.equal(hoursFromNow(nextRetryAt(-5)), 24);
  });
});
