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

  it("keeps trusted call identifiers authoritative over tool arguments", () => {
    const payload = {
      message: {
        call: {
          metadata: {
            threadId: "trusted-thread",
            userId: "trusted-user",
            workspaceId: "trusted-workspace",
          },
        },
        toolCallList: [
          {
            function: {
              arguments: {
                threadId: "spoofed-thread",
                userId: "spoofed-user",
                workspaceId: "spoofed-workspace",
              },
              name: "kyro_request_booking",
            },
          },
        ],
      },
    };

    assert.equal(vapiToolWorkspaceId(payload), "trusted-workspace");
    assert.equal(vapiToolUserId(payload), "trusted-user");
  });

  it("refuses a workspace supplied only by the model's tool arguments", () => {
    // No server-set metadata anywhere. The only workspaceId on offer comes from
    // the LLM's own generated arguments, and the tool route hands the result to
    // a service-role client that bypasses RLS -- so this must resolve to null
    // and the route must reject the call rather than act on the model's choice.
    const payload = {
      message: {
        call: {},
        toolCallList: [
          {
            function: {
              arguments: { workspaceId: "attacker-workspace" },
              name: "kyro_lookup_contact",
            },
          },
        ],
        type: "tool-calls",
      },
    };

    assert.equal(vapiToolWorkspaceId(payload), null);
  });

  it("refuses a workspace supplied at the top level of the payload", () => {
    const payload = {
      message: { call: {}, toolCallList: [], type: "tool-calls" },
      workspaceId: "attacker-workspace",
    };

    assert.equal(vapiToolWorkspaceId(payload), null);
  });

  it("still resolves the workspace from assistant override metadata", () => {
    const payload = {
      message: {
        assistantOverrides: { metadata: { workspaceId: "workspace-9" } },
        call: {},
        toolCallList: [],
        type: "tool-calls",
      },
    };

    assert.equal(vapiToolWorkspaceId(payload), "workspace-9");
  });

  it("still resolves the workspace from direct call metadata", () => {
    const payload = {
      message: { call: {}, toolCallList: [], type: "tool-calls" },
      metadata: { workspaceId: "workspace-10" },
    };

    assert.equal(vapiToolWorkspaceId(payload), "workspace-10");
  });
});
