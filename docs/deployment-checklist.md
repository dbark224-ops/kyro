# Deployment Checklist

This is the practical production checklist for deploying Kyro. It focuses on the current Next.js + Supabase + OpenAI + Google/Outlook architecture.

## 1. Environment Variables

Run the local validator before deploy:

```bash
npm run env:check
```

Run the production-mode validator against exported production values or a production env file:

```bash
npm run env:check:production
# or
node scripts/check-env.mjs --production --env-file=.env.production
```

Required for the current product:

- `NEXT_PUBLIC_APP_URL`: canonical deployed app URL, not localhost in production.
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase publishable/anon key for browser clients.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase service role key.
- `DATABASE_URL`: Postgres connection string used by Drizzle migrations.
- `OPENAI_API_KEY`: OpenAI key for assistant, triage, realtime voice, transcription, reply drafting, and image generation.
- `GOOGLE_CLIENT_ID`: Google OAuth client id.
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret.
- `INTEGRATION_TOKEN_ENCRYPTION_KEY`: stable secret used to encrypt OAuth refresh tokens.
- `INBOUND_EMAIL_SYNC_SECRET` or `CRON_SECRET`: bearer secret for scheduled email sync and outbox processing.
- `OUTBOUND_DELIVERY_SECRET`: optional separate bearer secret for `/api/outbox/process`; if omitted, Kyro accepts `INBOUND_EMAIL_SYNC_SECRET` or `CRON_SECRET`.
- `ASSISTANT_SUGGESTION_REFRESH_SECRET`: optional separate bearer secret for `/api/assistant/suggestions/refresh`; if omitted, Kyro accepts `CRON_SECRET`.
- `KYRO_FILE_STORAGE_BUCKET`: optional private Supabase Storage bucket name for inbound attachments, assistant uploads, generated images, and retryable outbound email attachments. Defaults to `kyro-files`.

Optional until those integrations are enabled:

- `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, and `OPENAI_IMAGE_QUALITY` if production wants image-generation defaults beyond the app defaults. Kyro currently defaults to `gpt-image-2`, high quality, and `auto` size, with prompt-aware landscape/portrait/square overrides only when the user explicitly asks for a format. `OPENAI_IMAGE_COST_PER_IMAGE` is only a fallback when provider image token usage is unavailable; production can also override token prices with `OPENAI_IMAGE_TEXT_INPUT_COST_PER_1M`, `OPENAI_IMAGE_INPUT_COST_PER_1M`, and `OPENAI_IMAGE_OUTPUT_COST_PER_1M` or model-specific `OPENAI_<MODEL>_IMAGE_*` keys.
- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_ADDRESS_VALIDATION_API_KEY` if using a separate key from Places
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_VOICE_NUMBER`
- optional SMS/voice pricing overrides: `TWILIO_SMS_OUTBOUND_UNIT_COST_USD`,
  `TWILIO_SMS_INBOUND_UNIT_COST_USD`, `TWILIO_VOICE_UNIT_COST_USD`,
  `TWILIO_NUMBER_MONTHLY_COST_USD`, and `TWILIO_MARKUP_RATE`
- `VAPI_API_KEY`
- `VAPI_WEBHOOK_SECRET`
- `VAPI_TOOL_SECRET`
- `NEXT_PUBLIC_VAPI_PUBLIC_KEY`
- optional Vapi defaults: `VAPI_PHONE_NUMBER_ID`,
  `VAPI_DEFAULT_ASSISTANT_ID`, `VAPI_INTERNAL_ASSISTANT_ID`,
  `VAPI_INBOUND_ASSISTANT_ID`, `VAPI_VOICEMAIL_OVERFLOW_ASSISTANT_ID`, and
  `VAPI_OUTBOUND_ASSISTANT_ID`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

## 1a. Auth Email / Resend

Production auth email is sent through Supabase Auth using the configured SMTP
provider. Kyro currently uses Resend for this path.

- Configure Supabase Auth SMTP with the production Resend credentials.
- Set the Supabase Site URL to `https://kyroassistant.com`.
- Add redirect URLs for `https://kyroassistant.com/**`; localhost redirects are
  only for local development.
