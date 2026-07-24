import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifiedInquiryAvailabilityFromActionInput } from "./inquiry-calendar-commitment";

describe("verifiedInquiryAvailabilityFromActionInput", () => {
  it("returns a complete verified slot", () => {
    assert.deepEqual(
      verifiedInquiryAvailabilityFromActionInput({
        verifiedAvailability: {
          endsAt: "2026-07-28T17:00:00.000Z",
          label: "Tuesday, July 28 at 10:00 AM MDT",
          startsAt: "2026-07-28T16:00:00.000Z",
          timeZone: "America/Denver",
        },
      }),
      {
      endsAt: "2026-07-28T17:00:00.000Z",
      label: "Tuesday, July 28 at 10:00 AM MDT",
      startsAt: "2026-07-28T16:00:00.000Z",
      timeZone: "America/Denver",
      },
    );
  });

  const invalidInputs: Record<string, unknown>[] = [
    {},
    { verifiedAvailability: {} },
    {
      verifiedAvailability: {
        endsAt: "2026-07-28T16:00:00.000Z",
        label: "Tuesday at 10:00 AM",
        startsAt: "2026-07-28T17:00:00.000Z",
        timeZone: "America/Denver",
      },
    },
    {
      verifiedAvailability: {
        endsAt: "invalid",
        label: "Tuesday at 10:00 AM",
        startsAt: "also invalid",
        timeZone: "America/Denver",
      },
    },
  ];

  for (const [index, input] of invalidInputs.entries()) {
    it(`rejects missing or invalid verified availability case ${index + 1}`, () => {
      assert.equal(verifiedInquiryAvailabilityFromActionInput(input), null);
    });
  }
});
