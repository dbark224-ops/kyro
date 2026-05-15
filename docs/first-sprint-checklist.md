# First Sprint Checklist

## Objective

Create the running Kyro foundation: tenant model, database schema, backend boundaries,
event/action engine, and a basic app shell.

Status: first sprint foundation is complete. This checklist is kept as a historical
definition of the first milestone; the app now also includes inbox review depth,
contacts profiles, internal quote drafts, Assistant, Settings, local Ollama testing,
and Usage visibility.

## Build Order

1. Scaffold the Next.js app.
2. Create shared API contract package.
3. Add Supabase configuration.
4. Add Drizzle migrations.
5. Create workspace/auth foundation.
6. Create core CRM tables.
7. Create event/action/audit tables.
8. Create model routing and usage metering tables.
9. Create pricing, budget, and entitlement tables.
10. Add backend service modules.
11. Add a basic dashboard shell.
12. Add stub workflows for inbound events.
13. Add stub AI run recording.
14. Add stub usage recording.

## First Tables to Implement

- `users`
- `workspaces`
- `workspace_members`
- `business_profiles`
- `contacts`
- `leads`
- `channels`
- `conversations`
- `messages`
- `events`
- `actions`
- `ai_runs`
- `model_routes`
- `model_route_decisions`
- `usage_events`
- `usage_rollups`
- `pricing_rules`
- `workspace_budgets`
- `workspace_entitlements`
- `audit_logs`
- `files`
- `workspace_policies`

## First Backend Services

- `workspace.service.ts`
- `entitlement.service.ts`
- `policy.service.ts`
- `model-router.service.ts`
- `usage.service.ts`
- `pricing.service.ts`
- `billing.service.ts`
- `event.service.ts`
- `action.service.ts`
- `audit.service.ts`
- `ai-run.service.ts`
- `contact.service.ts`
- `lead.service.ts`
- `conversation.service.ts`

## First UI Screens

- Sign in.
- Workspace onboarding.
- Dashboard.
- Inbox/conversations.
- Leads.
- Contacts.
- Assistant chat.
- Settings: business profile.
- Settings: outbound approval policy.

## Definition of Done

- A user can create a workspace.
- A workspace has a business profile.
- A workspace has outbound email/SMS policy settings.
- A workspace has basic model routing and usage budget settings.
- A workspace has entitlement records that both web and iOS can read through the API.
- A usage event stores provider cost and customer charge snapshots.
- A contact, lead, conversation, and message can be created locally.
- An event can be recorded and processed by a stub workflow.
- An action can move through requested, pending approval, approved, executing, completed, or failed.
- All action state changes create audit logs.
- An AI run can be recorded even before real AI is wired in.
- A usage event can be recorded against a user, workspace, AI run, action, and provider.

## Do Not Start Yet

- Gmail OAuth.
- Twilio.
- Image generation.
- Document rendering.
- Payment handling.
- Complex automations.

The internal event/action/data model now works for the mock workflow, but these items
remain intentionally deferred until the mock inquiry, document, and outbound loops are
polished.
