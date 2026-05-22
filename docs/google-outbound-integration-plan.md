# Workspace Email And Outbound Integration Plan

This is the integration spine for Gmail, Outlook/Microsoft Graph, Google Drive, and
later SMS/voice providers.
The product rule stays the same: external side effects go through Kyro's action engine
and workspace communication policy before anything leaves the system.

## What Is Built Now

- Database schema for connected provider accounts:
  - `integration_connections`
  - `integration_oauth_states`
- RLS policies for those tables, scoped by workspace membership.
- Encrypted token payload helper:
  - `apps/web/src/lib/integrations/token-vault.ts`
- Google OAuth configuration/status helper:
  - `apps/web/src/lib/integrations/google.ts`
- Google OAuth routes:
  - `/integrations/google/start`
  - `/integrations/google/callback`
- Combined Settings Integrations area for Google Workspace and Microsoft Outlook
  connection status.
- Settings can disconnect a Google or Outlook account by clearing Kyro's stored
  token payload, marking the connection disconnected, and deactivating the tied
  email channel. Reconnection uses the same OAuth connect flow, which is how old
  accounts pick up newly requested read scopes.
- Gmail channel creation after Google connection, marked as `externalSendEnabled: true`.
- Gmail access-token refresh helper:
  - decrypts the stored refresh token,
  - refreshes the access token,
  - re-encrypts and stores the updated token set.
- Gmail outbound sender:
  - builds a text/plain, multipart/alternative, or multipart/mixed RFC 2822/MIME email depending on HTML signature and attachments,
  - calls Gmail `users.messages.send`,
  - saves the Gmail message id into `messages.external_message_id`,
  - records `metadata.externalSend = true` and `metadata.dryRun = false`.
- Kyro-managed email signatures:
  - default signature applies to user-written manual replies and AI drafts edited before send,
  - optional assistant signature applies to AI-generated replies sent untouched,
  - signature text is appended to the plain-text body,
  - signature logo files are stored as small inline settings payloads for now and sent as inline MIME images.
- Manual reply composers send immediately because the user-written message and send
  click are the approval. AI-generated/action-queue sends still use action approval.
- Gmail can attach local files uploaded in the composer, with a current limit of 5
  files and 10 MB total per send.
- Gmail can attach a generated text snapshot of a selected quote draft. This is the
  temporary generated-document attachment until PDF/template rendering is built.
- Zero-cost Gmail usage ledger rows are recorded for each real outbound email so
  billing summaries can count volume now and add pricing later.
- The shared outbound helper is:
  - `apps/web/src/lib/communication/outbound.ts`
- The shared email-provider router is:
  - `apps/web/src/lib/integrations/mail.ts`
- The Gmail provider helper is:
  - `apps/web/src/lib/integrations/gmail.ts`
- The Outlook provider helper is:
  - `apps/web/src/lib/integrations/outlook.ts`
- Gmail and Outlook inbound email sync:
  - requests read scopes (`gmail.readonly` / `Mail.Read`),
  - fetches recent inbox messages through provider APIs,
  - writes idempotent `events` rows before processing,
  - classifies new messages with lightweight heuristics and optional OpenAI structured-output classification,
  - promotes business-actionable messages into contacts, leads, conversations, messages, and AI triage,
  - keeps skipped/non-actionable mail as minimal processed events, with optional lightweight summaries, rather than full CRM threads.
- Inbound email settings:
  - stored in `workspace_policies` as `inbound_email`,
  - default to five-minute active-hours polling,
  - pause scheduled polling during the 10pm-4am quiet window to reduce provider/API/classifier cost,
  - allow manual-only, paused, same-interval overnight, and custom interpretation rules.
- Protected scheduled sync endpoint:
  - `/api/integrations/email/sync`
  - accepts Vercel Cron `GET` calls and manual/testing `POST` calls
  - requires `INBOUND_EMAIL_SYNC_SECRET` or Vercel's `CRON_SECRET`
  - registered in `vercel.json` to run every five minutes in production
  - uses the server-only Supabase service-role client.

## Microsoft Outlook Setup Needed

In Microsoft Entra / Azure Portal:

1. Create an app registration.
2. Use supported account types that match the product audience:
   - personal Microsoft accounts and organizational accounts for broad testing, or
   - organizational accounts only if Kyro is limited to Microsoft 365 tenants.
3. Add a web redirect URI:
   - `http://127.0.0.1:3000/integrations/microsoft/callback` for local development
   - production app URL later.
4. Create a client secret.
5. Add delegated Microsoft Graph permissions:
   - `User.Read`
   - `Mail.Send`
   - `Mail.Read`
   - `openid`
   - `email`
   - `profile`
   - `offline_access`
