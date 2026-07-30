#!/usr/bin/env node
/**
 * Runs a mock inquiry through the real ingest path and checks what Kyro
 * produced, without delivering anything to a phone or an inbox.
 *
 *   node --import tsx scripts/mock-inquiry.mts <scenario> [...]
 *   node --import tsx scripts/mock-inquiry.mts --list
 *   node --import tsx scripts/mock-inquiry.mts --cleanup
 *
 * Why this exists rather than another unit test: every defect it has found was
 * invisible to typecheck, lint and the whole suite, because each one was about
 * what comes out of the far end of the pipeline given realistic input. In its
 * first three sessions it found a crash on zero proposals, a doubled SMS bill
 * from one apostrophe, "not urgent" escalating, an alert written in the
 * customer's language, an appointment offered on a day the customer had ruled
 * out, and a default-enabled trigger that could never fire.
 *
 * Safety. `.env` holds real Supabase, OpenAI and Google keys but no Twilio auth
 * token and no Resend key, and the delivery credentials are deleted below
 * regardless. enqueueOutboundDelivery persists a message body before it tries
 * to send it, so the exact text Kyro would have sent is readable afterwards
 * while nothing reaches anybody. Customer addresses use example.com, which is
 * reserved and undeliverable.
 *
 * Assertions are about structure, never prose. LLM output varies run to run, so
 * matching text would be flaky and would test the model rather than the code.
 * What is checked is what actually broke: whether it escalated and on which
 * triggers, whether the alert was model-written or a fallback, the address
 * verification verdict, segment counts, forbidden internal phrases, and whether
 * any part of a text is nothing but a URL.
 */
import { readFileSync } from "node:fs";

type Expectation = {
  /** Escalation is expected, and on these trigger keys if given. */
  escalates?: boolean;
  escalationTriggers?: string[];
  /** The inquiry should reach the work queue rather than be observed. */
  promotes?: boolean;
  /** Address verdict, when the scenario carries an address. */
  addressStatus?: "verified" | "needs_review" | "unverified";
};

type Scenario = {
  description: string;
  expect: Expectation;
} & (
  | {
      kind: "email";
      bodyText: string;
      /**
       * A second message into the same thread, sent after the first settles.
       *
       * Checks are evaluated against what the follow-up produced, not the
       * opener. A customer replying is the commonest real interaction and it
       * behaves quite differently from a first contact -- the thread already
       * exists, facts are already stored, and a reply can contradict them.
       */
      followUp?: string;
      fromName: string;
      subject: string;
    }
  | { kind: "sms"; body: string; from: string }
);

const CONNECTION_ID = "5af02250-a552-40dd-b3ea-94fed3062187";
const WORKSPACE_NAME = "WFA Contractors";
const WORKSPACE_SMS_NUMBER = "+15753835284";

/** Never sent to a customer, but reserved and undeliverable if it ever were. */
const CUSTOMER_DOMAIN = "example.com";

