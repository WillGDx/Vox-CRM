-- Shared CRM organization, roles and row-level authorization.
-- The administrator e-mail is reserved separately by the authorized operator.
-- Legacy crm_workspaces snapshots are deliberately retained without alteration.
begin;

create or replace function public.crm_default_permissions(p_role text)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_object_agg(module, jsonb_build_object(
    'read', case when p_role in ('admin', 'manager') then 'all' else 'own' end,
    'create', true,
    'update', case when p_role in ('admin', 'manager') then 'all' else 'own' end,
    'delete', case when p_role in ('admin', 'manager') then 'all' else 'none' end,
    'export', p_role in ('admin', 'manager')
  )) from unnest(array['companies', 'contacts', 'deals', 'tasks']) as module;
$$;

create or replace function public.crm_valid_permissions(p_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare module text; action text; item jsonb;
begin
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_value)) <> 4 then return false; end if;
  foreach module in array array['companies', 'contacts', 'deals', 'tasks'] loop
    item := p_value -> module;
    if jsonb_typeof(item) is distinct from 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(item)) <> 5 then return false; end if;
    foreach action in array array['read', 'update', 'delete'] loop
      if jsonb_typeof(item -> action) is distinct from 'string'
         or (item ->> action) not in ('none', 'own', 'all') then return false; end if;
    end loop;
    if jsonb_typeof(item -> 'create') is distinct from 'boolean'
       or jsonb_typeof(item -> 'export') is distinct from 'boolean' then return false; end if;
    if item ->> 'read' = 'none' and ((item ->> 'create')::boolean or (item ->> 'export')::boolean
       or item ->> 'update' <> 'none' or item ->> 'delete' <> 'none') then return false; end if;
    if item ->> 'read' = 'own' and (item ->> 'update' = 'all' or item ->> 'delete' = 'all') then return false; end if;
  end loop;
  return true;
end;
$$;

create table if not exists public.crm_teams (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 120),
  seeded boolean not null default false,
  created_at timestamptz not null default now()
);
insert into public.crm_teams(id, name)
values ('534341de-9a86-4d96-b7f8-57fd96be6e3a', 'Vox Workspace')
on conflict (id) do nothing;

create table if not exists public.crm_admin_bootstrap (
  workspace_id uuid primary key references public.crm_teams(id) on delete cascade,
  email text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz
);
create table if not exists public.crm_members (
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'user')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  unique (user_id)
);
create table if not exists public.crm_permission_profiles (
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'user')),
  permissions jsonb not null check (public.crm_valid_permissions(permissions)),
  primary key (workspace_id, role)
);
insert into public.crm_permission_profiles(workspace_id, role, permissions)
select t.id, r.role, public.crm_default_permissions(r.role)
from public.crm_teams t cross join unnest(array['admin', 'manager', 'user']) as r(role)
on conflict (workspace_id, role) do nothing;

create table if not exists public.crm_records (
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  collection text not null check (collection in ('companies', 'contacts', 'deals', 'tasks')),
  id text not null check (length(id) between 1 and 500),
  owner_id uuid references auth.users(id) on delete set null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, collection, id)
);
create index if not exists crm_records_owner_idx on public.crm_records(workspace_id, owner_id);
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  collection text not null check (collection in ('companies', 'contacts', 'deals', 'tasks')),
  record_owner_id uuid references auth.users(id) on delete set null,
  text text not null,
  type text not null,
  created_at timestamptz not null default now()
);
create index if not exists crm_activities_workspace_time_idx
  on public.crm_activities(workspace_id, created_at desc, id);

create or replace function public.crm_role(p_workspace uuid)
returns text language sql stable security definer set search_path = pg_catalog as $$
  select m.role from public.crm_members m
  where m.workspace_id = p_workspace and m.user_id = auth.uid() and m.active;
