import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveVapiToolAuthorization } from "../assistant/vapi-tool-authorization";
import {
  vapiToolCallMetadata,
  vapiToolUserId,
  vapiToolWorkspaceId,
} from "./calls";

describe("Vapi tool request metadata", () => {
  it("authorizes recognized internal callers from assistant override metadata", () => {
    const payload = {
      message: {
        call: {
          assistantOverrides: {
            metadata: {
              callerRole: "internal_user",
              purpose: "inbound_user",
              source: "kyro.vapi_inbound_assistant_request",
              userId: "user-1",
              workspaceId: "workspace-1",
            },
          },
          customer: { number: "+15755712705" },
        },
        toolCallList: [
          {
            function: {
              arguments: {
                prompt: "What is on my calendar on August 3rd?",
                userId: "user-1",
                workspaceId: "workspace-1",
              },
              name: "kyro_context_lookup",
            },
            id: "tool-1",
            type: "function",
          },
        ],
        type: "tool-calls",
      },
    };

    const metadata = vapiToolCallMetadata(payload);
    const authorization = resolveVapiToolAuthorization({
      callerRole: String(metadata.callerRole),
      purpose: String(metadata.purpose),
      source: String(metadata.source),
      toolName: "kyro_context_lookup",
    });

    assert.equal(authorization.allowed, true);
    assert.equal(authorization.trustedInternal, true);
    assert.equal(vapiToolUserId(payload), "user-1");
    assert.equal(vapiToolWorkspaceId(payload), "workspace-1");
  });

  it("keeps direct call metadata authoritative over assistant overrides", () => {
    const metadata = vapiToolCallMetadata({
      message: {
        call: {
          assistantOverrides: {
            metadata: {
              callerRole: "internal_user",
              purpose: "inbound_user",
            },
          },
          metadata: {
            callerRole: "external_caller",
            purpose: "inbound_customer",
          },
        },
      },
    });

    assert.equal(metadata.callerRole, "external_caller");
    assert.equal(metadata.purpose, "inbound_customer");
  });
});
