# Google Workspace And Outbound Integration Plan

This is the integration spine for Gmail, Google Drive, and later SMS/voice providers.
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
- Settings UI section for Google Workspace connection status.
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
- The Gmail provider helper is:
  - `apps/web/src/lib/integrations/gmail.ts`

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

Kyro currently requests:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/drive.file`

Reasoning:

- `gmail.send` is enough for approved outbound email without broad inbox access.
- `drive.file` is intentionally narrow: Kyro can create files and work with files
  opened/shared with the app, without asking for full Drive access.
- `openid email profile` lets Kyro label the connected account in Settings.

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
3. Add provider switch in communication settings:
   - dry-run only,
   - real external send with approval required,
   - real external send without approval, if user policy allows.
4. Decide whether outbound email volume should eventually have a customer charge,
   then update pricing rules/ledger snapshots accordingly.
5. Add Gmail native-signature awareness:
   - request the required Gmail settings scope only if we decide the UX needs it,
   - read `users.settings.sendAs` to show whether the connected account has a Gmail web UI signature,
   - avoid relying on Gmail's native signature for Kyro sends because Kyro needs per-email signature selection.
6. Add Gmail inbound later:
   - start with manual import or Gmail watch/history sync,
   - do not request broad Gmail read scopes until the product genuinely needs it.

## Other Providers After Google

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
