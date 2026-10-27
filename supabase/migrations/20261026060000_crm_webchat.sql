begin;
create table if not exists public.crm_webchat_sessions (
 id uuid primary key default gen_random_uuid(),
 channel_id uuid not null references public.crm_suite_items(id) on delete cascade,
 workspace_id uuid not null references public.crm_teams(id) on delete cascade,
 conversation_id uuid not null references public.crm_suite_items(id) on delete cascade,
 token_hash text not null check(token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '7 days'
);
create index if not exists crm_webchat_channel_time on public.crm_webchat_sessions(channel_id,created_at);
alter table public.crm_webchat_sessions enable row level security;
alter table public.crm_webchat_sessions force row level security;
revoke all on public.crm_webchat_sessions from public,anon,authenticated;

create or replace function public.crm_webchat_public(p_action text,p_id uuid,p_token_hash text default null,p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare channel public.crm_suite_items; session public.crm_webchat_sessions; conv public.crm_suite_items; item public.crm_suite_items; messages jsonb; now_at timestamptz:=clock_timestamp(); text_value text:=btrim(p_args->>'message'); display text:=btrim(p_args->>'name'); email_value text:=btrim(p_args->>'email');
begin
 if p_action not in ('config','start','session','send') or jsonb_typeof(p_args) is distinct from 'object' then raise exception 'Solicitação inválida.' using errcode='22023'; end if;
 if p_action in ('config','start') then
  select * into channel from public.crm_suite_items where id=p_id and kind='channels' and data->>'type'='webchat' and data->'enabled'='true'::jsonb for update;
 else
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Atendimento não encontrado.' using errcode='P0002'; end if;
  select * into session from public.crm_webchat_sessions where id=p_id and token_hash=p_token_hash and expires_at>now_at for update;
  if session.id is null then raise exception 'Atendimento não encontrado ou expirado.' using errcode='P0002'; end if;
  select * into channel from public.crm_suite_items where id=session.channel_id and kind='channels' and data->>'type'='webchat' and data->'enabled'='true'::jsonb;
 end if;
 if channel.id is null or not exists(select 1 from public.crm_members where workspace_id=channel.workspace_id and user_id=channel.owner_id and active) then raise exception 'Este canal de atendimento está indisponível.' using errcode='P0002'; end if;
 if p_action='config' then return jsonb_build_object('id',channel.id,'title',channel.title); end if;
 if p_action in ('start','send') and (text_value is null or length(text_value) not between 1 and 4000) then raise exception 'Escreva uma mensagem com até 4.000 caracteres.' using errcode='22023'; end if;
 if p_action='start' then
  if display is null or length(display) not between 2 and 120 or email_value is null or length(email_value)>254 or (email_value<>'' and email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Confira seu nome e e-mail.' using errcode='22023'; end if;
  if (select count(*) from public.crm_webchat_sessions where channel_id=channel.id and created_at>now_at-interval '1 hour')>=60 then raise exception 'Este canal atingiu seu limite temporário. Tente mais tarde.' using errcode='54000'; end if;
  insert into public.crm_suite_items(workspace_id,kind,title,data,owner_id) values(channel.workspace_id,'service_conversations',display,jsonb_build_object('channel','webchat','customer',display,'email',email_value,'phone','','status','open','assigneeId','','leadId',''),channel.owner_id) returning * into conv;
  insert into public.crm_webchat_sessions(channel_id,workspace_id,conversation_id,token_hash) values(channel.id,channel.workspace_id,conv.id,p_token_hash) returning * into session;
 else
  select * into conv from public.crm_suite_items where id=session.conversation_id and workspace_id=session.workspace_id and kind='service_conversations';
  if conv.id is null then raise exception 'Atendimento não encontrado.' using errcode='P0002'; end if;
 end if;
 if p_action in ('start','send') then
  if conv.data->>'status'='closed' then raise exception 'Este atendimento foi encerrado.' using errcode='22023'; end if;
  if (select count(*) from public.crm_suite_items where workspace_id=conv.workspace_id and kind='service_messages' and data->>'conversationId'=conv.id::text and created_at>now_at-interval '1 minute' and data->>'direction'='inbound')>=20 then raise exception 'Aguarde um momento antes de enviar outra mensagem.' using errcode='54000'; end if;
  insert into public.crm_suite_items(workspace_id,kind,title,data,owner_id) values(conv.workspace_id,'service_messages',left(text_value,120),jsonb_build_object('conversationId',conv.id,'text',text_value,'direction','inbound'),conv.owner_id);
  update public.crm_suite_items set updated_at=now_at,revision=revision+1 where id=conv.id;
  if p_action='start' then return jsonb_build_object('id',session.id,'conversationId',conv.id); end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'text',x.data->>'text','direction',x.data->>'direction','createdAt',x.created_at) order by x.created_at,x.id),'[]'::jsonb) into messages from (select * from public.crm_suite_items where workspace_id=conv.workspace_id and kind='service_messages' and data->>'conversationId'=conv.id::text order by created_at desc,id desc limit 200) x;
 return jsonb_build_object('id',session.id,'title',channel.title,'status',conv.data->>'status','messages',messages,'hasMore',(select count(*)>200 from public.crm_suite_items where workspace_id=conv.workspace_id and kind='service_messages' and data->>'conversationId'=conv.id::text));
end;
$$;
revoke all on function public.crm_webchat_public(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_webchat_public(text,uuid,text,jsonb) to anon,authenticated;
commit;
