-- Vox CRM: one private workspace per Supabase Auth account.
-- Reapplying this migration preserves existing workspace records.
begin;

create table if not exists public.crm_workspaces (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint crm_workspaces_version_nonnegative check (version >= 0),
  constraint crm_workspaces_state_shape check (
    jsonb_typeof(state) = 'object'
    and state ?& array['companies', 'contacts', 'deals', 'tasks', 'activities']
    and jsonb_typeof(state -> 'companies') = 'array'
    and jsonb_typeof(state -> 'contacts') = 'array'
    and jsonb_typeof(state -> 'deals') = 'array'
    and jsonb_typeof(state -> 'tasks') = 'array'
    and jsonb_typeof(state -> 'activities') = 'array'
  )
);

alter table public.crm_workspaces enable row level security;
alter table public.crm_workspaces force row level security;

revoke all on table public.crm_workspaces from public, anon, authenticated;
grant select on table public.crm_workspaces to authenticated;
grant insert (user_id, state, version) on table public.crm_workspaces to authenticated;
grant update (state, version) on table public.crm_workspaces to authenticated;

drop policy if exists crm_workspaces_select_own on public.crm_workspaces;
create policy crm_workspaces_select_own
  on public.crm_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists crm_workspaces_insert_own on public.crm_workspaces;
create policy crm_workspaces_insert_own
  on public.crm_workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists crm_workspaces_update_own on public.crm_workspaces;
create policy crm_workspaces_update_own
  on public.crm_workspaces for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.crm_workspaces_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.crm_workspaces_touch_updated_at() from public, anon;
grant execute on function public.crm_workspaces_touch_updated_at() to authenticated;

drop trigger if exists crm_workspaces_updated_at on public.crm_workspaces;
create trigger crm_workspaces_updated_at
  before update on public.crm_workspaces
  for each row execute function public.crm_workspaces_touch_updated_at();

comment on table public.crm_workspaces is
  'Private Vox CRM state, protected by Supabase Auth and row-level security. Updates use an expected version to prevent concurrent changes from overwriting each other.';

commit;
