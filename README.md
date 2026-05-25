# Kyro

Kyro is a context-aware business assistant for sole traders and small service operators.

The V1 product is centered on communications, leads, documents, and controlled AI actions:

- Ingest inbound email, web form, and overflow call events.
- Normalize communication into contacts, leads, conversations, messages, and tasks.
- Let the user operate the business through an AI chat control surface.
- Allow AI to create and send outbound communications according to workspace policy.
- Generate and save user-instructed documents from predefined templates.
- Generate or edit images as attached AI artifacts.

Start here:

- [Current architecture](docs/current-architecture.md)
- [V1 foundation](docs/v1-foundation.md)
- [Data model](docs/data-model.md)
- [Database setup](docs/database.md)
- [Model routing and usage metering](docs/model-routing-and-usage.md)
- [Platform strategy](docs/platform-strategy.md)
- [Usage-based billing](docs/usage-based-billing.md)
- [Implementation plan](docs/implementation-plan.md)
- [Desktop handover - May 24, 2026](docs/desktop-handover-2026-05-24.md)

## Local Development

```bash
npm install
npm run dev
```

The first scaffold is an API-first monorepo:

- `apps/web`: Next.js web app.
- `packages/contracts`: shared validation schemas and API contracts.
- `packages/db`: Drizzle schema.
- `packages/api`: backend service boundaries.
- `packages/ai`: model routing.
- `packages/jobs`: workflow stubs.
- `packages/core`: shared product constants.
