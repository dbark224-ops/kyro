create table public.background_job_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_type text not null,
  subject_id text not null default '',
  interval_seconds integer not null check (interval_seconds between 60 and 2678400),
  priority smallint not null default 50 check (priority between 0 and 100),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  next_run_at timestamptz not null,
  last_enqueued_at timestamptz,
  enabled boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint background_job_schedules_type_check check (
    job_type in (
      'inbound_email_sync',
      'calendar_sync',
      'calendar_notifications',
      'crm_lifecycle_review',
      'billing_access',
      'billing_cycle',
      'recording_cleanup',
      'assistant_suggestions'
    )
  )
);

create unique index background_job_schedules_identity_idx
  on public.background_job_schedules (workspace_id, job_type, subject_id);
create index background_job_schedules_due_idx
  on public.background_job_schedules (next_run_at, priority desc)
  where enabled = true;

create trigger set_background_job_schedules_updated_at
  before update on public.background_job_schedules
  for each row execute function public.set_updated_at();

alter table public.background_job_schedules enable row level security;
revoke all on table public.background_job_schedules from public, anon, authenticated;
grant select, insert, update, delete on table public.background_job_schedules to service_role;

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.background_job_schedules(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_type text not null,
  subject_id text not null default '',
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  priority smallint not null default 50 check (priority between 0 and 100),
  status text not null default 'pending',
  due_at timestamptz not null default now(),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint background_jobs_status_check check (
    status in ('pending', 'processing', 'retry', 'completed', 'failed', 'cancelled')
  ),
  constraint background_jobs_type_check check (
    job_type in (
      'outbound_delivery',
      'inbound_email_sync',
      'calendar_sync',
      'calendar_notifications',
      'crm_lifecycle_review',
      'billing_access',
      'billing_cycle',
      'recording_cleanup',
      'assistant_suggestions'
    )
  )
);

create unique index background_jobs_dedupe_idx
  on public.background_jobs (dedupe_key);
create unique index background_jobs_active_schedule_idx
  on public.background_jobs (schedule_id)
  where schedule_id is not null and status in ('pending', 'processing', 'retry');
create unique index background_jobs_active_subject_idx
  on public.background_jobs (job_type, workspace_id, subject_id)
  where schedule_id is null and status in ('pending', 'processing', 'retry');
create index background_jobs_ready_idx
  on public.background_jobs (due_at, priority desc, created_at)
  where status in ('pending', 'retry');
create index background_jobs_expired_lease_idx
  on public.background_jobs (lease_expires_at)
  where status = 'processing';
create index background_jobs_workspace_history_idx
  on public.background_jobs (workspace_id, job_type, created_at desc);

create trigger set_background_jobs_updated_at
  before update on public.background_jobs
  for each row execute function public.set_updated_at();

alter table public.background_jobs enable row level security;
revoke all on table public.background_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.background_jobs to service_role;

