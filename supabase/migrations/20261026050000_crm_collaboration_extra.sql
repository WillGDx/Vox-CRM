-- Additional collaboration: private groups, polls and organization files.
begin;
create table if not exists public.crm_extra_groups (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_teams(id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 120), member_ids uuid[] not null,
 creator_id uuid references auth.users(id) on delete set null, video_room uuid not null default gen_random_uuid(),
 created_at timestamptz not null default clock_timestamp(), check(cardinality(member_ids) between 1 and 30)
);
create table if not exists public.crm_extra_messages (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_teams(id) on delete cascade,
 group_id uuid not null references public.crm_extra_groups(id) on delete cascade,
 sender_id uuid references auth.users(id) on delete set null, sender_name text not null,
 body text not null check(length(btrim(body)) between 1 and 4000), created_at timestamptz not null default clock_timestamp()
);
create index if not exists crm_extra_messages_history on public.crm_extra_messages(group_id,created_at desc,id desc);
create table if not exists public.crm_extra_polls (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_teams(id) on delete cascade,
 question text not null check(length(btrim(question)) between 1 and 300), options jsonb not null,
 closed boolean not null default false, author_id uuid references auth.users(id) on delete set null,
 author_name text not null, created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.crm_extra_votes (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_teams(id) on delete cascade,
 poll_id uuid not null references public.crm_extra_polls(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, option_id uuid not null,
 unique(poll_id,user_id)
);
create table if not exists public.crm_extra_files (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_teams(id) on delete cascade,
 name text not null check(length(name) between 1 and 160), path text not null unique,
 mime text not null, size bigint not null check(size between 1 and 10485760),
 author_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default clock_timestamp()
);
create or replace function public.crm_extra_group_access(p_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.crm_extra_groups g join public.crm_members m on m.workspace_id=g.workspace_id
 where g.id=p_id and m.user_id=auth.uid() and m.active and auth.uid()=any(g.member_ids));
$$;
create or replace function public.crm_extra_file_access(p_name text,p_owner text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare team uuid; role_name text;
begin
 if p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|pdf|txt|csv)$' then return false; end if;
 select m.workspace_id,m.role into team,role_name from public.crm_members m where m.user_id=auth.uid() and m.active;
 return coalesce(team::text=split_part(p_name,'/',1) and (not p_write or p_owner=auth.uid()::text or role_name='admin'),false);
end;
$$;
alter table public.crm_extra_groups enable row level security;
alter table public.crm_extra_messages enable row level security;
alter table public.crm_extra_polls enable row level security;
alter table public.crm_extra_votes enable row level security;
alter table public.crm_extra_files enable row level security;
drop policy if exists crm_extra_groups_read on public.crm_extra_groups;
create policy crm_extra_groups_read on public.crm_extra_groups for select to authenticated using(public.crm_extra_group_access(id));
drop policy if exists crm_extra_messages_read on public.crm_extra_messages;
create policy crm_extra_messages_read on public.crm_extra_messages for select to authenticated using(public.crm_extra_group_access(group_id));
drop policy if exists crm_extra_polls_read on public.crm_extra_polls;
create policy crm_extra_polls_read on public.crm_extra_polls for select to authenticated using(exists(select 1 from public.crm_members m where m.user_id=auth.uid() and m.active and m.workspace_id=crm_extra_polls.workspace_id));
drop policy if exists crm_extra_files_read on public.crm_extra_files;
create policy crm_extra_files_read on public.crm_extra_files for select to authenticated using(exists(select 1 from public.crm_members m where m.user_id=auth.uid() and m.active and m.workspace_id=crm_extra_files.workspace_id));
drop policy if exists crm_extra_votes_read on public.crm_extra_votes;
create policy crm_extra_votes_read on public.crm_extra_votes for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.crm_members m where m.user_id=auth.uid() and m.active and m.workspace_id=crm_extra_votes.workspace_id));
revoke all on public.crm_extra_groups,public.crm_extra_messages,public.crm_extra_polls,public.crm_extra_votes,public.crm_extra_files from anon,authenticated;
grant select on public.crm_extra_groups,public.crm_extra_messages,public.crm_extra_polls,public.crm_extra_votes,public.crm_extra_files to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-shared-files','crm-shared-files',false,10485760,array['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists crm_extra_files_storage_read on storage.objects;
create policy crm_extra_files_storage_read on storage.objects for select to authenticated using(bucket_id='crm-shared-files' and public.crm_extra_file_access(name,owner_id,false));
drop policy if exists crm_extra_files_storage_insert on storage.objects;
create policy crm_extra_files_storage_insert on storage.objects for insert to authenticated with check(bucket_id='crm-shared-files' and owner_id=auth.uid()::text and public.crm_extra_file_access(name,owner_id,true));
drop policy if exists crm_extra_files_storage_delete on storage.objects;
create policy crm_extra_files_storage_delete on storage.objects for delete to authenticated using(bucket_id='crm-shared-files' and public.crm_extra_file_access(name,owner_id,true));
drop policy if exists crm_extra_files_guard_read on storage.objects;
create policy crm_extra_files_guard_read on storage.objects as restrictive for select to public using(bucket_id<>'crm-shared-files' or public.crm_extra_file_access(name,owner_id,false));
drop policy if exists crm_extra_files_guard_insert on storage.objects;
create policy crm_extra_files_guard_insert on storage.objects as restrictive for insert to public with check(bucket_id<>'crm-shared-files' or (owner_id=auth.uid()::text and public.crm_extra_file_access(name,owner_id,true)));
drop policy if exists crm_extra_files_guard_update on storage.objects;
create policy crm_extra_files_guard_update on storage.objects as restrictive for update to public using(bucket_id<>'crm-shared-files') with check(bucket_id<>'crm-shared-files');
drop policy if exists crm_extra_files_guard_delete on storage.objects;
create policy crm_extra_files_guard_delete on storage.objects as restrictive for delete to public using(bucket_id<>'crm-shared-files' or public.crm_extra_file_access(name,owner_id,true));