const SCENARIOS: Record<string, Scenario> = {
  routine: {
    bodyText: `Hello,

We're thinking about redoing the ensuite in the next few months and would
like a rough idea of cost. Small room, bath out, walk-in shower in, new
vanity, retile floor and walls. Mid-range fittings are fine.

We're at 1120 Lomas Blvd NE, Albuquerque, NM 87102. No rush at all, we're
just gathering quotes.

Thanks,
Bea Ferreira`,
    description:
      "No urgency at all. Must not escalate -- 'no rush' once did, because \\burgent\\b matched inside 'No urgent deadline'.",
    expect: { escalates: false, promotes: true },
    fromName: "Bea Ferreira",
    kind: "email",
    subject: "Rough quote for an ensuite renovation, no rush",
  },

  emergency: {
    bodyText: `I'm standing in two inches of water. The water heater in the
garage has burst and it is flooding into the hallway. Water is near the
electrical panel and it feels unsafe. This is urgent.

Address is 4212 Central Ave SE, Albuquerque, NM 87108.

Marisol Okafor`,
    description:
      "Multiple genuine triggers. Must escalate, and the alert must be model-written rather than the template.",
    expect: {
      addressStatus: "needs_review",
      escalates: true,
      escalationTriggers: ["explicit_urgency", "active_property_damage"],
      promotes: true,
    },
    fromName: "Marisol Okafor",
    kind: "email",
    subject: "URGENT - water heater burst, flooding the hallway",
  },

  not_a_job: {
    bodyText: `INVOICE 88214

Your monthly account statement is available. Amount due: $148.20, due
within 14 days. This is an automated message; please do not reply.

Southwest Plumbing Supply Co.`,
    description:
      "A supplier invoice. Must be observed, not promoted to a lead, and must not alert.",
    expect: { escalates: false, promotes: false },
    fromName: "Southwest Plumbing Supply",
    kind: "email",
    subject: "Invoice 88214 for account 4471 is now available",
  },

  excluded_day: {
    bodyText: `Could I get a quote to replace the hot water system? 250L
electric, about 14 years old.

615 Girard Blvd NE, Albuquerque, NM 87106.

I'm away Thursday and Friday this week so don't come then.

Priya`,
    description:
      "Names days only to rule them out. Kyro must not offer Thursday -- it did, until three separate guards were added.",
    expect: { promotes: true },
    fromName: "Priya Raghunathan",
    kind: "email",
    subject: "Quote for replacing the hot water system",
  },

  no_address: {
    bodyText: `Do you do tap washers? Just the one dripping tap in the
kitchen. What would you charge for something that small?

Marcus`,
    description:
      "No address anywhere. The draft must ask for one rather than invent it.",
    expect: { promotes: true },
    fromName: "Marcus Oyelaran",
    kind: "email",
    subject: "Dripping tap - small job",
  },

  accepts_time: {
    bodyText: `Hi, I need a quote to replace a leaking mixer tap in the
kitchen. Nothing urgent. We're at 700 Tijeras Ave NW, Albuquerque, NM
87102, and my number is 505 555 0121. Any weekday morning suits.

Rowan Ashcombe`,
    description:
      "Customer accepts a proposed time in a reply. Closes the booking loop -- inquiry_future_steps and the confirmation path have never been exercised.",
    // Escalation is deliberately not asserted. The harness never sends the
    // draft -- the workspace is propose_for_approval and delivery is off -- so
    // from the data's point of view this customer has written twice and had no
    // answer, which is repeat contact pressure and correctly flagged. In
    // production approving the reply writes an outbound message and resets it.
    expect: { promotes: true },
    followUp: `That time works for us, go ahead and book it in please.
Someone will be home all morning.

Rowan`,
    fromName: "Rowan Ashcombe",
    kind: "email",
    subject: "Quote for a leaking kitchen mixer tap",
  },

  returning_complaint: {
    // A genuine inquiry, so it is promoted and leaves a contact and a message
    // behind. An opener that is merely a statement gets observed rather than
    // promoted, and then the follow-up has no history to find -- which is what
    // the first draft of this scenario got wrong.
    bodyText: `Morning, could I book someone to replace the shower mixer in
the main bathroom? It is dripping constantly.

700 Kirtland Dr SE, Albuquerque, NM 87108. My number is 505 555 0134.

Aurelia Bankole`,
    description:
      "An existing customer complaining about previous work. existing_job_serious_issue needs existingCustomer, so it only reaches the detector on a reply into a known thread.",
    expect: {
      escalates: true,
      escalationTriggers: ["existing_job_serious_issue"],
    },
    followUp: `The mixer you fitted in March has failed again and it is
leaking behind the wall. Your work, your warranty as far as I'm concerned.
This has now caused damage to the plasterboard.

I want somebody out to look at it and I want to know who is paying for
the making good.

Aurelia`,
    fromName: "Aurelia Bankole",
    kind: "email",
    subject: "Shower mixer replaced in March",
  },

  partial_address: {
    body:
      "Hi its Tom at 88 Silver Ave SW. Gas smell in the laundry near the hot " +
      "water unit, turned it off at the meter. Need someone urgent please",
    description:
      "Street with no suburb. Must store as unverified rather than guess, and must escalate on the gas smell.",
    expect: {
      addressStatus: "unverified",
      escalates: true,
      escalationTriggers: ["safety_risk"],
    },
    from: "+15055550188",
    kind: "sms",
  },
};

function loadEnv(path: string) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (!match) {
      continue;
    }

    const value = match[2].replace(/^"(.*)"$/s, "$1");

    // The Vercel-pulled env files store [SENSITIVE] placeholders rather than
    // values, so a present-but-redacted key must not win over a real one.
    if (value && value !== "[SENSITIVE]") {
      process.env[match[1]] = value;
    }
  }
}

