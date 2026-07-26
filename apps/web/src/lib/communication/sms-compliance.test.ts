import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSmsSendAllowed,
  getSmsRecipientPreference,
  smsConsentCommand,
} from "./sms-compliance";

type PreferenceRow = {
  consent_status: string;
  opt_out_keyword?: string | null;
  opted_out_at?: string | null;
  phone_number: string;
};

/**
 * Records the `normalized_phone` the consent lookup actually filtered on, so a
 * test can assert the key rather than trust it. Consent is stored under that
 * key, so if the read and the write ever disagree the recipient says STOP and
 * Kyro keeps texting them.
 */
function fakeSupabase(options: {
  error?: { code?: string; message: string };
  row?: PreferenceRow | null;
} = {}) {
  const filters: Record<string, string> = {};

  const query = {
    eq(column: string, value: string) {
      filters[column] = value;
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: options.row ?? null,
        error: options.error ?? null,
      });
    },
    select() {
      return this;
    },
  };

  return {
    client: {
      from() {
        return query;
      },
    } as never,
    filters,
  };
}

describe("smsConsentCommand", () => {
  it("honours the standard opt-out keywords", () => {
    for (const keyword of [
      "STOP",
      "STOPALL",
      "UNSUBSCRIBE",
      "CANCEL",
      "END",
      "QUIT",
      "REVOKE",
      "OPTOUT",
    ]) {
      assert.deepEqual(
        smsConsentCommand(keyword),
        { keyword, status: "opted_out" },
        `${keyword} must opt the recipient out`,
      );
    }
  });

  it("honours the opt-in keywords", () => {
    for (const keyword of ["START", "UNSTOP", "YES"]) {
      assert.deepEqual(smsConsentCommand(keyword), {
        keyword,
        status: "opted_in",
      });
    }
  });

  it("ignores casing, surrounding space and punctuation", () => {
    for (const body of [" stop ", "Stop", "sToP", "STOP.", "stop!", "STOP,"]) {
      assert.equal(
        smsConsentCommand(body).status,
        "opted_out",
        `${JSON.stringify(body)} must still opt out`,
      );
    }
  });

  it("does not opt out an ordinary message that merely mentions stopping", () => {
    for (const body of [
      "Can you stop by tomorrow?",
      "Please don't stop the work",
      "The tap won't stop dripping",
    ]) {
      assert.equal(
        smsConsentCommand(body).status,
        null,
        `${JSON.stringify(body)} is a normal message, not an opt-out`,
      );
    }
  });

  it("treats an empty or wordless message as no command", () => {
    for (const body of ["", "   ", "123", "!!!"]) {
      assert.deepEqual(smsConsentCommand(body), { keyword: null, status: null });
    }
  });

  it("records the limit: only a bare keyword counts, not STOP with words", () => {
    // Letters are stripped together, so "stop please" becomes STOPPLEASE and
    // matches nothing. Carriers handle the bare STOP upstream, which is why
    // this has not bitten, but a recipient who types more than the keyword is
    // not opted out by Kyro. Recorded so the behaviour is a decision rather
    // than a surprise.
    assert.equal(smsConsentCommand("stop please").status, null);
    assert.equal(smsConsentCommand("STOP TEXTING ME").status, null);
  });
});

describe("assertSmsSendAllowed", () => {
  const input = {
    phoneNumber: "+61412345678",
    region: "AU" as const,
    workspaceId: "ws-1",
  };

  it("allows a recipient with no consent record", async () => {
    const { client } = fakeSupabase({ row: null });

    assert.equal(await assertSmsSendAllowed(client, input), null);
  });

  it("allows an opted-in recipient", async () => {
    const { client } = fakeSupabase({
      row: { consent_status: "opted_in", phone_number: "+61412345678" },
    });

    const preference = await assertSmsSendAllowed(client, input);

    assert.equal(preference?.consent_status, "opted_in");
  });

  it("refuses to send to someone who opted out", async () => {
    const { client } = fakeSupabase({
      row: {
        consent_status: "opted_out",
        opt_out_keyword: "STOP",
        phone_number: "+61412345678",
      },
    });

    await assert.rejects(
      assertSmsSendAllowed(client, input),
      /SMS is blocked for \+61412345678 because the recipient is opted out/,
    );
  });

  it("refuses to send to a blocked recipient", async () => {
    const { client } = fakeSupabase({
      row: { consent_status: "blocked", phone_number: "+61412345678" },
    });

    await assert.rejects(assertSmsSendAllowed(client, input), /blocked/);
  });

  it("allows staff internal numbers to keep receiving", async () => {
    const { client } = fakeSupabase({
      row: { consent_status: "staff_internal", phone_number: "+61412345678" },
    });

    assert.equal(
      (await assertSmsSendAllowed(client, input))?.consent_status,
      "staff_internal",
    );
  });
});

describe("consent lookup key", () => {
  it("looks consent up under the E.164 form, whatever the caller passed", async () => {
    // The local spelling and the international one are the same person, so
    // both must find the same consent record.
    for (const spelling of ["0412345678", "+61412345678", "61412345678"]) {
      const { client, filters } = fakeSupabase({ row: null });

      await getSmsRecipientPreference(client, {
        phoneNumber: spelling,
        region: "AU",
        workspaceId: "ws-1",
      });

      assert.equal(
        filters.normalized_phone,
        "+61412345678",
        `${spelling} should look up +61412345678`,
      );
    }
  });

  it("reads a local number against the workspace's own region", async () => {
    const { client, filters } = fakeSupabase({ row: null });

    await getSmsRecipientPreference(client, {
      phoneNumber: "(415) 555-0123",
      region: "US",
      workspaceId: "ws-1",
    });

    assert.equal(filters.normalized_phone, "+14155550123");
  });

  it("scopes the lookup to the workspace", async () => {
    const { client, filters } = fakeSupabase({ row: null });

    await getSmsRecipientPreference(client, {
      phoneNumber: "+61412345678",
      region: "AU",
      workspaceId: "ws-42",
    });

    assert.equal(filters.workspace_id, "ws-42");
  });

  it("keeps an unparseable number as typed rather than dropping the record", async () => {
    const { client, filters } = fakeSupabase({ row: null });

    await getSmsRecipientPreference(client, {
      phoneNumber: "not a number",
      region: "AU",
      workspaceId: "ws-1",
    });

    assert.equal(filters.normalized_phone, "not a number");
  });
});

describe("consent table missing", () => {
  it("treats an absent table as no preference rather than failing the send", async () => {
    const { client } = fakeSupabase({
      error: { code: "42P01", message: "relation does not exist" },
    });

    assert.equal(
      await getSmsRecipientPreference(client, {
        phoneNumber: "+61412345678",
        region: "AU",
        workspaceId: "ws-1",
      }),
      null,
    );
  });

  it("still surfaces a real database error", async () => {
    const { client } = fakeSupabase({
      error: { code: "08006", message: "connection failure" },
    });

    await assert.rejects(
      getSmsRecipientPreference(client, {
        phoneNumber: "+61412345678",
        region: "AU",
        workspaceId: "ws-1",
      }),
      /Unable to load SMS consent state: connection failure/,
    );
  });
});
