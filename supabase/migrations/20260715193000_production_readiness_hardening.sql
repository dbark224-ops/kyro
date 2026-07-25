-- Production security fixes and distributed throttling for public endpoints.

create schema if not exists private;

grant usage on schema private to authenticated, service_role;
revoke usage on schema private from anon;

create or replace function private.is_workspace_member(check_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = check_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function private.is_workspace_owner(check_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = check_workspace_id
      and w.owner_user_id = auth.uid()
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function private.is_workspace_owner(uuid) to authenticated, service_role;

create or replace function public.is_workspace_member(check_workspace_id uuid)
returns boolean
language sql
set search_path = pg_catalog, private
stable
as $$
  select private.is_workspace_member(check_workspace_id);
$$;

create or replace function public.is_workspace_owner(check_workspace_id uuid)
returns boolean
language sql
set search_path = pg_catalog, private
stable
as $$
  select private.is_workspace_owner(check_workspace_id);
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_owner(uuid) to authenticated, service_role;

alter function public.set_updated_at()
  set search_path = pg_catalog, public;
alter function public.normalize_contact_email(text)
  set search_path = pg_catalog, public;
alter function public.normalize_contact_phone(text)
  set search_path = pg_catalog, public;
alter function public.normalize_company_name(text)
  set search_path = pg_catalog, public;
alter function public.set_contact_identity_fields()
  set search_path = pg_catalog, public;
alter function public.set_workspace_tutorial_state_updated_at()
  set search_path = pg_catalog, public;

revoke all on function public.set_updated_at() from public, anon;
revoke all on function public.normalize_contact_email(text) from public, anon;
revoke all on function public.normalize_contact_phone(text) from public, anon;
revoke all on function public.normalize_company_name(text) from public, anon;
revoke all on function public.set_contact_identity_fields() from public, anon;
revoke all on function public.set_workspace_tutorial_state_updated_at() from public, anon;
grant execute on function public.set_updated_at() to authenticated, service_role;
grant execute on function public.normalize_contact_email(text) to authenticated, service_role;
grant execute on function public.normalize_contact_phone(text) to authenticated, service_role;
grant execute on function public.normalize_company_name(text) to authenticated, service_role;
grant execute on function public.set_contact_identity_fields() to authenticated, service_role;
grant execute on function public.set_workspace_tutorial_state_updated_at() to authenticated, service_role;

do $$
begin
  if to_regclass('public.waitlist_signups') is not null then
    revoke all on table public.waitlist_signups from anon, authenticated;
    grant select, insert, update, delete on table public.waitlist_signups to service_role;
  end if;

  if to_regclass('public.account_deletion_requests') is not null then
    revoke all on table public.account_deletion_requests from anon, authenticated;
    grant select, insert, update, delete on table public.account_deletion_requests to service_role;
  end if;
end;
$$;

create table if not exists public.api_rate_limit_buckets (
  route text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (route, key_hash, window_started_at)
);

create index if not exists api_rate_limit_buckets_expiry_idx
  on public.api_rate_limit_buckets (expires_at);

alter table public.api_rate_limit_buckets enable row level security;
revoke all on table public.api_rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.api_rate_limit_buckets to service_role;

create or replace function public.consume_api_rate_limit(
  p_route text,
  p_key_hash text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
  current_time timestamptz := clock_timestamp();
  window_start timestamptz;
  window_expiry timestamptz;
begin
  if p_route is null or btrim(p_route) = '' or
     p_key_hash is null or btrim(p_key_hash) = '' or
     p_window_seconds < 1 or p_max_requests < 1 then
    raise exception 'Invalid rate-limit input';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from current_time) / p_window_seconds) * p_window_seconds
  );
  window_expiry := window_start + make_interval(secs => p_window_seconds);

  insert into public.api_rate_limit_buckets (
    route,
    key_hash,
    window_started_at,
    request_count,
    expires_at,
    updated_at
  ) values (
    p_route,
    p_key_hash,
    window_start,
    1,
    window_expiry,
    current_time
  )
  on conflict (route, key_hash, window_started_at)
  do update set
    request_count = public.api_rate_limit_buckets.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into current_count;

  delete from public.api_rate_limit_buckets
  where expires_at < current_time - interval '1 day';

  return query select
    current_count <= p_max_requests,
    greatest(p_max_requests - current_count, 0),
    greatest(ceil(extract(epoch from (window_expiry - current_time)))::integer, 1);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
  to service_role;
