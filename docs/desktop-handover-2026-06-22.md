# Desktop Handover - 2026-06-22

This file is for starting a fresh Codex chat without loading the very large
desktop thread.

## Snapshot

- Branch: `main`
- Live app: `https://kyroassistant.com`
- Web app workspace: `apps/web`
- Production secrets live in Vercel, Supabase, Stripe, Twilio, Vapi, Resend, and
  provider dashboards. Do not commit secrets.

## Current State

Kyro is feature-complete enough for broad testing. Recent work focused on the
settings restructure, compact assistant surfaces, business profile, onboarding
and payment method setup, tutorial overlay, dashboard/report/payments polish,
phone/SMS/Vapi/Twilio flows, and documentation.

## Built Surfaces

### App Shell And Dashboard

- Sidebar: Dashboard, Assistant, Vapi Voice, Inbox, CRM, Files, Payments,
  Activity, Reports, Developer, Settings.
- Dashboard: KPI cards, configurable widgets, mini Assistant, work queue, system
  activity, top contacts, suppliers, and customer payments widget.
- Global search and account pill persist at the top. The account pill opens
  Settings/Sign out. The tutorial can be replayed from the top bar.
- Floating Assistant launcher persists outside the full Assistant page, can
  expand, shows conversation history, typing states, and Assistant dynamic cards.

### Auth, Onboarding, And Tutorial

- Create account is a three-step flow: login/contact details, business basics,
  and inline Stripe payment method for the two-week trial.
- Workspace setup captures operating country and normalized phone context.
- Supabase email verification uses production redirect config plus Resend/custom
  SMTP. Keep Supabase Site URL and redirect URLs pointed at
  `https://kyroassistant.com`.
- First-run tutorial completion is stored per account/workspace. Developer
  controls can replay/reset it during testing.

### Assistant And Memory

- Main Assistant is LLM-first with tool calling, dynamic cards, image generation
  and editing, prompt suggestions that send immediately, and long-context
  compaction.
- Assistant provider labels are hidden from normal users; developer users can see
  provider/fallback diagnostics.
- Fallback responses now avoid pretending the full assistant worked when the main
  model is unavailable.

### Voice, SMS, And Phone

- Vapi internal voice tab is the active voice path; old OpenAI voice controls are
  developer-only.
- Twilio/Vapi phone-number pool can assign one SMS/voice-capable number per
  workspace/country.
- Inbound SMS, outbound SMS, inbound phone, outbound phone, and voicemail overflow
  are built or scaffolded through Vapi/Twilio routes and activity logging.
- Vapi tools include context lookup, contact lookup/update, recent email, web
  search, call notes, SMS sending, and outbound call support.
- User/team phone numbers decide whether inbound calls are internal-user mode or
  customer mode.

### CRM, Inbox, Files, Payments, Reports

- CRM supports normalized email/phone, duplicate review/merge, lifecycle
  suggestions, full contact split panes, and compact pagination.
- Inbox supports email/SMS thread preview, manual/AI replies, task/note controls,
  and compact pagination.
- Files page shows generated and uploaded files with compact rows and pagination.
- Payments tab includes Stripe customer payment links, invoice builder integration,
  default invoice template settings, and customer collection overview.
- Reports tab generates previewable/downloadable PDFs from workspace data.

### Settings

- Settings uses a three-column nested layout.
- Business profile is split into public details, service area, availability,
  branding/email signature, and emergency work.
- Integrations covers inbound email sync, outbound communication, phone/SMS setup,
  and Stripe/payment settings.
- Voice settings focus on Vapi voice and customer phone assistant controls;
  provider/internal IDs are developer-only.
- Developer settings are visible only for developer accounts.

## Next Chat Test List

- Full signup: create account, confirm email, inline Stripe payment method, first
  login, tutorial.
- Supabase email redirects must not point to localhost.
- Stripe webhook should return 2xx with the correct `STRIPE_WEBHOOK_SECRET`.
- Inbound SMS should appear in Inbox/Activity; outbound SMS from Assistant/Vapi
  should send through the assigned workspace number.
- Inbound phone should route through the dynamic Vapi assistant-request path and
  receive workspace variables.
- Outbound phone should use the outbound Vapi assistant and include recent
  chat/context summary.
- Voicemail overflow should be tested with the configured Vapi assistant and
  number.
- Google address autocomplete depends on valid Maps key restrictions and billing.
- Load real Twilio/Vapi phone-number pool rows for AU/NZ/UK/US/CA before real
  users enable phone/SMS.
- Collect Australian legislation documents listed in
  `docs/australian-legislation-knowledge-sources.md`.
- Mobile app should mirror backend contracts for Dashboard, Assistant, Vapi Voice,
  Payments, onboarding/tutorial, and mobile contact import.