create or replace function private.upsert_default_background_schedules(
  check_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  stagger_seconds integer := abs(mod(hashtextextended(check_workspace_id::text, 0), 240));
begin
  insert into public.background_job_schedules (
    workspace_id,
    job_type,
    interval_seconds,
    priority,
    max_attempts,
    next_run_at
  )
  values
    (check_workspace_id, 'inbound_email_sync', 300, 65, 4, now() + make_interval(secs => stagger_seconds)),
    (check_workspace_id, 'calendar_sync', 900, 55, 4, now() + make_interval(secs => stagger_seconds)),
    (check_workspace_id, 'calendar_notifications', 300, 75, 4, now() + make_interval(secs => stagger_seconds)),
    (check_workspace_id, 'crm_lifecycle_review', 21600, 35, 3, now() + make_interval(secs => stagger_seconds)),
    (check_workspace_id, 'billing_access', 3600, 90, 5, now() + make_interval(secs => stagger_seconds)),
    (check_workspace_id, 'billing_cycle', 86400, 85, 5, date_trunc('day', now()) + interval '1 day 4 hours 33 minutes'),
    (check_workspace_id, 'recording_cleanup', 86400, 25, 5, date_trunc('day', now()) + interval '1 day 3 hours 17 minutes')
  on conflict (workspace_id, job_type, subject_id) do nothing;
end;
$$;

revoke all on function private.upsert_default_background_schedules(uuid) from public, anon, authenticated;

create or replace function private.register_workspace_background_schedules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.upsert_default_background_schedules(new.id);
  return new;
end;
$$;

revoke all on function private.register_workspace_background_schedules() from public, anon, authenticated;

create trigger register_workspace_background_schedules
  after insert on public.workspaces
  for each row execute function private.register_workspace_background_schedules();

create or replace function private.register_member_background_schedule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.background_job_schedules (
    workspace_id,
    job_type,
    subject_id,
    interval_seconds,
    priority,
    max_attempts,
    next_run_at,
    payload
  )
  values (
    new.workspace_id,
    'assistant_suggestions',
    new.user_id::text,
    604800,
    20,
    3,
    now() + make_interval(secs => abs(mod(hashtextextended(new.user_id::text, 0), 86400))),
    jsonb_build_object('userId', new.user_id)
  )
  on conflict (workspace_id, job_type, subject_id) do update
  set enabled = true,
      payload = excluded.payload;

  return new;
end;
$$;

revoke all on function private.register_member_background_schedule() from public, anon, authenticated;

create trigger register_member_background_schedule
  after insert or update of workspace_id, user_id on public.workspace_members
  for each row execute function private.register_member_background_schedule();

create or replace function private.remove_member_background_schedule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  delete from public.background_job_schedules
  where workspace_id = old.workspace_id
    and job_type = 'assistant_suggestions'
    and subject_id = old.user_id::text;

  return old;
end;
$$;

revoke all on function private.remove_member_background_schedule() from public, anon, authenticated;

create trigger remove_member_background_schedule
  after delete on public.workspace_members
  for each row execute function private.remove_member_background_schedule();

create or replace function private.register_outbound_background_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_due_at timestamptz := coalesce(new.next_attempt_at, now());
begin
  if new.status not in ('queued', 'retry_scheduled') then
    return new;
  end if;

  update public.background_jobs
  set due_at = target_due_at,
      payload = jsonb_build_object('outboundQueueId', new.id),
      priority = 100,
      last_error = null
  where job_type = 'outbound_delivery'
    and workspace_id = new.workspace_id
    and subject_id = new.id::text
    and status in ('pending', 'retry');

  if found then
    return new;
  end if;

  if exists (
    select 1
    from public.background_jobs
    where job_type = 'outbound_delivery'
      and workspace_id = new.workspace_id
      and subject_id = new.id::text
      and status = 'processing'
  ) then
    return new;
  end if;

  begin
    insert into public.background_jobs (
      workspace_id,
      job_type,
      subject_id,
      dedupe_key,
      payload,
      priority,
      due_at,
      max_attempts
    ) values (
      new.workspace_id,
      'outbound_delivery',
      new.id::text,
      'outbound:' || new.id::text || ':' || extract(epoch from target_due_at)::bigint::text,
      jsonb_build_object('outboundQueueId', new.id),
      100,
      target_due_at,
      greatest(1, least(coalesce(new.max_attempts, 5), 20))
    );
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;

revoke all on function private.register_outbound_background_job() from public, anon, authenticated;

create trigger register_outbound_background_job
  after insert or update of status, next_attempt_at on public.outbound_messages
  for each row execute function private.register_outbound_background_job();

create or replace function public.enqueue_due_background_jobs(
  p_limit integer default 1000,
  p_job_types text[] default null,
  p_workspace_id uuid default null
)
returns table(enqueued_count integer, advanced_count integer)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  schedule_row public.background_job_schedules%rowtype;
  inserted_count integer := 0;
  handled_count integer := 0;
  advance_intervals integer;
  inserted_this_schedule boolean;
begin
  delete from public.background_jobs job
  where job.id in (
    select expired.id
    from public.background_jobs expired
    where (
      expired.status in ('completed', 'cancelled')
      and expired.updated_at < now() - interval '30 days'
    ) or (
      expired.status = 'failed'
      and expired.updated_at < now() - interval '90 days'
    )
    order by expired.updated_at asc
    limit 1000
  );

  for schedule_row in
    select schedule.*
    from public.background_job_schedules schedule
    where schedule.enabled = true
      and schedule.next_run_at <= now()
      and (p_job_types is null or schedule.job_type = any(p_job_types))
      and (p_workspace_id is null or schedule.workspace_id = p_workspace_id)
    order by schedule.next_run_at asc, schedule.priority desc, schedule.id
    limit greatest(1, least(coalesce(p_limit, 1000), 5000))
    for update skip locked
  loop
    handled_count := handled_count + 1;
    inserted_this_schedule := false;

    if not exists (
      select 1
      from public.background_jobs job
      where job.schedule_id = schedule_row.id
        and job.status in ('pending', 'processing', 'retry')
    ) then
      insert into public.background_jobs (
        schedule_id,
        workspace_id,
        job_type,
        subject_id,
        dedupe_key,
        payload,
        priority,
        due_at,
        max_attempts
      ) values (
        schedule_row.id,
        schedule_row.workspace_id,
        schedule_row.job_type,
        schedule_row.subject_id,
        'schedule:' || schedule_row.id::text || ':' || extract(epoch from schedule_row.next_run_at)::bigint::text,
        schedule_row.payload,
        schedule_row.priority,
        schedule_row.next_run_at,
        schedule_row.max_attempts
      );
      inserted_count := inserted_count + 1;
      inserted_this_schedule := true;
    end if;

    advance_intervals := greatest(
      1,
      floor(extract(epoch from (now() - schedule_row.next_run_at)) / schedule_row.interval_seconds)::integer + 1
    );

    update public.background_job_schedules
    set next_run_at = schedule_row.next_run_at + make_interval(secs => schedule_row.interval_seconds * advance_intervals),
        last_enqueued_at = case when inserted_this_schedule then now() else last_enqueued_at end
    where id = schedule_row.id;
  end loop;

  return query select inserted_count, handled_count;
end;
$$;

revoke all on function public.enqueue_due_background_jobs(integer, text[], uuid) from public, anon, authenticated;
grant execute on function public.enqueue_due_background_jobs(integer, text[], uuid) to service_role;

create or replace function public.claim_background_jobs(
  p_limit integer default 40,
  p_lease_seconds integer default 240,
  p_worker_id text default 'worker',
  p_job_types text[] default null,
  p_workspace_id uuid default null
)
returns setof public.background_jobs
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  return query
  with eligible as materialized (
    select
      job.id,
      job.created_at,
      job.due_at,
      (
        job.priority
        + least(100, floor(greatest(0, extract(epoch from (now() - job.due_at))) / 600))
      ) as effective_priority,
      row_number() over (
        partition by job.workspace_id, job.job_type
        order by
          (
            job.priority
            + least(100, floor(greatest(0, extract(epoch from (now() - job.due_at))) / 600))
          ) desc,
          job.due_at asc,
          job.created_at asc
      ) as lane_rank
    from public.background_jobs job
    where (
      (job.status in ('pending', 'retry') and job.due_at <= now())
      or (job.status = 'processing' and job.lease_expires_at < now())
    )
      and (p_job_types is null or job.job_type = any(p_job_types))
      and (p_workspace_id is null or job.workspace_id = p_workspace_id)
  ),
  candidates as (
    select job.id
    from public.background_jobs job
    join eligible on eligible.id = job.id
    order by
      eligible.lane_rank asc,
      eligible.effective_priority desc,
      eligible.due_at asc,
      eligible.created_at asc
    limit greatest(1, least(coalesce(p_limit, 40), 200))
    for update of job skip locked
  )
  update public.background_jobs job
  set status = 'processing',
      lease_token = gen_random_uuid(),
      lease_owner = left(coalesce(nullif(btrim(p_worker_id), ''), 'worker'), 160),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 240), 1800))),
      attempt_count = job.attempt_count + 1,
      last_started_at = now(),
      last_error = null
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

