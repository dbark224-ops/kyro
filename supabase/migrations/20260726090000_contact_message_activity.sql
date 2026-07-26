-- The contacts list needs two numbers per contact: how many messages, and when
-- the last one was. It was getting them by fetching every message row for every
-- listed contact and counting them in JavaScript.
--
-- That was survivable while the list was capped at 100 contacts. Removing that
-- cap (so a workspace can actually see all its contacts) widened the same query
-- to every contact in the workspace, and it already grew without bound as
-- message history accumulated.
--
-- Postgres can answer this in one aggregate. SECURITY INVOKER matters here: the
-- function runs as the calling user, so row-level security still applies and a
-- workspace cannot read another's message counts through it.

create or replace function public.contact_message_activity(p_workspace_id uuid)
returns table (
  contact_id uuid,
  message_count bigint,
  last_message_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.contact_id,
    count(*) as message_count,
    max(coalesce(m.sent_at, m.received_at, m.created_at)) as last_message_at
  from public.messages as m
  where m.workspace_id = p_workspace_id
    and m.contact_id is not null
  group by m.contact_id;
$$;

comment on function public.contact_message_activity(uuid) is
  'Per-contact message count and latest activity for the CRM list. Aggregates in the database so the list does not fetch every message row.';

grant execute on function public.contact_message_activity(uuid) to authenticated, service_role;

-- Supports both the aggregate above and the existing per-contact lookups.
create index if not exists messages_workspace_contact_activity_idx
  on public.messages (workspace_id, contact_id)
  where contact_id is not null;
