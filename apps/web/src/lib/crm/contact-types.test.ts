import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTACT_TYPES,
  formatContactType,
  isCustomerContactType,
  normalizeContactType,
} from "./contact-types";
import { readRepoFile } from "../testing/repo-files";

describe("contact type is the only field", () => {
  it("carries lead and client itself", () => {
    // These lived in a separate lifecycle_stage column that disagreed with
    // contact_type on all 36 production rows -- typed "client", staged "lead".
    assert.ok(CONTACT_TYPES.includes("lead"));
    assert.ok(CONTACT_TYPES.includes("client"));
  });

  it("has exactly the categories the owner asked for", () => {
    assert.deepEqual(
      [...CONTACT_TYPES],
      [
        "lead",
        "client",
        "supplier",
        "contractor",
        "staff",
        "property_manager",
        "other",
      ],
    );
  });

  it("treats an unknown contact as a lead, not a client", () => {
    // Claiming someone has done business with you when nothing says so is the
    // worse of the two guesses.
    assert.equal(normalizeContactType(null), "lead");
    assert.equal(normalizeContactType(""), "lead");
    assert.equal(normalizeContactType("   "), "lead");
  });

  it("lands a retired type somewhere sensible rather than the default", () => {
    // "builder" outlived the list it came from. Falling through to the default
    // would have relabelled a commercial builder as a fresh lead.
    assert.equal(normalizeContactType("builder"), "other");
    assert.equal(normalizeContactType("Builder / commercial"), "lead");
    assert.equal(normalizeContactType("customer"), "client");
  });

  it("accepts the stored spellings", () => {
    assert.equal(normalizeContactType("Property Manager"), "property_manager");
    assert.equal(normalizeContactType("STAFF"), "staff");
    assert.equal(formatContactType("property_manager"), "Property manager");
    assert.equal(formatContactType("lead"), "Lead");
  });

  it("still separates people you sell to from everyone else", () => {
    for (const type of ["lead", "client"]) {
      assert.equal(isCustomerContactType(type), true, type);
    }

    for (const type of ["supplier", "contractor", "staff", "other"]) {
      assert.equal(isCustomerContactType(type), false, type);
    }
  });
});

describe("Kyro promotes a lead on its own", () => {
  const review = readRepoFile("apps/web/src/lib/crm/lifecycle-review.ts");

  it("writes the contact type rather than raising a suggestion", () => {
    assert.match(review, /\.update\(\{ contact_type: "client" \}\)/);
    assert.doesNotMatch(review, /pending_approval/);
  });

  it("only ever moves a lead forward", () => {
    // Never demote a client, and never touch a supplier, contractor, staff
    // member or property manager -- an approved quote says nothing about them.
    // Being one-directional is also what removes the need for a "who set this"
    // column now that lifecycle_source is gone.
    assert.match(review, /if \(currentType !== "lead"\)/);
    assert.match(review, /review\.recommendedStage !== "client"/);
  });

  it("cannot overwrite a change the owner made mid-run", () => {
    assert.match(review, /\.eq\("contact_type", "lead"\)/);
  });

  it("records why, since nobody approves it now", () => {
    assert.match(review, /contact\.promoted_to_client/);
    assert.match(review, /evidence: review\.evidence/);
  });

  it("touches no lifecycle column", () => {
    // Assert on column access rather than the word, or the comment explaining
    // why lifecycle_source is gone trips the check.
    const code = review.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    assert.doesNotMatch(code, /lifecycle_stage/);
    assert.doesNotMatch(code, /lifecycle_source/);
    assert.doesNotMatch(code, /lifecycle_reviewed_at/);
    assert.match(code, /\.select\("id,contact_type"\)/);
  });
});

describe("the CRM stops showing lifecycle", () => {
  it("has no lifecycle field left on any contact screen", () => {
    for (const file of [
      "apps/web/src/app/contacts/page.tsx",
      "apps/web/src/app/contacts/[contactId]/page.tsx",
      "apps/web/src/app/components/contact-profile-panel.tsx",
    ]) {
      assert.doesNotMatch(
        readRepoFile(file),
        /lifecycleStage|lifecycleSource|lifecycleReason/,
        `${file} should not render a lifecycle field`,
      );
    }
  });

  it("does not call two different things Leads", () => {
    // The `leads` table is job enquiries; a contact typed "lead" is a person.
    // Both pills said "Leads", which is half of why the counts never added up.
    const page = readRepoFile("apps/web/src/app/contacts/page.tsx");

    assert.match(page, /\{ label: "Opportunities", value: "opportunities" \}/);
    assert.match(page, /\{ label: "Leads", value: "lead" \}/);
  });

  it("hides a category nobody is in", () => {
    const page = readRepoFile("apps/web/src/app/contacts/page.tsx");

    assert.match(page, /const visibleFilters = CRM_FILTERS\.filter/);
    // "All" and the current selection always survive, or narrowing a search to
    // nothing would remove the pill you are standing on.
    assert.match(page, /filter\.value === "all" \|\|/);
    assert.match(page, /filter\.value === activeFilter \|\|/);
  });

  it("only splits the workspace when the profile side exists", () => {
    // Keyed on the shell being present rather than on a contact being
    // selected. The shell appears the moment you click, before the server has
    // re-rendered: keyed on selection, the loading card fell into a second grid
    // row, squashing the list and sitting underneath it.
    const css = readRepoFile("apps/web/src/app/globals.css");

    assert.match(css, /\.crm-workspace:has\(\.crm-profile-transition-shell\)/);
    assert.doesNotMatch(css, /data-profile-open/);
  });

  it("centres the loading card whether or not the pane already had content", () => {
    // The panel variant carries .assistant-inline-preview, whose
    // grid-template-rows drops the card into a first row only as tall as
    // itself -- so place-items: center centred it inside a 60px row at the top,
    // and the first conversation you opened loaded higher than every one after.
    const css = readRepoFile("apps/web/src/app/globals.css");

    assert.match(
      css,
      /\.assistant-inline-preview\.inbox-preview-loading-panel \{\s*grid-template-rows: minmax\(0, 1fr\);/,
    );
    assert.doesNotMatch(css, /loading-panel \{\s*align-content: start;/);
  });
});