revoke all on function public.claim_background_jobs(integer, integer, text, text[], uuid) from public, anon, authenticated;
grant execute on function public.claim_background_jobs(integer, integer, text, text[], uuid) to service_role;

create or replace function public.renew_background_job_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 240
)
returns boolean
language sql
set search_path = pg_catalog, public
as $$
  update public.background_jobs
  set lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 240), 1800)))
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
  returning true;
$$;

revoke all on function public.renew_background_job_lease(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.renew_background_job_lease(uuid, uuid, integer) to service_role;

create or replace function public.complete_background_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language sql
set search_path = pg_catalog, public
as $$
  update public.background_jobs
  set status = 'completed',
      result = coalesce(p_result, '{}'::jsonb),
      completed_at = now(),
      failed_at = null,
      last_error = null,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
  returning true;
$$;

revoke all on function public.complete_background_job(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_background_job(uuid, uuid, jsonb) to service_role;

create or replace function public.fail_background_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retry_at timestamptz default null,
  p_permanent boolean default false
)
returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  job_row public.background_jobs%rowtype;
  next_status text;
  next_due_at timestamptz;
begin
  select * into job_row
  from public.background_jobs
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token
  for update;

  if not found then
    return null;
  end if;

  if p_permanent or job_row.attempt_count >= job_row.max_attempts then
    next_status := 'failed';
    next_due_at := job_row.due_at;
  else
    next_status := 'retry';
    next_due_at := coalesce(
      p_retry_at,
      now() + make_interval(secs => least(21600, 30 * power(2, greatest(0, job_row.attempt_count - 1))::integer))
    );
  end if;

  update public.background_jobs
  set status = next_status,
      due_at = next_due_at,
      last_error = left(coalesce(p_error, 'Background job failed.'), 4000),
      failed_at = case when next_status = 'failed' then now() else null end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null
  where id = job_row.id;

  return next_status;
end;
$$;

revoke all on function public.fail_background_job(uuid, uuid, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.fail_background_job(uuid, uuid, text, timestamptz, boolean) to service_role;

create or replace function public.retry_background_job(p_job_id uuid)
returns boolean
language sql
set search_path = pg_catalog, public
as $$
  update public.background_jobs
  set status = 'pending',
      due_at = now(),
      attempt_count = 0,
      last_error = null,
      failed_at = null,
      completed_at = null,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null
  where id = p_job_id
    and status in ('failed', 'cancelled')
  returning true;
$$;

revoke all on function public.retry_background_job(uuid) from public, anon, authenticated;
grant execute on function public.retry_background_job(uuid) to service_role;

create or replace function public.background_job_queue_metrics()
returns table(
  job_type text,
  ready_count bigint,
  processing_count bigint,
  failed_count bigint,
  expired_lease_count bigint,
  oldest_ready_at timestamptz,
  oldest_ready_age_seconds bigint
)
language sql
set search_path = pg_catalog, public
as $$
  select
    job.job_type,
    count(*) filter (where job.status in ('pending', 'retry') and job.due_at <= now()) as ready_count,
    count(*) filter (where job.status = 'processing') as processing_count,
    count(*) filter (where job.status = 'failed') as failed_count,
    count(*) filter (where job.status = 'processing' and job.lease_expires_at < now()) as expired_lease_count,
    min(job.due_at) filter (where job.status in ('pending', 'retry') and job.due_at <= now()) as oldest_ready_at,
    coalesce(
      extract(epoch from (now() - min(job.due_at) filter (where job.status in ('pending', 'retry') and job.due_at <= now())))::bigint,
      0
    ) as oldest_ready_age_seconds
  from public.background_jobs job
  group by job.job_type
  order by job.job_type;
$$;

revoke all on function public.background_job_queue_metrics() from public, anon, authenticated;
grant execute on function public.background_job_queue_metrics() to service_role;

select private.upsert_default_background_schedules(workspace.id)
from public.workspaces workspace;

insert into public.background_job_schedules (
  workspace_id,
  job_type,
  subject_id,
  interval_seconds,
  priority,
  max_attempts,
  next_run_at,
  payload
)
select
  member.workspace_id,
  'assistant_suggestions',
  member.user_id::text,
  604800,
  20,
  3,
  now() + make_interval(secs => abs(mod(hashtextextended(member.user_id::text, 0), 86400))),
  jsonb_build_object('userId', member.user_id)
from public.workspace_members member
on conflict (workspace_id, job_type, subject_id) do nothing;

insert into public.background_jobs (
  workspace_id,
  job_type,
  subject_id,
  dedupe_key,
  payload,
  priority,
  due_at,
  max_attempts
)
select
  outbound.workspace_id,
  'outbound_delivery',
  outbound.id::text,
  'outbound:' || outbound.id::text || ':' || extract(epoch from coalesce(outbound.next_attempt_at, now()))::bigint::text,
  jsonb_build_object('outboundQueueId', outbound.id),
  100,
  coalesce(outbound.next_attempt_at, now()),
  greatest(1, least(coalesce(outbound.max_attempts, 5), 20))
from public.outbound_messages outbound
where outbound.status in ('queued', 'retry_scheduled')
on conflict do nothing;
