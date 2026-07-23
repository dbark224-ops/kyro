import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "@supabase/supabase-js";
import {
  internalMessagingUserFromProfile,
  trustedInternalMessagingActor,
  trustedInternalPhoneMatches,
} from "./internal-messaging";

test("builds the internal assistant identity from the synchronized Kyro user profile", () => {
  const user = internalMessagingUserFromProfile(
    {
      created_at: "2026-07-19T00:00:00.000Z",
      email: "owner@example.com",
      first_name: "David",
      id: "user-1",
      last_name: "Barker",
      name: "David Barker",
    },
    "fallback-user",
  );

  assert.deepEqual(user, {
    app_metadata: {},
    aud: "authenticated",
    created_at: "2026-07-19T00:00:00.000Z",
    email: "owner@example.com",
    id: "user-1",
    role: "authenticated",
    user_metadata: {
      first_name: "David",
      full_name: "David Barker",
      last_name: "Barker",
      name: "David Barker",
    },
  });
});

test("matches trusted internal numbers across common formatting", () => {
  assert.equal(
    trustedInternalPhoneMatches("+1 (575) 571-2705", ["+15755712705"]),
    true,
  );
  assert.equal(
    trustedInternalPhoneMatches("whatsapp:+15755712705", ["+1 575 571 2705"]),
    true,
  );
});

test("does not confuse a customer number with an internal number", () => {
  assert.equal(
    trustedInternalPhoneMatches("+15855221939", ["+15755712705"]),
    false,
  );
});

test("binds a trusted WhatsApp sender to their internal identity", () => {
  const actor = trustedInternalMessagingActor({
    from: "whatsapp:+15755712705",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: "2026-07-19T00:00:00.000Z",
      email: "owner@example.com",
      id: "user-1",
      user_metadata: {
        first_name: "Account",
        full_name: "Account Owner",
      },
    } as User,
    voiceSettings: {
      phoneAgentUserNumberDetails: [
        {
          name: "David Barker",
          phoneNumber: "+1 (575) 571-2705",
          role: "Owner",
        },
      ],
    },
  });

  assert.deepEqual(actor, {
    displayName: "David Barker",
    firstName: "David",
    kind: "trusted_internal_messaging_sender",
    phoneNumber: "+15755712705",
    role: "Owner",
    userId: "user-1",
  });
});
