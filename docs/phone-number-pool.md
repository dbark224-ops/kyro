# Phone Number Pool

Kyro currently uses a beta-friendly pool of pre-purchased Twilio numbers rather
than buying a number automatically during onboarding. This keeps the first user
cohort simple while preserving the same data model that automatic provisioning
will use later.

## Current Flow

1. The operator buys a voice+SMS-capable number in Twilio.
2. The operator connects/maps that number in Vapi when voice calls are needed.
3. The operator inserts the number into `workspace_phone_numbers` with
   `workspace_id = null` and `status = 'available'`.
4. When a workspace enables phone assistant infrastructure, Kyro:
   - reads the workspace default phone region,
   - reuses an existing active voice+SMS number if one is already assigned,
   - otherwise claims the oldest available pool number in that country,
   - sets `workspace_id`, `assigned_at`, and `status = 'active'`,
   - creates/updates the workspace SMS channel,
   - stores the assigned Vapi phone-number id as the settings fallback when the
     workspace does not already have one.

Unassigned pool rows are hidden from normal workspace users by RLS. Server-side
assignment uses the service role after the user has already been verified as a
workspace member.

## Insert Template

Use Supabase SQL editor or another admin-only path. Keep one row per physical
Twilio number.

```sql
insert into public.workspace_phone_numbers (
  workspace_id,
  provider,
  service,
  phone_number,
  normalized_phone,
  friendly_name,
  provider_phone_number_id,
  country_code,
  region,
  capabilities,
  status,
  purchased_at,
  monthly_cost_snapshot,
  currency,
  metadata,
  assignment_source
) values (
  null,
  'twilio',
  'programmable_messaging',
  '+61 7 4517 4330',
  '+61745174330',
  'Kyro AU pool 001',
  'PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'AU',
  'QLD',
  '{"sms": true, "voice": true, "mms": true}'::jsonb,
  'available',
  now(),
  3.00,
  'USD',
  '{
    "vapiPhoneNumberId": "vapi-phone-number-id",
    "poolLabel": "beta-au-001"
  }'::jsonb,
  'manual_pool'
);
```

For US rows, set `country_code = 'US'`, `region` to the state/market, and store
the US E.164 number in `normalized_phone`.

## Later Automatic Provisioning

When signup volume grows, keep the same assignment helper and replace only the
"no available number" branch with:

1. Twilio available-number search for the workspace country.
2. Twilio purchase.
3. Messaging-service/webhook configuration.
4. Vapi phone-number import/configuration.
5. Insert the same `workspace_phone_numbers` row with
   `assignment_source = 'twilio_auto_purchase'`.
6. Assign the row to the workspace through the same code path.

The rest of Kyro should not need to care whether a number came from the manual
pool or an automated purchase.
