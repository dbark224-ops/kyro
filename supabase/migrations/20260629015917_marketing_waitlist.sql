create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  normalized_email text not null,
  phone text,
  business_name text not null,
  industry text not null,
  location text not null,
  service_area text,
  admin_focus text not null,
  enquiry_volume text,
  notes text,
  source text not null default 'website',
  status text not null default 'new',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists waitlist_signups_normalized_email_idx
  on public.waitlist_signups (normalized_email);

create index if not exists waitlist_signups_status_created_idx
  on public.waitlist_signups (status, created_at desc);

alter table public.waitlist_signups enable row level security;

grant all on table public.waitlist_signups to service_role;