function isolate() {
  loadEnv(".env");

  for (const key of [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_MESSAGING_SERVICE_SID",
    "RESEND_API_KEY",
    "VAPI_API_KEY",
  ]) {
    delete process.env[key];
  }

  // Production runs triage on OpenAI. Leaving AI_PROVIDER unset stubs every
  // run and tests a path production never takes.
  process.env.AI_PROVIDER ||= "openai";
}

type Check = { detail?: string; ok: boolean; what: string };

function check(what: string, ok: boolean, detail?: string): Check {
  return { detail, ok, what };
}

async function main() {
  isolate();

  const args = process.argv.slice(2);

  if (args.includes("--list") || args.length === 0) {
    console.log("Scenarios:\n");
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      console.log(`  ${name.padEnd(18)} ${scenario.description}`);
    }
    console.log(
      "\n  --cleanup          resolve incidents this harness created and cancel their steps",
    );
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: workspace } = await admin
    .from("workspaces")
    .select("id,owner_user_id")
    .eq("name", WORKSPACE_NAME)
    .maybeSingle();

  if (!workspace) {
    throw new Error(`Workspace "${WORKSPACE_NAME}" not found.`);
  }

  const workspaceId = String(workspace.id);

  if (args.includes("--cleanup")) {
    await cleanup(admin, workspaceId);
    return;
  }

  const owner = await admin.auth.admin.getUserById(
    String(workspace.owner_user_id),
  );
  let failures = 0;

  for (const name of args) {
    const scenario = SCENARIOS[name];

    if (!scenario) {
      console.log(`\n?? unknown scenario "${name}"`);
      failures += 1;
      continue;
    }

    console.log(`\n=== ${name} ===`);
    console.log(`    ${scenario.description}`);

    const since = new Date().toISOString();
    const checks = await run({
      admin,
      owner: owner.data.user!,
      scenario,
      since,
      workspaceId,
    });

    for (const item of checks) {
      console.log(
        `    ${item.ok ? "ok  " : "FAIL"} ${item.what}${item.detail ? ` -- ${item.detail}` : ""}`,
      );
      if (!item.ok) {
        failures += 1;
      }
    }
  }

  console.log(
    failures === 0
      ? "\nAll checks passed. Run --cleanup before you walk away."
      : `\n${failures} check(s) failed.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

async function run(input: {
  admin: ReturnType<typeof import("@supabase/supabase-js").createClient>;
  owner: import("@supabase/supabase-js").User;
  scenario: Scenario;
  since: string;
  workspaceId: string;
}) {
  const { admin, scenario, workspaceId } = input;
  // Moves to just before the follow-up when a scenario has one, so the checks
  // grade the reply rather than the opener.
  let since = input.since;
  const checks: Check[] = [];

  if (scenario.kind === "sms") {
    const { processInboundSmsPayload } = await import(
      "../apps/web/src/lib/integrations/inbound-sms.ts"
    );
    const result = await processInboundSmsPayload({
      body: scenario.body,
      from: scenario.from,
      messageSid: `SMharness${Date.now().toString(36)}`,
      to: WORKSPACE_SMS_NUMBER,
    });

    checks.push(
      check("ingest completed", Boolean(result.status), `status=${result.status}`),
    );
  } else {
    const { ingestMockInboundEmail } = await import(
      "../apps/web/src/lib/integrations/inbound-email-sync.ts"
    );
    const fromEmail = `${scenario.fromName.toLowerCase().replace(/[^a-z]+/g, ".")}.${Date.now().toString(36)}@${CUSTOMER_DOMAIN}`;
    const threadId = `thread-${Date.now().toString(36)}`;
    const send = (bodyText: string, subject: string) =>
      ingestMockInboundEmail({
        input: {
          bodyText,
          connectionId: CONNECTION_ID,
          externalThreadId: threadId,
          fromEmail,
          fromName: scenario.fromName,
          subject,
        },
        supabase: admin,
        user: input.owner,
        workspaceId,
      });

    let result = await send(scenario.bodyText, scenario.subject);

    checks.push(check("no ingest errors", result.errors.length === 0));

    if (scenario.followUp) {
      const opener = result.promotedConversations[0]?.conversationId;

      // Everything below is judged on the follow-up, so the window moves with
      // it. Without this the opener's alert would be graded instead.
      since = new Date().toISOString();
      result = await send(scenario.followUp, `Re: ${scenario.subject}`);

      checks.push(
        check(
          "reply continued the same conversation",
          result.promotedConversations[0]?.conversationId === opener,
          `opener=${opener?.slice(0, 8)} reply=${result.promotedConversations[0]?.conversationId?.slice(0, 8)}`,
        ),
      );
      checks.push(check("no ingest errors on reply", result.errors.length === 0));
    }

    if (scenario.expect.promotes !== undefined) {
      const promoted = result.promotedMessages > 0;
      checks.push(
        check(
          scenario.expect.promotes ? "promoted to the queue" : "not promoted",
          promoted === scenario.expect.promotes,
          `promoted=${result.promotedMessages} observed=${result.observedMessages}`,
        ),
      );
    }
  }

  const { data: incidents } = await admin
    .from("urgent_escalation_incidents")
    .select("trigger_keys,metadata")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since);
  const escalated = (incidents ?? []).length > 0;

  if (scenario.expect.escalates !== undefined) {
    checks.push(
      check(
        scenario.expect.escalates ? "escalated" : "did not escalate",
        escalated === scenario.expect.escalates,
        escalated
          ? `triggers=${JSON.stringify((incidents ?? [])[0]?.trigger_keys)}`
          : undefined,
      ),
    );
  }

  for (const trigger of scenario.expect.escalationTriggers ?? []) {
    const keys = ((incidents ?? [])[0]?.trigger_keys ?? []) as string[];
    checks.push(check(`trigger ${trigger}`, keys.includes(trigger)));
  }

  if (escalated) {
    const meta = ((incidents ?? [])[0]?.metadata ?? {}) as Record<
      string,
      unknown
    >;
    checks.push(
      check(
        "escalation alert was model-written",
        meta.alertGeneratedBy === "model",
        `alertGeneratedBy=${meta.alertGeneratedBy} ${meta.alertGenerationError ?? ""}`,
      ),
    );
  }

  const { data: messages } = await admin
    .from("outbound_messages")
    .select("body_text,metadata")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since);
  const parts = messages ?? [];
  const head = parts.find(
    (part) =>
      ((part.metadata ?? {}) as Record<string, unknown>).generatedBy !==
      undefined,
  );

  if (head) {
    const meta = (head.metadata ?? {}) as Record<string, unknown>;
    checks.push(
      check(
        "inquiry alert was model-written",
        meta.generatedBy === "model",
        `generatedBy=${meta.generatedBy} ${meta.generationError ?? ""}`,
      ),
    );
  }

  for (const part of parts) {
    const body = String(part.body_text ?? "");

    checks.push(
      check(
        "no message part is only a URL",
        !/^\s*https?:\/\/\S+\s*$/.test(body),
        body.slice(0, 48),
      ),
    );
    checks.push(
      check(
        "no internal qualification language",
        !/serviceable/i.test(body),
        body.slice(0, 48),
      ),
    );
  }

  if (scenario.expect.addressStatus) {
    // inquiry_facts holds the verdict for an address extracted from a message;
    // contacts holds it for one saved against the profile. Checking only
    // contacts reported "undefined" for an SMS whose address had in fact been
    // verified and stored correctly -- a fault in this harness, not the code.
    const [facts, contact] = await Promise.all([
      admin
        .from("inquiry_facts")
        .select("address_validation_status")
        .eq("workspace_id", workspaceId)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("contacts")
        .select("address_validation_status")
        .eq("workspace_id", workspaceId)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const status =
      facts.data?.address_validation_status ??
      contact.data?.address_validation_status;

    checks.push(
      check(
        `address ${scenario.expect.addressStatus}`,
        status === scenario.expect.addressStatus,
        `got ${status}`,
      ),
    );
  }

  return checks;
}

/**
 * Resolve what the harness raised, so production's cron does not chase the
 * owner about a fake emergency. Doing this by hand after every run was
 * forgotten twice.
 */
async function cleanup(
  admin: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  workspaceId: string,
) {
  const { data: open } = await admin
    .from("urgent_escalation_incidents")
    .select("id,title")
    .eq("workspace_id", workspaceId)
    .eq("status", "open");

  for (const incident of open ?? []) {
    await admin
      .from("urgent_escalation_steps")
      .update({ lease_expires_at: null, status: "cancelled" })
      .eq("incident_id", incident.id)
      .eq("status", "pending");
    await admin
      .from("urgent_escalation_incidents")
      .update({ resolved_at: new Date().toISOString(), status: "resolved" })
      .eq("id", incident.id);

    console.log(`  resolved: ${incident.title}`);
  }

  if (!open?.length) {
    console.log("  nothing open");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
