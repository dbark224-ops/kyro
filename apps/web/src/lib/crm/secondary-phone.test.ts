import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "../testing/repo-files";

/**
 * A second number, for the person who is actually there.
 *
 * Customers hand over someone else's number constantly -- "my partner Sam is
 * home today, they're on 505 555 0198". Contacts held exactly one phone, so
 * that number was read once in the email and then lost.
 *
 * The danger in storing it is the opposite of losing it: a bare second number
 * with nothing saying whose it is gets texted by mistake, and a second number
 * treated as an identity merges two people's profiles. Hence the name and role
 * beside it, and hence the deliberate absence of an index.
 *
 * Name and role are separate columns rather than one "Sam (partner)" string,
 * so Kyro can address them by name and still know what they are to the
 * customer without parsing it back apart.
 */
const migration = readRepoFile(
  "supabase/migrations/20260729200000_contact_secondary_phone.sql",
);
const tool = readRepoFile("apps/web/src/lib/crm/contact-update-tool.ts");
const actions = readRepoFile("apps/web/src/app/contacts/actions.ts");

describe("the column exists and says what it is for", () => {
  it("adds the number, its normalised form, a name and a role", () => {
    assert.match(migration, /add column if not exists secondary_phone text/);
    assert.match(
      migration,
      /add column if not exists normalized_secondary_phone text/,
    );
    assert.match(
      migration,
      /add column if not exists secondary_phone_name text/,
    );
    assert.match(
      migration,
      /add column if not exists secondary_phone_label text/,
    );
  });

  it("is additive and rerunnable", () => {
    // Nullable with no default and no backfill: an additive migration on a
    // live table should not rewrite a single existing row.
    assert.doesNotMatch(migration, /not null/i);
    assert.doesNotMatch(migration, /update contacts/i);
  });

  it("creates no index on the secondary number", () => {
    // An index is how this would quietly become an identity. Matching an
    // inbound caller by their partner's number would attach one person's
    // conversation to another person's profile.
    assert.doesNotMatch(migration, /create index.*secondary/i);
  });
});

describe("the secondary number is never an identity", () => {
  it("is not used to look a contact up", () => {
    // Contact lookup matches on normalized_phone. If normalized_secondary_phone
    // ever joins that query, two different people share one profile.
    const lookup = tool.slice(0, tool.indexOf("export async function"));

    assert.doesNotMatch(lookup, /normalized_secondary_phone/);
  });

  it("does not overwrite the contact's own number", () => {
    assert.match(tool, /update\.secondary_phone = nullableText\(secondaryPhone\)/);
    assert.match(tool, /update\.phone = nullableText\(phone\)/);
  });

  it("is reachable by the names a model would actually use", () => {
    for (const alias of [
      "secondaryPhone",
      "secondary_phone",
      "otherPhone",
      "alternatePhone",
    ]) {
      assert.ok(tool.includes(`"${alias}"`), alias);
    }
  });
});

describe("a number never sits there unlabelled", () => {
  it("clears the name and role when the number is cleared", () => {
    // Otherwise a profile keeps "Sam, partner" beside an empty field, which is
    // worse than either having all of it or none of it.
    assert.match(
      actions,
      /secondary_phone_name: secondaryPhone\s*\?\s*nullableText\(secondaryPhoneName\)\s*:\s*null/,
    );
    assert.match(
      actions,
      /secondary_phone_label: secondaryPhone\s*\?\s*nullableText\(secondaryPhoneLabel\)\s*:\s*null/,
    );
    assert.match(
      actions,
      /normalized_secondary_phone: secondaryPhone\s*\?[\s\S]{0,80}:\s*null/,
    );
  });

  it("tells the assistant to record whose number it is", () => {
    const vapi = readRepoFile("apps/web/src/lib/assistant/vapi-internal.ts");

    assert.match(vapi, /their name in secondaryPhoneName/);
    assert.match(vapi, /what they are to the customer in secondaryPhoneLabel/);
    assert.match(vapi, /Never overwrite the contact's own phone with it/);
  });
});

describe("the form saves what the form shows", () => {
  // The contact edit form exists in three near-identical copies. A field added
  // to one of them is a field that silently does nothing on the other two
  // screens, which is exactly the sort of thing nobody notices until a number
  // goes missing.
  const forms = [
    "apps/web/src/app/components/contact-profile-panel.tsx",
    "apps/web/src/app/contacts/[contactId]/page.tsx",
    "apps/web/src/app/contacts/page.tsx",
  ];

  for (const form of forms) {
    it(`renders both fields in ${form.split("/").slice(-2).join("/")}`, () => {
      const source = readRepoFile(form);

      assert.match(source, /name="secondaryPhone"/);
      assert.match(source, /name="secondaryPhoneName"/);
      assert.match(source, /name="secondaryPhoneLabel"/);
      assert.match(source, /profile\.contact\.secondaryPhone \?\? ""/);
      assert.match(source, /profile\.contact\.secondaryPhoneName \?\? ""/);
      assert.match(source, /profile\.contact\.secondaryPhoneLabel \?\? ""/);
    });
  }

  it("reads every field name back out of the form", () => {
    assert.match(actions, /formString\(formData, "secondaryPhone"\)/);
    assert.match(actions, /formString\(formData, "secondaryPhoneName"\)/);
    assert.match(actions, /formString\(formData, "secondaryPhoneLabel"\)/);
  });

  it("loads the columns so the form can show them", () => {
    const queries = readRepoFile("apps/web/src/lib/crm/queries.ts");

    assert.match(queries, /secondaryPhone: textValue\(contact\.secondary_phone\)/);
    assert.match(
      queries,
      /secondaryPhoneName: textValue\(contact\.secondary_phone_name\)/,
    );
    assert.match(
      queries,
      /secondaryPhoneLabel: textValue\(contact\.secondary_phone_label\)/,
    );
  });
});