$$;
create or replace function public.crm_permissions(p_workspace uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select case when public.crm_role(p_workspace) = 'admin' then public.crm_default_permissions('admin')
    else coalesce((select p.permissions from public.crm_permission_profiles p
      where p.workspace_id = p_workspace and p.role = public.crm_role(p_workspace)), '{}'::jsonb) end;
$$;
create or replace function public.crm_can(p_workspace uuid, p_collection text, p_action text, p_owner uuid default null)
returns boolean language plpgsql stable security definer set search_path = pg_catalog as $$
declare rights jsonb; scope text;
begin
  if public.crm_role(p_workspace) is null
     or p_collection not in ('companies', 'contacts', 'deals', 'tasks') then return false; end if;
  if public.crm_role(p_workspace) = 'admin' then return true; end if;
  rights := public.crm_permissions(p_workspace) -> p_collection;
  if p_action in ('create', 'export') then return coalesce((rights ->> p_action)::boolean, false); end if;
  if p_action not in ('read', 'update', 'delete') then return false; end if;
  scope := rights ->> p_action;
  return scope = 'all' or (scope = 'own' and p_owner = auth.uid());
end;
$$;
create or replace function public.crm_assignable_owner(p_workspace uuid, p_collection text, p_owner uuid)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select (p_owner = auth.uid() or
      (public.crm_role(p_workspace) = 'admin' or public.crm_permissions(p_workspace) -> p_collection ->> 'update' = 'all'))
    and (p_owner is null or exists(select 1 from public.crm_members m
      where m.workspace_id = p_workspace and m.user_id = p_owner and m.active));
$$;

alter table public.crm_teams enable row level security;
alter table public.crm_teams force row level security;
alter table public.crm_admin_bootstrap enable row level security;
alter table public.crm_admin_bootstrap force row level security;
alter table public.crm_members enable row level security;
alter table public.crm_members force row level security;
alter table public.crm_permission_profiles enable row level security;
alter table public.crm_permission_profiles force row level security;
alter table public.crm_records enable row level security;
alter table public.crm_records force row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_activities force row level security;

revoke all on public.crm_teams, public.crm_admin_bootstrap, public.crm_members,
  public.crm_permission_profiles, public.crm_records, public.crm_activities from public, anon, authenticated;
grant select on public.crm_teams, public.crm_members, public.crm_permission_profiles,
  public.crm_records, public.crm_activities to authenticated;
grant insert (workspace_id, collection, id, owner_id, payload) on public.crm_records to authenticated;
grant update (payload, owner_id) on public.crm_records to authenticated;
grant delete on public.crm_records to authenticated;

drop policy if exists crm_teams_member_read on public.crm_teams;
create policy crm_teams_member_read on public.crm_teams for select to authenticated
using (public.crm_role(id) is not null);
drop policy if exists crm_members_team_read on public.crm_members;
create policy crm_members_team_read on public.crm_members for select to authenticated
using (public.crm_role(workspace_id) is not null);
drop policy if exists crm_profiles_team_read on public.crm_permission_profiles;
create policy crm_profiles_team_read on public.crm_permission_profiles for select to authenticated
using (public.crm_role(workspace_id) is not null);
drop policy if exists crm_records_read on public.crm_records;
create policy crm_records_read on public.crm_records for select to authenticated
using (public.crm_can(workspace_id, collection, 'read', owner_id));
drop policy if exists crm_records_create on public.crm_records;
create policy crm_records_create on public.crm_records for insert to authenticated
with check (public.crm_can(workspace_id, collection, 'create', owner_id)
  and public.crm_assignable_owner(workspace_id, collection, owner_id));
drop policy if exists crm_records_update on public.crm_records;
create policy crm_records_update on public.crm_records for update to authenticated
using (public.crm_can(workspace_id, collection, 'update', owner_id))
with check (public.crm_can(workspace_id, collection, 'update', owner_id)
  and public.crm_assignable_owner(workspace_id, collection, owner_id));
drop policy if exists crm_records_delete on public.crm_records;
create policy crm_records_delete on public.crm_records for delete to authenticated
using (public.crm_can(workspace_id, collection, 'delete', owner_id));
drop policy if exists crm_activities_read on public.crm_activities;
create policy crm_activities_read on public.crm_activities for select to authenticated
using (public.crm_can(workspace_id, collection, 'read', record_owner_id));

create or replace function public.crm_validate_record()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare defaults jsonb; field text; label text; target_collection text; target_id text; target_date date;
begin
  defaults := case new.collection
    when 'companies' then '{"name":"","sector":"","website":"","phone":"","owner":""}'::jsonb
    when 'contacts' then '{"name":"","email":"","phone":"","role":"","companyId":"","owner":""}'::jsonb
    when 'deals' then '{"title":"","value":0,"stage":"new","companyId":"","contactId":"","owner":"","dueDate":"","description":""}'::jsonb
    when 'tasks' then '{"title":"","dueDate":"","priority":"medium","status":"pending","owner":"","dealId":""}'::jsonb
    else null end;
  if defaults is null or jsonb_typeof(new.payload) is distinct from 'object'
     or jsonb_typeof(new.payload -> 'id') is distinct from 'string'
     or new.payload ->> 'id' <> new.id then raise exception 'Registro CRM inválido.' using errcode = '23514'; end if;
  new.payload := defaults || (new.payload - 'ownerId');
  for field in select jsonb_object_keys(defaults) loop
    if jsonb_typeof(new.payload -> field) is distinct from jsonb_typeof(defaults -> field) then
      raise exception 'Tipo inválido no campo do registro CRM.' using errcode = '23514';
    end if;
    if jsonb_typeof(defaults -> field) = 'string' and length(new.payload ->> field) > (case when field = 'description' then 5000 else 500 end) then
      raise exception 'Campo do registro CRM muito longo.' using errcode = '23514';
    end if;
  end loop;
  label := case when new.collection in ('companies', 'contacts') then new.payload ->> 'name' else new.payload ->> 'title' end;
  if length(btrim(label)) = 0 then raise exception 'Informe o nome ou título do registro.' using errcode = '23514'; end if;
  if new.collection = 'deals' and ((new.payload ->> 'value')::numeric < 0
     or (new.payload ->> 'value')::numeric > 1000000000000
     or new.payload ->> 'stage' not in ('new','qualified','proposal','negotiation','won','lost')) then
    raise exception 'Valor ou etapa do negócio inválidos.' using errcode = '23514';
  end if;
  if new.collection = 'tasks' and (new.payload ->> 'priority' not in ('high','medium','low')
     or new.payload ->> 'status' not in ('pending','done')) then
    raise exception 'Situação ou prioridade inválidas.' using errcode = '23514';
  end if;
  if new.payload ? 'dueDate' and new.payload ->> 'dueDate' <> '' then
    if new.payload ->> 'dueDate' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Data inválida.' using errcode = '23514';
    end if;
    begin target_date := (new.payload ->> 'dueDate')::date;
    exception when others then raise exception 'Data inválida.' using errcode = '23514'; end;
    if to_char(target_date, 'YYYY-MM-DD') <> new.payload ->> 'dueDate' then
      raise exception 'Data inválida.' using errcode = '23514';
    end if;
  end if;
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and not exists(select 1 from public.crm_members m where m.workspace_id = new.workspace_id and m.user_id = new.owner_id and m.active) then
    raise exception 'O responsável precisa ser um membro ativo.' using errcode = '23514';
  end if;
  foreach field in array array['companyId', 'contactId', 'dealId'] loop
    target_id := new.payload ->> field;
    target_collection := case field when 'companyId' then 'companies' when 'contactId' then 'contacts' else 'deals' end;
    if target_id is not null and target_id <> '' and not exists(select 1 from public.crm_records r
      where r.workspace_id = new.workspace_id and r.collection = target_collection and r.id = target_id) then
      raise exception 'O vínculo do registro não existe nesta organização.' using errcode = '23514';
    end if;
  end loop;
  if new.owner_id is null then label := 'Sem responsável';
  else select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), 'Usuário')
    into label from auth.users u where u.id = new.owner_id;
  end if;
  new.payload := jsonb_set(new.payload, '{owner}', to_jsonb(coalesce(label, 'Usuário')));
  new.updated_at := statement_timestamp();
  if tg_op = 'UPDATE' then new.version := old.version + 1; new.created_at := old.created_at; end if;
  return new;
