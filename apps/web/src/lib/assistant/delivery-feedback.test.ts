import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assistantDeliveryFailureReason,
  assistantDeliveryOrigin,
} from "./delivery-feedback";

describe("assistant delivery feedback", () => {
  it("reads the originating assistant channel from an outbound snapshot", () => {
    assert.deepEqual(
      assistantDeliveryOrigin({
        assistantRequestOrigin: {
          inputSource: "whatsapp_sandbox",
          phoneNumber: "+15755712705",
          threadId: "thread-1",
          userId: "user-1",
        },
      }),
      {
        inputSource: "whatsapp_sandbox",
        phoneNumber: "+15755712705",
        threadId: "thread-1",
        userId: "user-1",
      },
    );
  });

  it("ignores snapshots without a usable thread and user", () => {
    assert.equal(
      assistantDeliveryOrigin({
        assistantRequestOrigin: {
          inputSource: "sms",
          phoneNumber: "+15755712705",
        },
      }),
      null,
    );
  });

  it("turns provider compliance failures into useful user-facing wording", () => {
    assert.equal(
      assistantDeliveryFailureReason({
        errorCode: "30034",
        errorMessage: "A2P campaign registration is required.",
      }),
      "outbound SMS is not currently available for this number",
    );
  });

  it("does not expose provider balance details in generic failures", () => {
    const reason = assistantDeliveryFailureReason({
      errorCode: "400",
      errorMessage: "Your wallet balance is too low.",
    });

    assert.equal(reason, "the delivery provider did not complete the send");
    assert.doesNotMatch(reason, /wallet|balance/i);
  });
});
