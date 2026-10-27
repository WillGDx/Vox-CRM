-- Operational modules: tenant-scoped records and server-authoritative actions.
begin;

create table if not exists public.crm_suite_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  kind text not null check(kind in ('leads','automations','quotes','invoices','projects','project_tasks','project_templates','time_entries','calendar_events','booking_pages','employees','attendance','workflows','workflow_requests','channels','service_conversations','service_messages','notes')),
  title text not null check(length(btrim(title)) between 1 and 160),
  data jsonb not null default '{}'::jsonb check(jsonb_typeof(data)='object' and octet_length(data::text)<=32768),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revision integer not null default 1 check(revision>0)
);
create index if not exists crm_suite_workspace_kind on public.crm_suite_items(workspace_id,kind,updated_at desc,id);
create index if not exists crm_suite_owner_kind on public.crm_suite_items(workspace_id,owner_id,kind);

create or replace function public.crm_suite_dto(p_item public.crm_suite_items)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('id',p_item.id,'workspaceId',p_item.workspace_id,'kind',p_item.kind,'title',p_item.title,'data',p_item.data,'ownerId',p_item.owner_id,'createdAt',p_item.created_at,'updatedAt',p_item.updated_at,'revision',p_item.revision);
$$;

create or replace function public.crm_suite_can(p_team uuid,p_kind text,p_action text,p_owner uuid,p_data jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); role text:=public.crm_role(p_team); task_scope text;
begin
 if actor is null or role is null or p_action not in ('read','create','update','delete') then return false; end if;
 if p_kind in ('leads','quotes','invoices') then return public.crm_can(p_team,'deals',p_action,p_owner); end if;
 if p_kind='service_conversations' then
   if p_data->>'assigneeId'=actor::text and p_action in ('read','update') then return public.crm_permissions(p_team)->'deals'->>p_action in ('own','all'); end if;
   return public.crm_can(p_team,'deals',p_action,p_owner);
 end if;
 if p_kind='service_messages' then
   if p_action='read' then return exists(select 1 from public.crm_suite_items s where s.workspace_id=p_team and s.kind='service_conversations' and s.id::text=p_data->>'conversationId' and public.crm_suite_can(p_team,'service_conversations','read',s.owner_id,s.data)); end if;
   return public.crm_can(p_team,'deals',p_action,p_owner);
 end if;
 if p_kind in ('projects','project_tasks','project_templates') then
   if p_action='read' and public.crm_permissions(p_team)->'tasks'->>'read' in ('own','all') and ((p_kind='projects' and (p_data->'members') ? actor::text) or (p_kind='project_tasks' and exists(select 1 from public.crm_suite_items s where s.workspace_id=p_team and s.kind='projects' and s.id::text=p_data->>'projectId' and (s.data->'members') ? actor::text))) then return true; end if;
   if p_kind='project_tasks' and p_data->>'assigneeId'=actor::text and p_action in ('read','update') then
     task_scope:=public.crm_permissions(p_team)->'tasks'->>p_action;
     return task_scope in ('own','all');
   end if;
   return public.crm_can(p_team,'tasks',p_action,p_owner);
 end if;
 if p_kind in ('automations','workflows','channels') then return p_action='read' or role in ('admin','manager'); end if;
 if p_kind='employees' then return p_action='read' or role='admin'; end if;
 if p_kind in ('attendance','time_entries') then return (p_action in ('read','create','update') and (p_owner=actor or role='admin')) or (p_action='delete' and role='admin'); end if;
 if p_kind='calendar_events' then return role='admin' or p_owner=actor or (p_action='read' and (p_data->>'visibility'='team' or (p_data->'attendees') ? actor::text)); end if;
 if p_kind='booking_pages' then return role='admin' or p_owner=actor; end if;
 if p_kind='workflow_requests' then return role='admin' or p_owner=actor or (p_action in ('read','update') and p_data->>'approverId'=actor::text); end if;
 if p_kind='notes' then return p_owner=actor; end if;
 return false;
end;
$$;

alter table public.crm_suite_items enable row level security;
alter table public.crm_suite_items force row level security;
revoke all on public.crm_suite_items from public,anon,authenticated;
grant select on public.crm_suite_items to authenticated;
drop policy if exists crm_suite_read on public.crm_suite_items;
create policy crm_suite_read on public.crm_suite_items for select to authenticated
 using(public.crm_suite_can(workspace_id,kind,'read',owner_id,data));

create or replace function public.crm_suite_list()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare team uuid; result jsonb;
begin
 select workspace_id into team from public.crm_members where user_id=auth.uid() and active;
 if team is null then raise exception 'Seu acesso ao CRM precisa ser liberado.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(public.crm_suite_dto(s) order by s.updated_at desc,s.id),'[]'::jsonb) into result
 from public.crm_suite_items s where s.workspace_id=team and public.crm_suite_can(team,s.kind,'read',s.owner_id,s.data);
 return result;
end;
$$;