end;
$$;
drop trigger if exists crm_records_validate on public.crm_records;
create trigger crm_records_validate before insert or update on public.crm_records
for each row execute function public.crm_validate_record();

create or replace function public.crm_record_history()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare record public.crm_records%rowtype; actor text; title text; action text; kind text; field text; stage text;
begin
  if tg_op = 'DELETE' then record := old; else record := new; end if;
  if tg_op = 'DELETE' then
    field := case old.collection when 'companies' then 'companyId' when 'contacts' then 'contactId' when 'deals' then 'dealId' else null end;
    if field is not null then update public.crm_records r
      set payload = jsonb_set(r.payload, array[field], '""'::jsonb)
      where r.workspace_id = old.workspace_id and r.payload ->> field = old.id;
    end if;
  end if;
  if current_setting('vox_crm.seeding', true) = 'on' then return null; end if;
  select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), 'Usuário')
    into actor from auth.users u where u.id = auth.uid();
  actor := coalesce(actor, 'Sistema');
  title := coalesce(record.payload ->> 'name', record.payload ->> 'title', 'Registro');
  action := case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'atualizou' else 'excluiu' end;
  kind := case record.collection when 'companies' then 'company' when 'contacts' then 'contact' when 'deals' then 'deal' else 'task' end;
  if tg_op = 'UPDATE' and record.collection = 'deals' and old.payload ->> 'stage' is distinct from new.payload ->> 'stage' then
    stage := case new.payload ->> 'stage' when 'new' then 'Novo lead' when 'qualified' then 'Qualificação'
      when 'proposal' then 'Proposta' when 'negotiation' then 'Negociação' when 'won' then 'Ganho' else 'Perdido' end;
    action := 'moveu'; kind := case when new.payload ->> 'stage' = 'won' then 'won' else 'stage' end;
    title := title || ' para ' || stage;
  end if;
  if tg_op = 'UPDATE' and record.collection = 'tasks' and old.payload ->> 'status' is distinct from new.payload ->> 'status' then
    action := case when new.payload ->> 'status' = 'done' then 'concluiu a tarefa' else 'reabriu a tarefa' end;
  end if;
  insert into public.crm_activities(workspace_id, collection, record_owner_id, text, type)
    values(record.workspace_id, record.collection, record.owner_id, actor || ' ' || action || ' “' || title || '”.', kind);
  delete from public.crm_activities a where a.workspace_id = record.workspace_id and a.id not in
    (select x.id from public.crm_activities x where x.workspace_id = record.workspace_id order by x.created_at desc, x.id desc limit 100);
  return null;