6. Add local env vars:
   - `MICROSOFT_CLIENT_ID`
   - `MICROSOFT_CLIENT_SECRET`
   - `MICROSOFT_TENANT_ID=common` for mixed personal/work accounts, or a tenant id later
   - `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000`
   - `INTEGRATION_TOKEN_ENCRYPTION_KEY`

Some Microsoft 365 tenant accounts may require an admin to approve `Mail.Send`.
That is expected and should be surfaced in testing before public launch.

## Google Cloud Setup Needed

In Google Cloud Console:

1. Create or select a Google Cloud project.
2. Enable APIs:
   - Gmail API
   - Google Drive API
3. Configure OAuth consent screen:
   - App name: Kyro
   - Support email: David's chosen support email
   - Audience: external while testing unless it is only for a Google Workspace org
   - Add test users while the app is in testing
4. Create OAuth client credentials:
   - Application type: Web application
   - Authorized redirect URI:
     - `http://localhost:3000/integrations/google/callback` for local development
     - production app URL later
5. Add local env vars:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
   - `INTEGRATION_TOKEN_ENCRYPTION_KEY`

Use a long random value for `INTEGRATION_TOKEN_ENCRYPTION_KEY`. It is hashed into
an AES-256-GCM key and never sent to the browser.

## Current Scopes

Kyro currently requests these Google scopes:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/drive.file`

Reasoning:

- `gmail.send` is enough for approved outbound email.
- `gmail.readonly` is used for poll-based inbound sync without permission to mutate the inbox.
- `drive.file` is intentionally narrow: Kyro can create files and work with files
  opened/shared with the app, without asking for full Drive access.
- `openid email profile` lets Kyro label the connected account in Settings.

Kyro currently requests these Microsoft scopes:

- `openid`
- `email`
- `profile`
- `offline_access`
- `https://graph.microsoft.com/User.Read`
- `https://graph.microsoft.com/Mail.Send`
- `https://graph.microsoft.com/Mail.Read`

Reasoning:

- `Mail.Send` is enough for approved outbound Outlook email.
- `Mail.Read` is used for poll-based inbound sync without permission to mutate the mailbox.
- `User.Read` lets Kyro label the connected account using Microsoft Graph `/me`.
- `offline_access` lets Kyro refresh access tokens without asking the user to reconnect every hour.

## Remaining Build Steps

1. Upgrade generated-document attachments:
   - render quote/invoice PDFs from saved templates,
   - upload generated documents to Drive,
   - attach generated Drive/PDF files to Gmail sends,
   - keep local file uploads available from the manual composer.
2. Add Drive document creator:
   - render quote/invoice PDF from saved template,
   - upload with Drive `files.create`,
   - save Google Drive file id/link in `files.metadata` or document metadata,
   - attach to outbound email when requested.
3. Add a default sender/provider switch in communication settings:
   - choose Gmail or Outlook when both are connected,
   - dry-run only,
   - real external send with approval required,
   - real external send without approval, if user policy allows.
4. Decide whether outbound email volume should eventually have a customer charge,
   then update pricing rules/ledger snapshots accordingly.
5. Add Gmail native-signature awareness:
   - request the required Gmail settings scope only if we decide the UX needs it,
   - read `users.settings.sendAs` to show whether the connected account has a Gmail web UI signature,
   - avoid relying on Gmail's native signature for Kyro sends because Kyro needs per-email signature selection.
6. Harden inbound email sync:
   - add a production scheduler that calls `/api/integrations/email/sync` every five minutes,
   - monitor provider quotas and tune `maxMessagesPerSync`,
   - consider Gmail watch/history or Microsoft Graph subscriptions only after the poll-based model proves worthwhile,
   - add per-provider default sender/inbox selection when multiple accounts are connected.

## Other Providers After Email

- Twilio SMS:
  - `integration_connections` provider `twilio`
  - send SMS only after communication policy check
  - record message sid and usage
- Twilio voice/calling:
  - likely separate user permission policy because voice is higher impact
- Stripe billing:
  - keep separate from communication integrations
  - usage ledger already exists and should feed invoices/customer billing later

## Security Notes

- Never expose refresh tokens or client secrets to browser code.
- Store provider tokens only in encrypted `integration_connections.token_set`.
- Keep OAuth `state` hashed in the database.
- Keep all external sends behind the action engine.
- Gmail attachments are limited in the app before send. Local uploads are not stored
  permanently yet; they are read for the outbound send and recorded as message
  metadata. Generated quote draft attachments are text snapshots until Drive/PDF
  handling is implemented.
- Signature logos are stored directly in communication settings only as a short-term
  MVP path. Move them into Supabase Storage or Drive-backed workspace assets before
  large/public usage.
- Prefer narrow scopes; add broader scopes only when a concrete feature needs them.