create or replace function public.crm_suite_defaults(p_kind text)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select case p_kind
 when 'leads' then '{"name":"","email":"","phone":"","company":"","source":"manual","status":"new","notes":"","value":0,"contactId":"","dealId":"","convertedAt":null}'::jsonb
 when 'automations' then '{"trigger":"deal_stage_changed","stage":"new","action":"create_task","taskTitle":"","delayDays":0,"enabled":true,"emailSubject":"","emailBody":"","targetStage":"","lastRun":null}'::jsonb
 when 'quotes' then '{"customer":"","customerEmail":"","dealId":"","currency":"BRL","dueDate":"","status":"draft","lines":[],"notes":"","total":0}'::jsonb
 when 'invoices' then '{"customer":"","customerEmail":"","dealId":"","currency":"BRL","dueDate":"","status":"draft","lines":[],"notes":"","total":0,"paymentUrl":""}'::jsonb
 when 'projects' then '{"description":"","startDate":"","endDate":"","status":"planning","members":[]}'::jsonb
 when 'project_tasks' then '{"projectId":"","description":"","status":"todo","priority":"medium","assigneeId":"","startDate":"","endDate":"","sprint":"","dependsOn":[]}'::jsonb
 when 'project_templates' then '{"description":"","tasks":[]}'::jsonb
 when 'time_entries' then '{"taskId":"","startedAt":null,"endedAt":null,"durationSeconds":0,"status":"running"}'::jsonb
 when 'calendar_events' then '{"startAt":"","endAt":"","timeZone":"America/Sao_Paulo","visibility":"personal","attendees":[],"description":"","location":""}'::jsonb
 when 'booking_pages' then '{"durationMinutes":30,"weekdays":[1,2,3,4,5],"startHour":9,"endHour":18,"timeZone":"America/Sao_Paulo","enabled":true,"slug":""}'::jsonb
 when 'employees' then '{"userId":"","department":"","jobTitle":"","managerId":"","location":"","startDate":""}'::jsonb
 when 'attendance' then '{"userId":"","startedAt":null,"endedAt":null,"breaks":[],"state":"working","durationSeconds":0}'::jsonb
 when 'workflows' then '{"type":"approval","description":"","approverId":"","fields":[]}'::jsonb
 when 'workflow_requests' then '{"workflowId":"","reason":"","amount":0,"answers":{},"status":"pending","approverId":"","decisionNote":"","decidedAt":null,"decidedBy":null}'::jsonb
 when 'channels' then '{"type":"manual","enabled":true}'::jsonb
 when 'service_conversations' then '{"channel":"manual","customer":"","email":"","phone":"","status":"open","assigneeId":"","leadId":""}'::jsonb
 when 'service_messages' then '{"conversationId":"","text":"","direction":"outbound"}'::jsonb
 when 'notes' then '{"body":""}'::jsonb
 else null end;
$$;

