# Twilio WhatsApp Sandbox — Testing Runbook

Kyro currently uses Twilio's **WhatsApp Sandbox** as a stand-in for outbound SMS while
real SMS number verification is unresolved. Outbound messages addressed to the owner's
own number are rerouted over WhatsApp instead of SMS.

This is **testing scaffolding only**. It does not affect customer-facing SMS, which
still goes through the normal Twilio SMS path and the outbox ledger.

## TL;DR — the daily reset

Messages stopped arriving? From your phone, WhatsApp this to **+1 415 523 8886**:

```
join <your-sandbox-code>
```

That single action fixes both expiry cases below. Do it and messages resume immediately.

## The two separate timers (this is the confusing part)

| Timer | Length | What breaks | Fix |
| --- | --- | --- | --- |
| **24-hour customer service window** | 24h since **your** last message *to* the sandbox | Kyro can only send pre-approved templates. Freeform Kyro messages fail. | Send **any** WhatsApp message to the sandbox number |
| **Sandbox participation** | **3 days** since joining | You are removed from the sandbox entirely | Send `join <your-sandbox-code>` |

The one you hit daily is the **24-hour window**, not the sandbox join. That is a
WhatsApp platform rule, not a Twilio one — WhatsApp only permits freeform business
messages within 24 hours of the user's last inbound message.

Because sending the join phrase *also* counts as an inbound message, it resets both
timers at once. That is why the TL;DR works regardless of which one expired.

## Where to find your sandbox code

Twilio Console → **Messaging** → **Try it out** → **Send a WhatsApp message**.

The code is shown on that page as a two-word phrase, e.g. `join fresh-panda`. It is
tied to your Twilio account and does not change.

## Verifying it worked

1. After sending the join phrase you should get an immediate Twilio confirmation reply
   in WhatsApp.
2. Trigger any Kyro action that sends you a message.
3. Confirm it arrives in WhatsApp.
4. If it still fails, check Twilio Console → **Monitor** → **Logs** → **Messaging** for
   the error. Code `63016` means the 24-hour window is closed (freeform outside the
   session); code `63015` means the recipient is not a sandbox participant.

## How Kyro wires this up

- `lib/integrations/twilio.ts` — `whatsappSandboxRoute()` rewrites the destination to
  `whatsapp:<TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT>` and the sender to
  `whatsapp:<TWILIO_WHATSAPP_SANDBOX_NUMBER>` (defaults to `+14155238886`).
- `app/api/integrations/twilio/whatsapp/route.ts` — inbound sandbox webhook. Records an
  `inbound.whatsapp_sandbox.received` event and meters delivery as
  `whatsapp_sandbox_delivery`.
- Env vars (values live in Vercel, never in the repo):
  `TWILIO_WHATSAPP_SANDBOX_NUMBER`, `TWILIO_WHATSAPP_SANDBOX_WORKSPACE_ID`,
  `TWILIO_WHATSAPP_SANDBOX_TEST_RECIPIENT`.
- Webhook path constant: `TWILIO_WHATSAPP_SANDBOX_WEBHOOK_PATH`.

Only messages addressed to the configured test recipient are rerouted. Everything else
follows the normal SMS path.

## Getting off the sandbox

The sandbox exists because outbound SMS number verification was unresolved. The real
fix depends on which blocker applies:

- **Twilio trial account** — trial accounts can only send to *verified* numbers. Verify
  your number under Phone Numbers → Verified Caller IDs, or upgrade the account to
  remove the restriction entirely.
- **US/Canada numbers** — require **A2P 10DLC** brand and campaign registration before
  application-to-person SMS will deliver. This takes days and is the most common cause
  of silently failing outbound SMS.
- **Australian numbers** — generally no A2P registration needed, but alphanumeric sender
  IDs and some content are restricted.

Once real SMS delivers reliably, this reroute should be removed rather than left in
production code. Track that as a cleanup item.

## Related

- `docs/phone-number-pool.md` — the pre-purchased number pool model
- `docs/deployment-checklist.md` §5b — Twilio SMS configuration checklist
