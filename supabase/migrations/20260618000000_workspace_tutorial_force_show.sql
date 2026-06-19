alter table public.workspace_tutorial_state
  add column if not exists dashboard_tour_force_show boolean not null default false;

comment on column public.workspace_tutorial_state.dashboard_tour_force_show is
  'Developer testing override that keeps the dashboard first-run tutorial visible for a workspace.';