- Keep the Supabase confirmation template branded and make the button use
  Supabase's `{{ .ConfirmationURL }}` variable.
- Send a new signup confirmation email after changing SMTP/template settings and
  confirm the link resolves to the live app, not localhost.

## 1b. Stripe User Billing And Customer Payments

Stripe is used for two different product paths: Kyro billing its own users, and
workspaces collecting customer payments through connected/customer payment flows.

- Set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, and
  `STRIPE_WEBHOOK_SECRET` in Vercel Production.
- Configure the webhook endpoint as
  `${NEXT_PUBLIC_APP_URL}/api/integrations/stripe/webhook` and verify Stripe sees
  a 2xx response.
- Complete the Stripe platform/Connect setup before testing workspace payment
  links or connected payment onboarding.
- Test the create-account inline payment-method flow with the production publishable
  key and the matching live secret key.
- Do not expose provider margin to customers; user-facing usage should show the
  final customer charge while internal ledgers can keep provider cost and margin.

## 2. Secret Handling

- Do not commit `.env`, `.env.local`, `.env.production`, or provider secrets.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Never expose it through `NEXT_PUBLIC_` variables.
- Keep `INTEGRATION_TOKEN_ENCRYPTION_KEY` stable for a deployed environment. Changing it makes existing stored OAuth tokens undecryptable and forces provider reconnects.
- Rotate any key that has been pasted into chat, logs, screenshots, or issue trackers before production use.

## 3. Supabase

Before deployment:

```bash
npm run db:check
npm run db:migrate
```

Verify:

- migrations apply successfully,
- RLS policies match the workspace-scoped access model,
- Data API exposure settings are intentional for public schema tables,
- service-role access is only used from server routes/actions/helpers,
- the production database is not using a local or throwaway connection string.
- `quote_approval_links` is not granted to `anon`; public customer approval pages load by token hash through server-only service-role code.
- Developer -> System Health shows all required tables as reachable through the expected server-side Supabase client path.

## 4. Google OAuth

In Google Cloud Console, configure the production OAuth client:

- Authorized JavaScript origin: production `NEXT_PUBLIC_APP_URL` origin.
- Authorized redirect URI: `${NEXT_PUBLIC_APP_URL}/integrations/google/callback`.
- Scopes include Gmail send and Gmail read access currently required by Kyro.
- OAuth consent screen has the right app name, support email, privacy policy, and test/production publishing state.

Existing local accounts may need disconnect/reconnect when moving environments because OAuth tokens are encrypted with the environment's `INTEGRATION_TOKEN_ENCRYPTION_KEY`.

## 5. Outlook OAuth

If Outlook is enabled, configure Microsoft Entra:

- redirect URI: `${NEXT_PUBLIC_APP_URL}/integrations/microsoft/callback`,
- client id and secret in production env,
- tenant id set to `common` unless the product is limited to one tenant,
- Mail read/send scopes reviewed and approved.

## 5a. Google Maps Address Lookup

If address autocomplete/verification is enabled:

- enable Places API (New) for autocomplete and place details,
- enable Address Validation API if stricter postal validation is desired,
- set `GOOGLE_MAPS_API_KEY` server-side,
- optionally set `GOOGLE_ADDRESS_VALIDATION_API_KEY` if validation uses a different key,
- set the workspace default phone region to the main country so autocomplete
  restricts suggestions to that country,
- optionally set `GOOGLE_MAPS_LOCATION_BIAS_LAT`,
  `GOOGLE_MAPS_LOCATION_BIAS_LNG`, and
  `GOOGLE_MAPS_LOCATION_BIAS_RADIUS_METERS` to bias suggestions toward the
  business service area without blocking valid interstate addresses,
- restrict the key to the deployed app/server environment before production use,
- test CRM profile address editing, Inbox inquiry-fact address editing, and Developer mock inbound.

## 5b. Twilio SMS Foundation

If Twilio SMS is enabled:

- set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` server-side,
- optionally set `TWILIO_MESSAGING_SERVICE_SID` for Messaging Service sends,
- optionally set `TWILIO_VOICE_NUMBER` as a temporary testing sender,
- apply migrations so `workspace_phone_numbers` exists,
- add a workspace phone-number row for the Twilio destination number before
  testing inbound SMS,
- configure the Twilio inbound message webhook to
  `${NEXT_PUBLIC_APP_URL}/api/integrations/twilio/sms`,
- configure the delivery status callback to
  `${NEXT_PUBLIC_APP_URL}/api/integrations/twilio/status`,
- send one inbound SMS and confirm it creates a CRM conversation,
- send one outbound SMS from an Inbox/Assistant preview and confirm it appears in
  the outbox, conversation thread, Log, Usage, and Assistant activity pane.

## 5c. Vapi Phone Assistant Foundation

If Vapi phone calls are enabled:

- set `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, and `VAPI_TOOL_SECRET` server-side,
- create Vapi bearer-token Custom Credentials for Kyro webhook/tool calls and set
  `VAPI_WEBHOOK_CREDENTIAL_ID` and `VAPI_TOOL_CREDENTIAL_ID`; Kyro injects the
  webhook credential id into dynamic server URLs, and each Vapi tool definition
  should also use the tool credential id,
- set `NEXT_PUBLIC_VAPI_PUBLIC_KEY` only if the browser/mobile Vapi voice runtime
  is enabled,
- review the internal Vapi STT defaults, or override them with
  `VAPI_INTERNAL_TRANSCRIBER_PROVIDER`, `VAPI_INTERNAL_TRANSCRIBER_MODEL`, and
  `VAPI_INTERNAL_TRANSCRIBER_LANGUAGE`,
- configure `NEXT_PUBLIC_APP_URL` to a public HTTPS URL reachable by Vapi,
- apply migrations so `voice_calls` and `voice_call_events` exist,
- create Vapi assistants for internal Kyro voice testing, inbound customer calls,
  voicemail overflow, and outbound customer calls,
- connect a Twilio voice-capable number to Vapi,
- configure the Vapi webhook/server URL to
  `${NEXT_PUBLIC_APP_URL}/api/integrations/vapi/webhook`,
- configure Vapi tools to call
  `${NEXT_PUBLIC_APP_URL}/api/integrations/vapi/tool`,
- include the core internal tools: `kyro_context_lookup`, `kyro_lookup_contact`,
  `kyro_update_contact`, `kyro_web_search`, `kyro_check_recent_email`, and
  `kyro_record_call_note`,
- save Vapi assistant ids in Settings -> Voice, and use the Settings
  phone-number id only as a fallback,
- for production multi-number routing, create one `workspace_phone_numbers` row
  per Twilio number and store the connected Vapi phone-number id in
  `metadata.vapiPhoneNumberId`; Kyro will choose an AU/US number by the
  customer's destination country before falling back,
- choose the workspace ElevenLabs/Vapi voice in Settings -> Voice; the default
  is Female - Australian and is passed to the Vapi browser/mobile runtime and
  outbound Vapi calls as a voice override,
- set the same voice on inbound and voicemail-overflow assistants in Vapi until
  Kyro supports dynamic incoming-call assistant overrides,
- save the internal Vapi assistant id in Settings -> Voice or set
  `VAPI_INTERNAL_ASSISTANT_ID`,
- add user/team numbers in Settings -> Voice so owner calls are treated as
  internal instructions,
- open `/voice-vapi`, confirm it starts with the Vapi public key, and verify
  completed turns persist into the main Assistant thread,
- place one inbound test call and one outbound test call, then confirm each
  appears in Assistant -> Kyro activity with transcript, recording URL when
  available, provider events, and usage ledger rows when provider cost/duration
  is available.

## 6. OpenAI, Images, And Realtime Voice

Verify production has:

- `OPENAI_API_KEY`,
- assistant/text model vars,
- image-generation vars if overriding the defaults,
- realtime model and voice vars,
- transcription/TTS model vars if using fallback speech routes.

Run a smoke test for:

- Developer -> System Health, confirming no required production check is unexpectedly missing,
- Developer -> Smoke Test Checklist, using it as the manual runbook for the items below,
- text assistant answer,
- text assistant image generation with and without an uploaded reference image,
- realtime voice session creation,
- Vapi internal voice session creation, if `NEXT_PUBLIC_VAPI_PUBLIC_KEY` is set,
- pronunciation preview,
- reply draft generation,
- quote approval link creation and the no-login `/quote/approve/[token]` customer page,
- inbound email classifier path.

## 7. Scheduled Email Sync

`vercel.json` registers:

```json
{
  "path": "/api/integrations/email/sync",
  "schedule": "*/5 * * * *"
}
```

It also registers the outbound delivery processor:

```json
{
  "path": "/api/outbox/process",
  "schedule": "*/5 * * * *"
}
```

It also registers the weekly adaptive assistant suggestion refresh:

```json
{
  "path": "/api/assistant/suggestions/refresh",
  "schedule": "0 11 * * 0"
}
```

Before enabling production cron:

- set `INBOUND_EMAIL_SYNC_SECRET` or `CRON_SECRET`,
- set `ASSISTANT_SUGGESTION_REFRESH_SECRET` if the assistant suggestion refresh should not share `CRON_SECRET`,
- confirm `/api/integrations/email/sync` returns authorized only with the bearer secret,
- confirm `/api/outbox/process` returns authorized only with `OUTBOUND_DELIVERY_SECRET`, `INBOUND_EMAIL_SYNC_SECRET`, or `CRON_SECRET`,
- confirm `/api/assistant/suggestions/refresh` returns authorized only with `ASSISTANT_SUGGESTION_REFRESH_SECRET` or `CRON_SECRET`,
- run one manual sync from Settings,
- check the Settings inbound trace for the latest sync run counts and recent email decisions,
- confirm reconnect-needed states are visible for accounts with missing scopes or undecryptable tokens,
- confirm quiet-hours settings suppress scheduled checks when expected.
- confirm the private attachment bucket exists or can be created by the service-role server path,
- send a test inbound email with an attachment and verify the Inbox/Assistant preview shows a downloadable attachment chip.
- send a test outbound email with a local file or quote PDF attachment and verify the outbox row stores `fileId`/`storagePath` references rather than base64 payloads.
- force a failed outbound email by disconnecting/revoking the provider, confirm `outbound_messages.status` moves to `retry_scheduled` or `failed`, reconnect, and retry from the Inbox delivery panel or Developer -> Outbox operations.

## 8. Vercel Deployment

Recommended deploy sequence:

1. Add production env vars in Vercel.
2. Run `npm run env:check:production` against the same values if exported locally.
3. Run `npm run test`.
4. Run `npm run typecheck`.
5. Run `npm run lint`.
6. Run `npm run build`.
7. Apply migrations with `npm run db:migrate` against production only when ready.
8. Deploy.
9. Open Developer -> System Health and confirm required production checks are green or explicitly understood.
10. Run Developer -> Smoke Test Checklist for sign-in, Settings, Assistant, Voice, Inbox, Gmail connect, Gmail send, generated documents, outbox, Log/audit, and inbound sync.

## 9. Current Known Production Gaps

- Gmail/Outlook push mailbox watches are deferred; production uses 5-minute polling.
- Inbound email attachments are persisted to private Supabase Storage when provider bytes are available, but richer Drive/job-file organisation is future work.
- Deep provider history/watch sync is deferred; current thread matching uses provider thread id, RFC references, and same-contact same-subject fallback.
- Twilio SMS has a first send/receive foundation, but user-facing number purchase,
  SMS compliance/opt-out hardening, and internal-operator SMS classification are
  still future work.
- Vapi/Twilio phone calls have a first backend foundation, but live Vapi prompts,
  number wiring, recording retention, urgent escalation, and post-call CRM action
  automation still need production testing. `/voice-vapi` is a separate internal
  voice-runtime testbed and should not replace the OpenAI `/voice` path until it
  is tested with the chosen production Vapi assistant.
- Native iOS shell is future work; current UI is web/iOS-shaped.
- Billing UI is usage visibility only, not payment collection.
- Image generation is Assistant/file-storage backed. Rich media gallery/history, multi-turn visual editing, and mobile camera-first flows are future work.