end;
$$;
drop trigger if exists crm_records_history on public.crm_records;
create trigger crm_records_history after insert or update or delete on public.crm_records
for each row execute function public.crm_record_history();

create or replace function public.crm_preserve_administrator()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if old.role = 'admin' and old.active and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    perform 1 from public.crm_teams t where t.id = old.workspace_id for update;
    if not exists(select 1 from public.crm_members m where m.workspace_id = old.workspace_id
      and m.user_id <> old.user_id and m.role = 'admin' and m.active) then
      raise exception 'Mantenha pelo menos um administrador ativo.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists crm_members_preserve_admin on public.crm_members;
create trigger crm_members_preserve_admin before update or delete on public.crm_members
for each row execute function public.crm_preserve_administrator();

create or replace function public.crm_access(p_seed jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := auth.uid(); team uuid; caller_role text; verified_email text;
  reservation public.crm_admin_bootstrap%rowtype; source jsonb; collection text; item jsonb; profiles jsonb; members jsonb;
begin
  if actor is null then raise exception 'Entre na sua conta para acessar o CRM.' using errcode = '42501'; end if;
  select m.workspace_id, m.role into team, caller_role from public.crm_members m where m.user_id = actor and m.active;
  if team is null then
    select lower(btrim(u.email)) into verified_email from auth.users u
      where u.id = actor and u.email_confirmed_at is not null;
    select b.* into reservation from public.crm_admin_bootstrap b
      where b.email = verified_email and b.claimed_at is null for update;
    if found then
      team := reservation.workspace_id;
      insert into public.crm_members(workspace_id, user_id, role, active) values(team, actor, 'admin', true)
      on conflict (workspace_id, user_id) do update set role = 'admin', active = true;
      update public.crm_admin_bootstrap set claimed_by = actor, claimed_at = statement_timestamp() where workspace_id = team;
      caller_role := 'admin';
    end if;
  end if;
  if team is null then return jsonb_build_object('storage','supabase','userId',actor,'workspaceId',null,
    'workspaceName','Vox Workspace','role',null,'permissions','{}'::jsonb,'members','[]'::jsonb,'profiles','{}'::jsonb); end if;
  perform 1 from public.crm_teams t where t.id = team for update;
  select m.role into caller_role from public.crm_members m where m.workspace_id=team and m.user_id=actor and m.active;
  if caller_role is null then return jsonb_build_object('storage','supabase','userId',actor,'workspaceId',null,
    'workspaceName','Vox Workspace','role',null,'permissions','{}'::jsonb,'members','[]'::jsonb,'profiles','{}'::jsonb); end if;
  if caller_role = 'admin' and not (select t.seeded from public.crm_teams t where t.id = team) then
    select w.state into source from public.crm_workspaces w where w.user_id = actor;
    source := coalesce(source, p_seed);
    if source is not null then
      perform set_config('vox_crm.seeding','on',true);
      foreach collection in array array['companies','contacts','deals','tasks'] loop
        if jsonb_typeof(source -> collection) is distinct from 'array' then raise exception 'Dados iniciais inválidos.' using errcode = '23514'; end if;
        for item in select value from jsonb_array_elements(source -> collection) loop
          insert into public.crm_records(workspace_id,collection,id,owner_id,payload)
            values(team,collection,item->>'id',actor,item) on conflict on constraint crm_records_pkey do nothing;
        end loop;
      end loop;
      if jsonb_typeof(source -> 'activities') = 'array' then
        for item in select value from jsonb_array_elements(source -> 'activities') loop
          insert into public.crm_activities(workspace_id,collection,record_owner_id,text,type,created_at)
          values(team,'deals',actor,coalesce(item->>'text','Atividade importada'),coalesce(item->>'type','deal'),coalesce((item->>'createdAt')::timestamptz,now()));
        end loop;
      end if;
      perform set_config('vox_crm.seeding','off',true);
      update public.crm_teams set seeded = true where id = team;
    end if;
  end if;
  select jsonb_object_agg(p.role,case when p.role='admin' then public.crm_default_permissions('admin') else p.permissions end)
    into profiles from public.crm_permission_profiles p where p.workspace_id=team;
  select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'displayName',
    coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),split_part(u.email,'@',1),'Usuário'),
    'role',m.role,'active',m.active) || case when caller_role='admin' then jsonb_build_object('email',u.email) else '{}'::jsonb end
    order by m.created_at,m.user_id),'[]'::jsonb) into members
    from public.crm_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=team and (caller_role='admin' or m.active);
  return jsonb_build_object('storage','supabase','userId',actor,'workspaceId',team,
    'workspaceName',(select t.name from public.crm_teams t where t.id=team),'role',caller_role,
    'permissions',public.crm_permissions(team),'members',members,'profiles',coalesce(profiles,'{}'::jsonb));
