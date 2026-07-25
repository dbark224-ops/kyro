create table if not exists public.workspace_tutorial_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  dashboard_tour_completed_at timestamptz,
  dashboard_tour_completed_by uuid references public.users(id) on delete set null,
  dashboard_tour_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_workspace_tutorial_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspace_tutorial_state_updated_at
  on public.workspace_tutorial_state;

create trigger set_workspace_tutorial_state_updated_at
before update on public.workspace_tutorial_state
for each row
execute function public.set_workspace_tutorial_state_updated_at();

alter table public.workspace_tutorial_state enable row level security;

grant select, insert, update on public.workspace_tutorial_state to authenticated;

drop policy if exists "workspace members can read tutorial state"
  on public.workspace_tutorial_state;

create policy "workspace members can read tutorial state"
on public.workspace_tutorial_state
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members as wm
    where wm.workspace_id = workspace_tutorial_state.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "workspace members can create tutorial state"
  on public.workspace_tutorial_state;

create policy "workspace members can create tutorial state"
on public.workspace_tutorial_state
for insert
to authenticated
with check (
  exists (
    select 1
    from public.workspace_members as wm
    where wm.workspace_id = workspace_tutorial_state.workspace_id
      and wm.user_id = auth.uid()
  )
);

drop policy if exists "workspace members can update tutorial state"
  on public.workspace_tutorial_state;

create policy "workspace members can update tutorial state"
on public.workspace_tutorial_state
for update
to authenticated
using (
  exists (
    select 1
    from public.workspace_members as wm
    where wm.workspace_id = workspace_tutorial_state.workspace_id
      and wm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspace_members as wm
    where wm.workspace_id = workspace_tutorial_state.workspace_id
      and wm.user_id = auth.uid()
  )
);