create or replace function public.crm_suite_valid_data(p_kind text,p_data jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare defaults jsonb:=public.crm_suite_defaults(p_kind); k text; entry jsonb; number_value numeric; first_date date; last_date date;
begin
 if defaults is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>32768 then return false; end if;
 for k in select jsonb_object_keys(p_data) loop
   if not defaults ? k then return false; end if;
   if defaults->k <> 'null'::jsonb and jsonb_typeof(p_data->k) is distinct from jsonb_typeof(defaults->k) then return false; end if;
   if jsonb_typeof(p_data->k)='string' and length(p_data->>k)>8000 then return false; end if;
 end loop;
 if p_kind='leads' then
   if p_data->>'status' not in ('new','contacted','qualified','lost','converted') or (p_data->>'value')::numeric<0 or (p_data->>'value')::numeric>1000000000000 then return false; end if;
 elsif p_kind='automations' then
   if p_data->>'trigger'<>'deal_stage_changed' or p_data->>'action' not in ('create_task','send_email','update_deal') or p_data->>'stage' not in ('new','qualified','proposal','negotiation','won','lost') or (p_data->>'delayDays')::numeric not between 0 and 365 or (p_data->>'delayDays')::numeric<>trunc((p_data->>'delayDays')::numeric) then return false; end if;
   if p_data->>'action'='update_deal' and p_data->>'targetStage' not in ('new','qualified','proposal','negotiation','won','lost') then return false; end if;
 elsif p_kind in ('quotes','invoices') then
   if p_data->>'currency'<>'BRL' or p_data->>'status' not in ('draft','sent','accepted','cancelled','overdue','paid') or jsonb_array_length(p_data->'lines') not between 1 and 50 then return false; end if;
   if p_kind='quotes' and p_data->>'status' not in ('draft','sent','accepted','cancelled') then return false; end if;
   for entry in select value from jsonb_array_elements(p_data->'lines') loop
     if jsonb_typeof(entry)<>'object' or not entry ?& array['description','quantity','unitPrice'] or (select count(*) from jsonb_object_keys(entry))<>3 or jsonb_typeof(entry->'description')<>'string' or length(btrim(entry->>'description')) not between 1 and 500 or jsonb_typeof(entry->'quantity')<>'number' or jsonb_typeof(entry->'unitPrice')<>'number' or (entry->>'quantity')::numeric<0.001 or (entry->>'quantity')::numeric>1000000 or (entry->>'unitPrice')::numeric<0 or (entry->>'unitPrice')::numeric>10000000000 then return false; end if;
   end loop;
 elsif p_kind='projects' then
   if p_data->>'status' not in ('planning','active','completed') or jsonb_array_length(p_data->'members')>100 then return false; end if;
 elsif p_kind='project_tasks' then
   if p_data->>'status' not in ('backlog','todo','doing','done') or p_data->>'priority' not in ('low','medium','high') or jsonb_array_length(p_data->'dependsOn')>100 then return false; end if;
 elsif p_kind='project_templates' then
   if jsonb_array_length(p_data->'tasks') not between 1 and 100 then return false; end if;
   for entry in select value from jsonb_array_elements(p_data->'tasks') loop
     if jsonb_typeof(entry)<>'object' or jsonb_typeof(entry->'title')<>'string' or length(btrim(entry->>'title')) not between 1 and 160 then return false; end if;
     if exists(select 1 from jsonb_object_keys(entry) as f(key) where f.key not in ('title','description','durationDays','priority')) then return false; end if;
     if entry ? 'description' and jsonb_typeof(entry->'description')<>'string' then return false; end if;
     if entry ? 'durationDays' and (jsonb_typeof(entry->'durationDays')<>'number' or (entry->>'durationDays')::numeric not between 1 and 365 or (entry->>'durationDays')::numeric<>trunc((entry->>'durationDays')::numeric)) then return false; end if;
     if entry ? 'priority' and entry->>'priority' not in ('low','medium','high') then return false; end if;
   end loop;
 elsif p_kind='calendar_events' then
   if p_data->>'visibility' not in ('personal','team') or p_data->>'timeZone'<>'America/Sao_Paulo' or (p_data->>'endAt')::timestamptz<=(p_data->>'startAt')::timestamptz or jsonb_array_length(p_data->'attendees')>100 then return false; end if;
 elsif p_kind='booking_pages' then
   if (p_data->>'durationMinutes')::numeric not between 15 and 240 or (p_data->>'durationMinutes')::numeric<>trunc((p_data->>'durationMinutes')::numeric) or (p_data->>'startHour')::numeric not between 0 and 23 or (p_data->>'endHour')::numeric not between 1 and 24 or (p_data->>'endHour')::numeric<=(p_data->>'startHour')::numeric or (p_data->>'startHour')::numeric<>trunc((p_data->>'startHour')::numeric) or (p_data->>'endHour')::numeric<>trunc((p_data->>'endHour')::numeric) or p_data->>'timeZone'<>'America/Sao_Paulo' or jsonb_array_length(p_data->'weekdays') not between 1 and 7 then return false; end if;
   for entry in select value from jsonb_array_elements(p_data->'weekdays') loop
     if jsonb_typeof(entry)<>'number' or entry::text::numeric not between 0 and 6 or entry::text::numeric<>trunc(entry::text::numeric) then return false; end if;
   end loop;
 elsif p_kind='workflows' then
   if p_data->>'type' not in ('purchase','reimbursement','approval') or jsonb_array_length(p_data->'fields')>30 then return false; end if;
   for entry in select value from jsonb_array_elements(p_data->'fields') loop
     if jsonb_typeof(entry)<>'string' or length(btrim(entry#>>'{}')) not between 1 and 120 then return false; end if;
   end loop;
 elsif p_kind='workflow_requests' then
   if p_data->>'status' not in ('pending','approved','rejected') or (p_data->>'amount')::numeric not between 0 and 1000000000000 then return false; end if;
 elsif p_kind='channels' then
   if p_data->>'type' not in ('webchat','whatsapp','instagram','facebook','phone','email','manual') then return false; end if;
 elsif p_kind='service_conversations' then
   if p_data->>'status' not in ('open','pending','closed') or p_data->>'channel' not in ('webchat','whatsapp','instagram','facebook','phone','email','manual') then return false; end if;
 elsif p_kind='service_messages' then
   if p_data->>'direction' not in ('inbound','outbound') or length(btrim(p_data->>'text')) not between 1 and 4000 then return false; end if;
 end if;
 foreach k in array array['dueDate','startDate','endDate'] loop
   if coalesce(p_data->>k,'')<>'' then
     first_date:=(p_data->>k)::date;
     if to_char(first_date,'YYYY-MM-DD')<>p_data->>k then return false; end if;
   end if;
 end loop;
 if coalesce(p_data->>'startDate','')<>'' and coalesce(p_data->>'endDate','')<>'' and (p_data->>'endDate')::date<(p_data->>'startDate')::date then return false; end if;
 return true;
exception when others then return false;
end;
$$;

create or replace function public.crm_suite_member(p_team uuid,p_id text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 return exists(select 1 from public.crm_members m where m.workspace_id=p_team and m.user_id=p_id::uuid and m.active);
end;
$$;

create or replace function public.crm_suite_reference(p_team uuid,p_id text,p_kind text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 return exists(select 1 from public.crm_suite_items s where s.id=p_id::uuid and s.workspace_id=p_team and s.kind=p_kind and public.crm_suite_can(p_team,s.kind,'read',s.owner_id,s.data));
end;
$$;

create or replace function public.crm_suite_save(p_kind text,p_id uuid,p_title text,p_data jsonb,p_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); team uuid; old_item public.crm_suite_items; item public.crm_suite_items; next_data jsonb; defaults jsonb:=public.crm_suite_defaults(p_kind); ref_item public.crm_suite_items; k text; v jsonb; price numeric;
begin
 select workspace_id into team from public.crm_members where user_id=actor and active;
 if team is null then raise exception 'Seu acesso ao CRM precisa ser liberado.' using errcode='42501'; end if;
 perform 1 from public.crm_teams where id=team for update;
 if public.crm_role(team) is null then raise exception 'Acesso suspenso.' using errcode='42501'; end if;
 if defaults is null or p_kind in ('time_entries','attendance') then raise exception 'Use as ações de registro de tempo e ponto.' using errcode='22023'; end if;
 if p_kind='service_messages' and p_id is not null then raise exception 'O histórico de atendimento é imutável.' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or (p_title is not null and length(btrim(p_title)) not between 1 and 160) or (p_id is null and p_title is null) then raise exception 'Dados do módulo inválidos.' using errcode='22023'; end if;
 if p_id is not null then
   select * into old_item from public.crm_suite_items where id=p_id and workspace_id=team and kind=p_kind for update;
   if old_item.id is null or not public.crm_suite_can(team,p_kind,'read',old_item.owner_id,old_item.data) then raise exception 'Registro não encontrado.' using errcode='P0002'; end if;
   if not public.crm_suite_can(team,p_kind,'update',old_item.owner_id,old_item.data) then raise exception 'Sem permissão para alterar este registro.' using errcode='42501'; end if;
   if p_revision is distinct from old_item.revision then raise exception 'O registro foi alterado por outra pessoa. Atualize e tente novamente.' using errcode='PT409'; end if;
   next_data:=old_item.data||p_data;
 else
   if p_revision is not null then raise exception 'Uma criação não usa revisão.' using errcode='22023'; end if;
   if not public.crm_suite_can(team,p_kind,'create',actor,p_data) then raise exception 'Sem permissão para criar este registro.' using errcode='42501'; end if;
   next_data:=defaults||p_data;
 end if;
 if not public.crm_suite_valid_data(p_kind,next_data) then raise exception 'Campos inválidos para este módulo.' using errcode='22023'; end if;
 if p_kind='automations' and p_data ? 'lastRun' and p_data->'lastRun' is distinct from coalesce(old_item.data->'lastRun','null'::jsonb) then raise exception 'O resultado da automação é gerado pelo servidor.' using errcode='42501'; end if;
 -- Only actions may change derived state or time/approval identities.
 if p_kind='leads' and ((p_id is null and (next_data->>'status'='converted' or next_data->>'contactId'<>'' or next_data->>'dealId'<>'' or next_data->'convertedAt'<>'null'::jsonb)) or (p_id is not null and (old_item.data->>'status'='converted' or next_data->'convertedAt' is distinct from old_item.data->'convertedAt' or next_data->>'contactId' is distinct from old_item.data->>'contactId' or next_data->>'dealId' is distinct from old_item.data->>'dealId'))) then raise exception 'A conversão de lead deve usar a ação própria.' using errcode='42501'; end if;
 if p_kind='invoices' and (next_data->>'status'='paid' or coalesce(next_data->>'paymentUrl','')<>'') then raise exception 'Pagamento e link dependem do provedor integrado.' using errcode='42501'; end if;
 if p_kind in ('quotes','invoices') then
   select coalesce(sum(round((line->>'quantity')::numeric*(line->>'unitPrice')::numeric,2)),0) into price from jsonb_array_elements(next_data->'lines') line;
   if price>90071992547409.91 then raise exception 'O valor excede o limite de faturamento.' using errcode='22023'; end if;
   next_data:=jsonb_set(next_data,'{total}',to_jsonb(price));
   if coalesce(next_data->>'dealId','')<>'' and not exists(select 1 from public.crm_records r where r.workspace_id=team and r.collection='deals' and r.id=next_data->>'dealId' and public.crm_can(team,'deals','read',r.owner_id)) then raise exception 'Negócio não encontrado.' using errcode='22023'; end if;
 end if;
 if p_kind='projects' then
   for v in select value from jsonb_array_elements(next_data->'members') loop
     if jsonb_typeof(v)<>'string' or not public.crm_suite_member(team,v#>>'{}') then raise exception 'Membro de projeto inválido.' using errcode='22023'; end if;
   end loop;
 end if;
 if p_kind='project_tasks' then
   if not public.crm_suite_reference(team,next_data->>'projectId','projects') then raise exception 'Projeto não encontrado.' using errcode='22023'; end if;
   if coalesce(next_data->>'assigneeId','')<>'' and not public.crm_suite_member(team,next_data->>'assigneeId') then raise exception 'Responsável inválido.' using errcode='22023'; end if;
   for v in select value from jsonb_array_elements(next_data->'dependsOn') loop
     if jsonb_typeof(v)<>'string' or not public.crm_suite_reference(team,v#>>'{}','project_tasks') or v#>>'{}'=coalesce(p_id::text,'') or not exists(select 1 from public.crm_suite_items s where s.id=(v#>>'{}')::uuid and s.data->>'projectId'=next_data->>'projectId') then raise exception 'Dependência de tarefa inválida.' using errcode='22023'; end if;
   end loop;
   if p_id is not null and exists(with recursive dependencies(id) as (
     select value#>>'{}' from jsonb_array_elements(next_data->'dependsOn')
     union
     select dep.value#>>'{}' from dependencies d join public.crm_suite_items s on s.id::text=d.id cross join lateral jsonb_array_elements(s.data->'dependsOn') dep where s.workspace_id=team and s.kind='project_tasks'
   ) select 1 from dependencies where id=p_id::text) then raise exception 'As dependências não podem formar um ciclo.' using errcode='22023'; end if;
   if p_id is not null and old_item.owner_id<>actor and not public.crm_can(team,'tasks','update',old_item.owner_id) and ((next_data-'status') is distinct from (old_item.data-'status') or coalesce(p_title,old_item.title)<>old_item.title) then raise exception 'O responsável só altera a etapa da própria tarefa atribuída.' using errcode='42501'; end if;
 end if;
 if p_kind='calendar_events' then
   for v in select value from jsonb_array_elements(next_data->'attendees') loop
     if jsonb_typeof(v)<>'string' or not public.crm_suite_member(team,v#>>'{}') then raise exception 'Participante inválido.' using errcode='22023'; end if;
   end loop;
 end if;
 if p_kind='employees' then
   if not public.crm_suite_member(team,next_data->>'userId') or (coalesce(next_data->>'managerId','')<>'' and not public.crm_suite_member(team,next_data->>'managerId')) then raise exception 'Funcionário ou gestor inválido.' using errcode='22023'; end if;
   if exists(select 1 from public.crm_suite_items s where s.workspace_id=team and s.kind='employees' and s.data->>'userId'=next_data->>'userId' and s.id is distinct from p_id) then raise exception 'Já existe uma ficha para este funcionário.' using errcode='23505'; end if;
 end if;
 if p_kind='workflows' and (not public.crm_suite_member(team,next_data->>'approverId') or not exists(select 1 from public.crm_members m where m.workspace_id=team and m.user_id=(next_data->>'approverId')::uuid and m.role in ('admin','manager') and m.active)) then raise exception 'Escolha um gestor ou administrador como aprovador.' using errcode='22023'; end if;
 if p_kind='workflow_requests' then
   if p_id is not null then raise exception 'Solicitações enviadas são imutáveis; use as ações de decisão.' using errcode='42501'; end if;
   if not public.crm_suite_reference(team,next_data->>'workflowId','workflows') then raise exception 'Fluxo não encontrado.' using errcode='22023'; end if;
   select * into ref_item from public.crm_suite_items where id=(next_data->>'workflowId')::uuid;
   for k,v in select * from jsonb_each(next_data->'answers') loop
     if not (ref_item.data->'fields') ? k or jsonb_typeof(v)<>'string' or length(v#>>'{}')>2000 then raise exception 'Resposta inválida para este fluxo.' using errcode='22023'; end if;
   end loop;
   if next_data->>'status'<>'pending' or next_data->>'decisionNote'<>'' or next_data->'decidedAt'<>'null'::jsonb or next_data->'decidedBy'<>'null'::jsonb then raise exception 'Uma solicitação começa pendente.' using errcode='42501'; end if;
   if coalesce(next_data->>'approverId','') not in ('',ref_item.data->>'approverId') then raise exception 'O aprovador é definido pelo fluxo.' using errcode='42501'; end if;
   next_data:=jsonb_set(next_data,'{approverId}',ref_item.data->'approverId');
 end if;
 if p_kind='service_conversations' then
   if coalesce(next_data->>'assigneeId','')<>'' and not public.crm_suite_member(team,next_data->>'assigneeId') then raise exception 'Responsável inválido.' using errcode='22023'; end if;
   if coalesce(next_data->>'leadId','')<>'' and not public.crm_suite_reference(team,next_data->>'leadId','leads') then raise exception 'Lead não encontrado.' using errcode='22023'; end if;
 end if;
 if p_kind='service_messages' then
   if not public.crm_suite_reference(team,next_data->>'conversationId','service_conversations') then raise exception 'Atendimento não encontrado.' using errcode='22023'; end if;
   select * into ref_item from public.crm_suite_items where id=(next_data->>'conversationId')::uuid;
   if next_data->>'direction'='outbound' and ref_item.data->>'status'='closed' then raise exception 'Reabra o atendimento antes de responder.' using errcode='22023'; end if;
   if (next_data->>'direction'='inbound' and ref_item.data->>'channel'<>'manual') or (next_data->>'direction'='outbound' and ref_item.data->>'channel' not in ('manual','webchat')) then raise exception 'Este canal depende de uma integração ativa para enviar ou receber mensagens.' using errcode='22023'; end if;
 end if;
 if p_id is null then
   insert into public.crm_suite_items(workspace_id,kind,title,data,owner_id) values(team,p_kind,btrim(p_title),next_data,actor) returning * into item;
 else
   update public.crm_suite_items set title=coalesce(btrim(p_title),old_item.title),data=next_data,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into item;
 end if;
 return public.crm_suite_dto(item);
end;
$$;

create or replace function public.crm_suite_delete(p_kind text,p_id uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare team uuid; item public.crm_suite_items;
begin
 select workspace_id into team from public.crm_members where user_id=auth.uid() and active;
 if team is null then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 select * into item from public.crm_suite_items where id=p_id and workspace_id=team and kind=p_kind for update;
 if item.id is null or not public.crm_suite_can(team,p_kind,'read',item.owner_id,item.data) then raise exception 'Registro não encontrado.' using errcode='P0002'; end if;
 if not public.crm_suite_can(team,p_kind,'delete',item.owner_id,item.data) or p_kind in ('workflow_requests','service_messages') then raise exception 'Sem permissão para excluir este registro.' using errcode='42501'; end if;
 if p_revision is distinct from item.revision then raise exception 'O registro foi alterado por outra pessoa.' using errcode='PT409'; end if;
 if exists(select 1 from public.crm_suite_items s where s.workspace_id=team and ((p_kind='projects' and s.kind='project_tasks' and s.data->>'projectId'=p_id::text) or (p_kind='project_tasks' and s.kind='time_entries' and s.data->>'taskId'=p_id::text) or (p_kind='workflows' and s.kind='workflow_requests' and s.data->>'workflowId'=p_id::text) or (p_kind='service_conversations' and s.kind='service_messages' and s.data->>'conversationId'=p_id::text))) then raise exception 'Este registro ainda possui itens vinculados.' using errcode='23503'; end if;
 delete from public.crm_suite_items where id=p_id;
 return jsonb_build_object('ok',true);
end;
$$;

create unique index if not exists crm_suite_one_running_timer on public.crm_suite_items(workspace_id,owner_id) where kind='time_entries' and data->>'status'='running';
create unique index if not exists crm_suite_one_open_attendance on public.crm_suite_items(workspace_id,owner_id) where kind='attendance' and data->>'state' in ('working','paused');

create or replace function public.crm_suite_action(p_action text,p_id uuid,p_revision integer,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); team uuid; item public.crm_suite_items; target public.crm_suite_items; now_at timestamptz:=clock_timestamp(); data jsonb; title text; total numeric; break_total numeric; contact_id text; deal_id text; actor_name text; note text; entry jsonb; index_last integer; result_data jsonb;
begin
 select workspace_id into team from public.crm_members where user_id=actor and active;
 if team is null then raise exception 'Seu acesso ao CRM precisa ser liberado.' using errcode='42501'; end if;
 perform 1 from public.crm_teams where id=team for update;
 if public.crm_role(team) is null then raise exception 'Acesso suspenso.' using errcode='42501'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>8192 then raise exception 'Dados da ação inválidos.' using errcode='22023'; end if;
 if p_action in ('time_start','clock_in') then
   if p_id is not null or p_revision is not null then raise exception 'Uma nova contagem não usa identificador ou revisão.' using errcode='22023'; end if;
   if p_action='time_start' then
     if (select count(*) from jsonb_object_keys(p_payload))<>1 or jsonb_typeof(p_payload->'taskId') is distinct from 'string' then raise exception 'Informe uma tarefa válida.' using errcode='22023'; end if;
     if public.crm_suite_reference(team,p_payload->>'taskId','project_tasks') then
       select * into target from public.crm_suite_items where id=(p_payload->>'taskId')::uuid;
       title:=target.title;
     else
       select r.payload->>'title' into title from public.crm_records r where r.workspace_id=team and r.collection='tasks' and r.id=p_payload->>'taskId' and public.crm_can(team,'tasks','read',r.owner_id);
       if title is null then raise exception 'Tarefa não encontrada.' using errcode='P0002'; end if;
     end if;
     if exists(select 1 from public.crm_suite_items s where s.workspace_id=team and s.owner_id=actor and s.kind='time_entries' and s.data->>'status'='running') then raise exception 'Você já tem um cronômetro em andamento.' using errcode='23505'; end if;
     data:=jsonb_build_object('taskId',p_payload->>'taskId','startedAt',now_at,'endedAt',null,'durationSeconds',0,'status','running');
     insert into public.crm_suite_items(workspace_id,kind,title,data,owner_id) values(team,'time_entries',title,data,actor) returning * into item;
   else
     if p_payload<>'{}'::jsonb then raise exception 'O ponto usa apenas o horário do servidor.' using errcode='22023'; end if;
     if exists(select 1 from public.crm_suite_items s where s.workspace_id=team and s.owner_id=actor and s.kind='attendance' and s.data->>'state' in ('working','paused')) then raise exception 'Você já registrou uma entrada em aberto.' using errcode='23505'; end if;
     data:=jsonb_build_object('userId',actor,'startedAt',now_at,'endedAt',null,'breaks','[]'::jsonb,'state','working','durationSeconds',0);
     insert into public.crm_suite_items(workspace_id,kind,title,data,owner_id) values(team,'attendance','Ponto '||to_char(now_at at time zone 'America/Sao_Paulo','DD/MM/YYYY'),data,actor) returning * into item;
   end if;
   return public.crm_suite_dto(item);
 end if;
 select * into item from public.crm_suite_items where id=p_id and workspace_id=team for update;
 if item.id is null or not public.crm_suite_can(team,item.kind,'read',item.owner_id,item.data) then raise exception 'Registro não encontrado.' using errcode='P0002'; end if;
 if p_revision is distinct from item.revision then raise exception 'O registro foi alterado por outra pessoa. Atualize e tente novamente.' using errcode='PT409'; end if;
 data:=item.data;
 if p_action in ('time_stop','pause','resume','clock_out') then
   if item.owner_id<>actor then raise exception 'Somente a própria pessoa registra seu tempo e ponto.' using errcode='42501'; end if;
   if p_payload<>'{}'::jsonb then raise exception 'Os horários são calculados pelo servidor.' using errcode='22023'; end if;
   if p_action='time_stop' then
     if item.kind<>'time_entries' or data->>'status'<>'running' then raise exception 'Este cronômetro não está em andamento.' using errcode='22023'; end if;
     total:=greatest(0,floor(extract(epoch from now_at-(data->>'startedAt')::timestamptz)));
     data:=data||jsonb_build_object('status','stopped','endedAt',now_at,'durationSeconds',total);
   else
     if item.kind<>'attendance' or data->>'state'='closed' then raise exception 'Não existe uma jornada em aberto.' using errcode='22023'; end if;
     if p_action='pause' then
       if data->>'state'<>'working' then raise exception 'A jornada já está em pausa.' using errcode='22023'; end if;
       data:=data||jsonb_build_object('state','paused','breaks',(data->'breaks')||jsonb_build_array(jsonb_build_object('startedAt',now_at,'endedAt',null)));
     elsif p_action='resume' then
       if data->>'state'<>'paused' then raise exception 'A jornada não está em pausa.' using errcode='22023'; end if;
       index_last:=jsonb_array_length(data->'breaks')-1;
       data:=jsonb_set(data,array['breaks',index_last::text,'endedAt'],to_jsonb(now_at));
       data:=jsonb_set(data,'{state}','"working"'::jsonb);
     elsif p_action='clock_out' then
       if data->>'state'='paused' then
         index_last:=jsonb_array_length(data->'breaks')-1;
         data:=jsonb_set(data,array['breaks',index_last::text,'endedAt'],to_jsonb(now_at));
       end if;
       data:=data||jsonb_build_object('state','closed','endedAt',now_at);
     end if;
     select coalesce(sum(extract(epoch from coalesce((b->>'endedAt')::timestamptz,now_at)-(b->>'startedAt')::timestamptz)),0) into break_total from jsonb_array_elements(data->'breaks') b;
     total:=greatest(0,floor(extract(epoch from now_at-(data->>'startedAt')::timestamptz)-break_total));
     data:=jsonb_set(data,'{durationSeconds}',to_jsonb(total));
   end if;
 elsif p_action in ('approve','reject') then
   if item.kind<>'workflow_requests' or data->>'status'<>'pending' then raise exception 'Esta solicitação não está pendente.' using errcode='22023'; end if;
   if not (data->>'approverId'=actor::text and public.crm_role(team) in ('admin','manager')) and public.crm_role(team)<>'admin' then raise exception 'Somente o aprovador indicado e ainda autorizado pode decidir.' using errcode='42501'; end if;
   if exists(select 1 from jsonb_object_keys(p_payload) as k(key) where k.key<>'note') or (p_payload ? 'note' and jsonb_typeof(p_payload->'note')<>'string') then raise exception 'Informe apenas a observação da decisão.' using errcode='22023'; end if;
   note:=coalesce(p_payload->>'note','');
   if length(note)>2000 then raise exception 'A observação excede 2000 caracteres.' using errcode='22023'; end if;
   data:=data||jsonb_build_object('status',case p_action when 'approve' then 'approved' else 'rejected' end,'decisionNote',note,'decidedAt',now_at,'decidedBy',actor);
 elsif p_action='convert_lead' then
   if item.kind<>'leads' or data->>'status' in ('converted','lost') then raise exception 'Este lead não pode ser convertido.' using errcode='22023'; end if;
   if p_payload<>'{}'::jsonb or not public.crm_can(team,'deals','update',item.owner_id) or not public.crm_can(team,'deals','create',item.owner_id) or not public.crm_can(team,'contacts','create',item.owner_id) or not public.crm_assignable_owner(team,'deals',item.owner_id) or not public.crm_assignable_owner(team,'contacts',item.owner_id) then raise exception 'Sem permissão para converter este lead.' using errcode='42501'; end if;
   contact_id:=gen_random_uuid()::text; deal_id:=gen_random_uuid()::text;
   select coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),'Colaborador') into actor_name from auth.users u where u.id=item.owner_id;
   insert into public.crm_records(workspace_id,collection,id,owner_id,payload) values(team,'contacts',contact_id,item.owner_id,jsonb_build_object('id',contact_id,'name',coalesce(nullif(data->>'name',''),item.title),'email',coalesce(data->>'email',''),'phone',coalesce(data->>'phone',''),'role','','companyId','','owner',actor_name));
   insert into public.crm_records(workspace_id,collection,id,owner_id,payload) values(team,'deals',deal_id,item.owner_id,jsonb_build_object('id',deal_id,'title',item.title,'value',coalesce((data->>'value')::numeric,0),'stage','new','companyId','','contactId',contact_id,'owner',actor_name,'dueDate','','description',coalesce(data->>'notes','')));
   data:=data||jsonb_build_object('status','converted','contactId',contact_id,'dealId',deal_id,'convertedAt',now_at);
 else
   raise exception 'Ação desconhecida.' using errcode='22023';
 end if;
 result_data:=data;
 update public.crm_suite_items set data=result_data,revision=revision+1,updated_at=now_at where id=item.id returning * into item;
 return public.crm_suite_dto(item);
end;
$$;

create or replace function public.crm_booking_page(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare page public.crm_suite_items; starts jsonb; intervals jsonb;
begin
 select * into page from public.crm_suite_items s where s.id=p_id and s.kind='booking_pages' and s.data->'enabled'='true'::jsonb;
 if page.id is null or not exists(select 1 from public.crm_members m where m.workspace_id=page.workspace_id and m.user_id=page.owner_id and m.active) then raise exception 'Agenda indisponível.' using errcode='P0002'; end if;
 select coalesce(jsonb_agg(s.data->'startAt' order by s.data->>'startAt'),'[]'::jsonb),
   coalesce(jsonb_agg(jsonb_build_object('startAt',s.data->'startAt','endAt',s.data->'endAt') order by s.data->>'startAt'),'[]'::jsonb)
 into starts,intervals from public.crm_suite_items s where s.workspace_id=page.workspace_id and s.owner_id=page.owner_id and s.kind='calendar_events' and (s.data->>'endAt')::timestamptz>clock_timestamp() and (s.data->>'startAt')::timestamptz<clock_timestamp()+interval '60 days';
 return jsonb_build_object('id',page.id,'title',page.title,'data',jsonb_build_object('durationMinutes',page.data->'durationMinutes','weekdays',page.data->'weekdays','startHour',page.data->'startHour','endHour',page.data->'endHour','timeZone',page.data->'timeZone'),'busyStartTimes',starts,'busyIntervals',intervals);
end;
$$;

create or replace function public.crm_booking_reserve(p_id uuid,p_name text,p_email text,p_start_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare page public.crm_suite_items; end_at timestamptz; local_start timestamp; duration integer; start_day integer; now_at timestamptz:=clock_timestamp(); event_id uuid;
begin
 select * into page from public.crm_suite_items s where s.id=p_id and s.kind='booking_pages' for update;
 if page.id is null or page.data->'enabled'<>'true'::jsonb or not exists(select 1 from public.crm_members m where m.workspace_id=page.workspace_id and m.user_id=page.owner_id and m.active) then raise exception 'Agenda indisponível.' using errcode='P0002'; end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Informe nome e e-mail válidos.' using errcode='22023'; end if;
 if p_start_at is null or p_start_at<now_at+interval '15 minutes' or p_start_at>now_at+interval '60 days' then raise exception 'Escolha um horário futuro dentro dos próximos 60 dias.' using errcode='22023'; end if;
 duration:=(page.data->>'durationMinutes')::integer;
 end_at:=p_start_at+make_interval(mins=>duration);
 local_start:=p_start_at at time zone (page.data->>'timeZone');
 start_day:=extract(dow from local_start)::integer;
 if not page.data->'weekdays' @> to_jsonb(start_day) or extract(hour from local_start)<(page.data->>'startHour')::integer or (end_at at time zone (page.data->>'timeZone'))::date<>local_start::date or extract(epoch from ((end_at at time zone (page.data->>'timeZone'))::time))>(page.data->>'endHour')::integer*3600 or extract(second from local_start)<>0 or mod((extract(hour from local_start)::integer-(page.data->>'startHour')::integer)*60+extract(minute from local_start)::integer,duration)<>0 then raise exception 'Horário fora da disponibilidade desta agenda.' using errcode='22023'; end if;
 -- Serialize all writes to this owner's calendar, including distinct booking pages.
 perform pg_advisory_xact_lock(hashtextextended(page.workspace_id::text||page.owner_id::text,0));
 if exists(select 1 from public.crm_suite_items s where s.workspace_id=page.workspace_id and s.owner_id=page.owner_id and s.kind='calendar_events' and (s.data->>'startAt')::timestamptz<end_at and (s.data->>'endAt')::timestamptz>p_start_at) then raise exception 'Este horário já foi reservado. Escolha outro.' using errcode='23505'; end if;
 event_id:=gen_random_uuid();
 insert into public.crm_suite_items(id,workspace_id,kind,title,data,owner_id)
 values(event_id,page.workspace_id,'calendar_events','Agendamento • '||btrim(p_name),jsonb_build_object('startAt',p_start_at,'endAt',end_at,'timeZone',page.data->>'timeZone','visibility','personal','attendees','[]'::jsonb,'description','Cliente: '||btrim(p_name)||E'\nE-mail: '||lower(btrim(p_email)),'location',''),page.owner_id);
 return jsonb_build_object('id',event_id,'ok',true,'startAt',p_start_at,'endAt',end_at);
end;
$$;

-- A stage transition invokes matching internal rules in the same transaction.
-- External e-mail delivery is not represented as sent without a configured provider.
create table if not exists public.crm_automation_runs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.crm_teams(id) on delete cascade,
 rule_id uuid references public.crm_suite_items(id) on delete set null,deal_id text not null,stage text not null,
 status text not null check(status in ('completed','blocked','provider_required')),message text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.crm_automation_runs enable row level security;
alter table public.crm_automation_runs force row level security;
revoke all on public.crm_automation_runs from public,anon,authenticated;
grant select on public.crm_automation_runs to authenticated;
drop policy if exists crm_automation_runs_read on public.crm_automation_runs;
create policy crm_automation_runs_read on public.crm_automation_runs for select to authenticated
 using(public.crm_role(workspace_id) in ('admin','manager'));

create or replace function public.crm_suite_deal_automation()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare rule public.crm_suite_items; task_id text; due_on text; actor_label text; result_status text; result_message text;
begin
 if new.collection<>'deals' or new.payload->>'stage' is not distinct from old.payload->>'stage' or pg_trigger_depth()>1 then return new; end if;
 for rule in select s.* from public.crm_suite_items s where s.workspace_id=new.workspace_id and s.kind='automations' and s.data->'enabled'='true'::jsonb and s.data->>'trigger'='deal_stage_changed' and s.data->>'stage'=new.payload->>'stage' order by s.created_at,s.id loop
   result_status:='completed'; result_message:='Regra executada.';
   if rule.data->>'action'='create_task' then
     if new.owner_id is null or not public.crm_suite_member(new.workspace_id,new.owner_id::text) or not public.crm_can(new.workspace_id,'tasks','create',new.owner_id) or not public.crm_assignable_owner(new.workspace_id,'tasks',new.owner_id) then
       result_status:='blocked';result_message:='Criação de tarefa bloqueada pelas permissões do usuário que alterou o negócio.';
     else
       task_id:=gen_random_uuid()::text;
       due_on:=to_char((clock_timestamp() at time zone 'America/Sao_Paulo')::date+coalesce((rule.data->>'delayDays')::integer,0),'YYYY-MM-DD');
       insert into public.crm_records(workspace_id,collection,id,owner_id,payload) values(new.workspace_id,'tasks',task_id,new.owner_id,jsonb_build_object('id',task_id,'title',coalesce(nullif(btrim(rule.data->>'taskTitle'),''),'Acompanhar '||(new.payload->>'title')),'dueDate',due_on,'priority','medium','status','pending','owner',coalesce(new.payload->>'owner','Colaborador'),'dealId',new.id));
     end if;
   elsif rule.data->>'action'='update_deal' then
     if not public.crm_can(new.workspace_id,'deals','update',new.owner_id) then result_status:='blocked';result_message:='Alteração de etapa bloqueada pelas permissões do usuário.';
     elsif rule.data->>'targetStage'=new.payload->>'stage' then result_message:='O negócio já estava na etapa de destino.';
     else
       update public.crm_records r set payload=jsonb_set(r.payload,'{stage}',rule.data->'targetStage') where r.workspace_id=new.workspace_id and r.collection='deals' and r.id=new.id;
     end if;
   else result_status:='provider_required';result_message:='Conecte um provedor de e-mail para enviar esta mensagem.';
   end if;
   insert into public.crm_automation_runs(workspace_id,rule_id,deal_id,stage,status,message) values(new.workspace_id,rule.id,new.id,new.payload->>'stage',result_status,result_message);
   update public.crm_suite_items set data=jsonb_set(data,'{lastRun}',jsonb_build_object('status',result_status,'message',result_message,'at',clock_timestamp())),revision=revision+1,updated_at=clock_timestamp() where id=rule.id;
 end loop;
 return new;
end;
$$;
drop trigger if exists crm_suite_deal_automation on public.crm_records;
create trigger crm_suite_deal_automation after update on public.crm_records for each row execute function public.crm_suite_deal_automation();

revoke all on function public.crm_suite_dto(public.crm_suite_items),public.crm_suite_can(uuid,text,text,uuid,jsonb),public.crm_suite_list(),public.crm_suite_defaults(text),public.crm_suite_valid_data(text,jsonb),public.crm_suite_member(uuid,text),public.crm_suite_reference(uuid,text,text),public.crm_suite_save(text,uuid,text,jsonb,integer),public.crm_suite_delete(text,uuid,integer),public.crm_suite_action(text,uuid,integer,jsonb),public.crm_booking_page(uuid),public.crm_booking_reserve(uuid,text,text,timestamptz),public.crm_suite_deal_automation() from public,anon,authenticated;
grant execute on function public.crm_suite_can(uuid,text,text,uuid,jsonb),public.crm_suite_list(),public.crm_suite_save(text,uuid,text,jsonb,integer),public.crm_suite_delete(text,uuid,integer),public.crm_suite_action(text,uuid,integer,jsonb) to authenticated;
grant execute on function public.crm_booking_page(uuid),public.crm_booking_reserve(uuid,text,text,timestamptz) to anon,authenticated;

commit;