create or replace function public.crm_collaboration_extra(p_action text,p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); team uuid; actor_role text; actor_name text; target uuid; row_group public.crm_extra_groups;
 row_poll public.crm_extra_polls; row_file public.crm_extra_files; result jsonb; members uuid[]; choices jsonb; n integer; object_row storage.objects;
begin
 select m.workspace_id,m.role into team,actor_role from public.crm_members m where m.user_id=actor and m.active;
 if team is null then raise exception 'Seu acesso ao CRM precisa ser liberado.' using errcode='42501'; end if;
 select coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),'Colaborador') into actor_name from auth.users where id=actor;
 if jsonb_typeof(p_args) is distinct from 'object' then raise exception 'Dados inválidos.' using errcode='22023'; end if;
 if p_action='state' then
  select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'memberIds',g.member_ids,'creatorId',g.creator_id,'createdAt',g.created_at,'videoRoom',g.video_room) order by g.created_at desc) from public.crm_extra_groups g where g.workspace_id=team and actor=any(g.member_ids)),'[]'::jsonb),
  'polls',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'question',p.question,'closed',p.closed,'authorId',p.author_id,'authorName',p.author_name,'createdAt',p.created_at,'myOptionId',(select v.option_id from public.crm_extra_votes v where v.poll_id=p.id and v.user_id=actor),
   'options',(select jsonb_agg(o || jsonb_build_object('votes',(select count(*) from public.crm_extra_votes v where v.poll_id=p.id and v.option_id=(o->>'id')::uuid))) from jsonb_array_elements(p.options) o)) order by p.created_at desc) from public.crm_extra_polls p where p.workspace_id=team),'[]'::jsonb),
  'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'path',f.path,'mime',f.mime,'size',f.size,'authorId',f.author_id,'createdAt',f.created_at) order by f.created_at desc) from public.crm_extra_files f where f.workspace_id=team),'[]'::jsonb)) into result;
  return result;
 elsif p_action='groups_create' then
  if length(btrim(p_args->>'title')) not between 1 and 120 or jsonb_typeof(p_args->'memberIds') is distinct from 'array' or jsonb_array_length(p_args->'memberIds')>29 then raise exception 'Informe um nome e até 29 colegas.' using errcode='22023'; end if;
  select array_agg(distinct value::uuid) into members from (select jsonb_array_elements_text(p_args->'memberIds') as value union all select actor::text) q;
  if exists(select 1 from unnest(members) x where not exists(select 1 from public.crm_members m where m.user_id=x and m.workspace_id=team and m.active)) then raise exception 'Selecione colegas ativos da sua organização.' using errcode='42501'; end if;
  insert into public.crm_extra_groups(workspace_id,title,member_ids,creator_id) values(team,btrim(p_args->>'title'),members,actor) returning id into target;
  return jsonb_build_object('id',target);
 elsif p_action in ('groups_messages','groups_send') then
  target:=(p_args->>'groupId')::uuid;
  select * into row_group from public.crm_extra_groups where id=target and workspace_id=team and actor=any(member_ids);
  if not found then raise exception 'Grupo não encontrado.' using errcode='42501'; end if;
  if p_action='groups_messages' then
   return jsonb_build_object('items',coalesce((select jsonb_agg(x.item order by x.created_at,x.id) from (select m.id,m.created_at,jsonb_build_object('id',m.id,'groupId',m.group_id,'senderId',m.sender_id,'senderName',m.sender_name,'body',m.body,'createdAt',m.created_at) item from public.crm_extra_messages m where m.group_id=target and ((p_args->>'before') is null or (m.created_at,m.id)<((p_args->>'before')::timestamptz,(p_args->>'beforeId')::uuid)) order by m.created_at desc,m.id desc limit 50) x),'[]'::jsonb));
  end if;
  if length(btrim(p_args->>'body')) not between 1 and 4000 then raise exception 'Escreva até 4000 caracteres.' using errcode='22023'; end if;
  insert into public.crm_extra_messages(workspace_id,group_id,sender_id,sender_name,body) values(team,target,actor,left(actor_name,120),btrim(p_args->>'body')) returning id into target;
  return jsonb_build_object('id',target);
 elsif p_action='polls_create' then
  if length(btrim(p_args->>'question')) not between 1 and 300 or jsonb_typeof(p_args->'options') is distinct from 'array' or jsonb_array_length(p_args->'options') not between 2 and 8 then raise exception 'Informe uma pergunta e de 2 a 8 opções.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_args->'options') o where jsonb_typeof(o)<>'string' or length(btrim(o#>>'{}')) not between 1 and 100) then raise exception 'Cada opção deve ter até 100 caracteres.' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'label',btrim(o#>>'{}'))) into choices from jsonb_array_elements(p_args->'options') o;
  insert into public.crm_extra_polls(workspace_id,question,options,author_id,author_name) values(team,btrim(p_args->>'question'),choices,actor,left(actor_name,120)) returning id into target;
  return jsonb_build_object('id',target);
 elsif p_action in ('polls_vote','polls_close') then
  select * into row_poll from public.crm_extra_polls where id=(p_args->>'pollId')::uuid and workspace_id=team for update;
  if not found then raise exception 'Enquete não encontrada.' using errcode='42501'; end if;
  if p_action='polls_close' then
   if row_poll.author_id is distinct from actor and actor_role<>'admin' then raise exception 'Apenas autor ou administrador encerra a enquete.' using errcode='42501'; end if;
   update public.crm_extra_polls set closed=true where id=row_poll.id;
  else
   if row_poll.closed then raise exception 'Esta enquete já foi encerrada.' using errcode='22023'; end if;
   if not exists(select 1 from jsonb_array_elements(row_poll.options) o where o->>'id'=p_args->>'optionId') then raise exception 'Opção inválida.' using errcode='22023'; end if;
   insert into public.crm_extra_votes(workspace_id,poll_id,user_id,option_id) values(team,row_poll.id,actor,(p_args->>'optionId')::uuid) on conflict(poll_id,user_id) do update set option_id=excluded.option_id;
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='files_register' then
  if length(p_args->>'name') not between 1 and 160 or (p_args->>'mime') not in ('image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv') or (p_args->>'size')::bigint not between 1 and 10485760 or not public.crm_extra_file_access(p_args->>'path',actor::text,true) then raise exception 'Arquivo inválido.' using errcode='22023'; end if;
  select * into object_row from storage.objects where bucket_id='crm-shared-files' and name=p_args->>'path' and owner_id=actor::text;
  if not found or object_row.metadata->>'mimetype' is distinct from p_args->>'mime' or (object_row.metadata->>'size')::bigint is distinct from (p_args->>'size')::bigint then raise exception 'Envie o arquivo pela sua própria conta antes de publicar.' using errcode='42501'; end if;
  insert into public.crm_extra_files(workspace_id,name,path,mime,size,author_id) values(team,p_args->>'name',p_args->>'path',p_args->>'mime',(p_args->>'size')::bigint,actor) returning id into target;
  return jsonb_build_object('id',target);
 elsif p_action='files_remove' then
  select * into row_file from public.crm_extra_files where id=(p_args->>'id')::uuid and workspace_id=team;
  if not found or (row_file.author_id is distinct from actor and actor_role<>'admin') then raise exception 'Arquivo não encontrado ou sem permissão.' using errcode='42501'; end if;
  delete from public.crm_extra_files where id=row_file.id;
  return jsonb_build_object('ok',true,'path',row_file.path);
 end if;
 raise exception 'Ação não disponível.' using errcode='22023';
end;
$$;
revoke all on function public.crm_extra_group_access(uuid),public.crm_extra_file_access(text,text,boolean),public.crm_collaboration_extra(text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_extra_group_access(uuid) to authenticated;
grant execute on function public.crm_extra_file_access(text,text,boolean) to anon,authenticated;
grant execute on function public.crm_collaboration_extra(text,jsonb) to authenticated;
commit;