end;
$$;

create or replace function public.crm_set_member(p_email text, p_role text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare team uuid; target uuid;
begin
  select m.workspace_id into team from public.crm_members m where m.user_id=auth.uid() and m.active and m.role='admin';
  if team is null then raise exception 'Apenas administradores gerenciam usuários.' using errcode='42501'; end if;
  if p_role not in ('admin','manager','user') or p_role is null or p_active is null then
    raise exception 'Perfil de usuário inválido.' using errcode='22023'; end if;
  if p_email is null or length(btrim(p_email)) not between 3 and 320 then
    raise exception 'Informe o e-mail do usuário cadastrado.' using errcode='22023'; end if;
  perform 1 from public.crm_teams t where t.id=team for update;
  if public.crm_role(team) is distinct from 'admin' then
    raise exception 'Apenas administradores gerenciam usuários.' using errcode='42501'; end if;
  select u.id into target from auth.users u where lower(u.email)=lower(btrim(p_email));
  if target is null then raise exception 'Usuário não encontrado. Peça que ele crie uma conta no CRM primeiro.' using errcode='P0002'; end if;
  if exists(select 1 from public.crm_members m where m.user_id=target and m.workspace_id<>team) then
    raise exception 'O usuário já pertence a outra organização.' using errcode='23514'; end if;
  insert into public.crm_members(workspace_id,user_id,role,active) values(team,target,p_role,p_active)
    on conflict(workspace_id,user_id) do update set role=excluded.role,active=excluded.active;
  return public.crm_access(null);
end;
$$;

create or replace function public.crm_save_profile(p_role text, p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare team uuid;
begin
  select m.workspace_id into team from public.crm_members m where m.user_id=auth.uid() and m.active and m.role='admin';
  if team is null then raise exception 'Apenas administradores alteram permissões.' using errcode='42501'; end if;
  perform 1 from public.crm_teams t where t.id=team for update;
  if public.crm_role(team) is distinct from 'admin' then
    raise exception 'Apenas administradores alteram permissões.' using errcode='42501'; end if;
  if p_role is null or p_role not in ('manager','user') or not public.crm_valid_permissions(p_permissions) then
    raise exception 'Perfil ou permissões inválidos. O perfil Administrador é fixo.' using errcode='22023'; end if;
  insert into public.crm_permission_profiles(workspace_id,role,permissions) values(team,p_role,p_permissions)
    on conflict(workspace_id,role) do update set permissions=excluded.permissions;
  return public.crm_access(null);
end;
$$;

revoke all on function public.crm_default_permissions(text), public.crm_valid_permissions(jsonb),
  public.crm_role(uuid), public.crm_permissions(uuid), public.crm_can(uuid,text,text,uuid),
  public.crm_assignable_owner(uuid,text,uuid), public.crm_validate_record(), public.crm_record_history(),
  public.crm_preserve_administrator(), public.crm_access(jsonb), public.crm_set_member(text,text,boolean),
  public.crm_save_profile(text,jsonb) from public, anon, authenticated;
grant execute on function public.crm_valid_permissions(jsonb), public.crm_role(uuid), public.crm_permissions(uuid),
  public.crm_can(uuid,text,text,uuid), public.crm_assignable_owner(uuid,text,uuid), public.crm_access(jsonb),
  public.crm_set_member(text,text,boolean), public.crm_save_profile(text,jsonb) to authenticated;

comment on table public.crm_records is 'Shared CRM records. RLS enforces module permissions and responsible-user scopes even through direct REST access.';
comment on table public.crm_admin_bootstrap is 'Operator-reserved, verified administrator identity; never readable or writable by application users.';
commit;
