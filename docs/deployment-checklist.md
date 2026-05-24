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
- `OPENAI_API_KEY`: OpenAI key for assistant, triage, realtime voice, transcription, and reply drafting.
- `GOOGLE_CLIENT_ID`: Google OAuth client id.
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret.
- `INTEGRATION_TOKEN_ENCRYPTION_KEY`: stable secret used to encrypt OAuth refresh tokens.
- `INBOUND_EMAIL_SYNC_SECRET` or `CRON_SECRET`: bearer secret for scheduled email sync.

Optional until those integrations are enabled:

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_VOICE_NUMBER`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

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

## 6. OpenAI And Realtime Voice

Verify production has:

- `OPENAI_API_KEY`,
- assistant/text model vars,
- realtime model and voice vars,
- transcription/TTS model vars if using fallback speech routes.

Run a smoke test for:

- text assistant answer,
- realtime voice session creation,
- pronunciation preview,
- reply draft generation,
- inbound email classifier path.

## 7. Scheduled Email Sync

`vercel.json` registers:

```json
{
  "path": "/api/integrations/email/sync",
  "schedule": "*/5 * * * *"
}
```

Before enabling production cron:

- set `INBOUND_EMAIL_SYNC_SECRET` or `CRON_SECRET`,
- confirm `/api/integrations/email/sync` returns authorized only with the bearer secret,
- run one manual sync from Settings,
- confirm reconnect-needed states are visible for accounts with missing scopes or undecryptable tokens,
- confirm quiet-hours settings suppress scheduled checks when expected.

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
9. Smoke test sign-in, Settings, Assistant, Voice, Inbox, Gmail connect, Gmail send, and inbound sync.

## 9. Current Known Production Gaps

- Gmail/Outlook push mailbox watches are deferred; production uses 5-minute polling.
- SMS/phone providers are not connected yet.
- Native iOS shell is future work; current UI is web/iOS-shaped.
- Billing UI is usage visibility only, not payment collection.
- Quote PDF generation can download/send server-generated PDFs, but durable PDF storage, Drive sync, accounting exports, and payment collection are still future work.
