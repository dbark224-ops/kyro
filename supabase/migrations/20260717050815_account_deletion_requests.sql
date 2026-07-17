create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  normalized_email text not null,
  business_name text,
  workspace_name text,
  reason text,
  source text not null default 'website',
  status text not null default 'requested',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists account_deletion_requests_status_created_idx
  on public.account_deletion_requests (status, created_at desc);

create index if not exists account_deletion_requests_normalized_email_idx
  on public.account_deletion_requests (normalized_email, created_at desc);

alter table public.account_deletion_requests enable row level security;

revoke all on table public.account_deletion_requests from anon, authenticated;
grant all on table public.account_deletion_requests to service_role;

comment on table public.account_deletion_requests is
  'Private intake queue for manually verified account and workspace deletion requests.';
