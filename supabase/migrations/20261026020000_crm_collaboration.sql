-- Company feed and private/team conversations.
-- Writes use verified-user RPCs; SELECT policies also protect Realtime delivery.
begin;

create table if not exists public.crm_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  kind text not null check (kind in ('team','direct')),
  direct_a uuid references auth.users(id) on delete cascade,
  direct_b uuid references auth.users(id) on delete cascade,
  creator_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint crm_chat_pair_shape check (
    (kind='team' and direct_a is null and direct_b is null)
    or (kind='direct' and direct_a is not null and direct_b is not null and direct_a < direct_b)
  )
);
create unique index if not exists crm_chat_one_team
  on public.crm_chat_conversations(workspace_id) where kind='team';
create unique index if not exists crm_chat_one_pair
  on public.crm_chat_conversations(workspace_id,direct_a,direct_b) where kind='direct';

create table if not exists public.crm_chat_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  conversation_id uuid not null references public.crm_chat_conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint crm_chat_message_body check (
    length(body)<=4000 and ((deleted_at is null and length(btrim(body,E' \t\r\n'))>0)
      or (deleted_at is not null and body=''))
  )
);
create index if not exists crm_chat_message_history
  on public.crm_chat_messages(conversation_id,created_at desc,id desc);
create table if not exists public.crm_chat_reads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.crm_chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  last_read_at timestamptz not null,
  unique(conversation_id,user_id)
);

create table if not exists public.crm_feed_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint crm_feed_post_body check (
    length(body)<=8000 and ((deleted_at is null and length(btrim(body,E' \t\r\n'))>0)
      or (deleted_at is not null and body=''))
  )
);
create index if not exists crm_feed_post_order
  on public.crm_feed_posts(workspace_id,pinned desc,created_at desc,id desc);
create table if not exists public.crm_feed_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  post_id uuid not null references public.crm_feed_posts(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint crm_feed_comment_body check (
    length(body)<=2000 and ((deleted_at is null and length(btrim(body,E' \t\r\n'))>0)
      or (deleted_at is not null and body=''))
  )
);
create index if not exists crm_feed_comment_order
  on public.crm_feed_comments(post_id,created_at desc,id desc);
create table if not exists public.crm_feed_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.crm_feed_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.crm_teams(id) on delete cascade,
  reaction text check(reaction is null or reaction in ('like','celebrate','heart')),
  created_at timestamptz not null default clock_timestamp(),
  unique(post_id,user_id)
);

create or replace function public.crm_collab_active(p_workspace uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.crm_members m
    where m.workspace_id=p_workspace and m.user_id=auth.uid() and m.active);
$$;
create or replace function public.crm_collab_workspace()
returns uuid language plpgsql stable security definer set search_path=pg_catalog as $$
declare result uuid;
begin
  select m.workspace_id into result from public.crm_members m
    where m.user_id=auth.uid() and m.active;
  if result is null then raise exception 'Seu acesso ao CRM precisa ser liberado.' using errcode='42501'; end if;
  return result;
end;
$$;
create or replace function public.crm_collab_name(p_user uuid)
returns text language sql stable security definer set search_path=pg_catalog as $$
  select coalesce((select coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
    split_part(u.email,'@',1),'Colaborador') from auth.users u where u.id=p_user),'Ex-colaborador');
$$;
create or replace function public.crm_chat_visible(p_conversation uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.crm_chat_conversations c
    where c.id=p_conversation and public.crm_collab_active(c.workspace_id)
      and (c.kind='team' or auth.uid() in (c.direct_a,c.direct_b)));
$$;
create or replace function public.crm_feed_visible(p_post uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.crm_feed_posts p where p.id=p_post
    and p.deleted_at is null and public.crm_collab_active(p.workspace_id));
$$;
create or replace function public.crm_chat_require(p_conversation uuid)
returns public.crm_chat_conversations language plpgsql stable security definer set search_path=pg_catalog as $$
declare result public.crm_chat_conversations%rowtype;
begin
  if not public.crm_chat_visible(p_conversation) then
    raise exception 'Você não participa desta conversa.' using errcode='42501';
  end if;
  select * into result from public.crm_chat_conversations where id=p_conversation;
  return result;
end;
$$;
create or replace function public.crm_feed_require(p_post uuid)
returns public.crm_feed_posts language plpgsql stable security definer set search_path=pg_catalog as $$
declare result public.crm_feed_posts%rowtype;
begin
  if not public.crm_feed_visible(p_post) then
    raise exception 'Publicação não encontrada.' using errcode='P0002';
  end if;
  select * into result from public.crm_feed_posts where id=p_post;
  return result;
end;
$$;

alter table public.crm_chat_conversations enable row level security;
alter table public.crm_chat_conversations force row level security;
alter table public.crm_chat_messages enable row level security;
alter table public.crm_chat_messages force row level security;
alter table public.crm_chat_reads enable row level security;
alter table public.crm_chat_reads force row level security;
alter table public.crm_feed_posts enable row level security;
alter table public.crm_feed_posts force row level security;
alter table public.crm_feed_comments enable row level security;
alter table public.crm_feed_comments force row level security;
alter table public.crm_feed_reactions enable row level security;
alter table public.crm_feed_reactions force row level security;
revoke all on public.crm_chat_conversations,public.crm_chat_messages,public.crm_chat_reads,
  public.crm_feed_posts,public.crm_feed_comments,public.crm_feed_reactions from public,anon,authenticated;
grant select on public.crm_chat_conversations,public.crm_chat_messages,public.crm_chat_reads,
  public.crm_feed_posts,public.crm_feed_comments,public.crm_feed_reactions to authenticated;
drop policy if exists crm_chat_conversation_read on public.crm_chat_conversations;
create policy crm_chat_conversation_read on public.crm_chat_conversations for select to authenticated
  using(public.crm_chat_visible(id));
drop policy if exists crm_chat_message_read on public.crm_chat_messages;
create policy crm_chat_message_read on public.crm_chat_messages for select to authenticated
  using(public.crm_chat_visible(conversation_id) and public.crm_collab_active(workspace_id));
drop policy if exists crm_chat_reads_own on public.crm_chat_reads;
create policy crm_chat_reads_own on public.crm_chat_reads for select to authenticated
  using(user_id=auth.uid() and public.crm_chat_visible(conversation_id));
drop policy if exists crm_feed_post_read on public.crm_feed_posts;
create policy crm_feed_post_read on public.crm_feed_posts for select to authenticated
  using(public.crm_collab_active(workspace_id));
drop policy if exists crm_feed_comment_read on public.crm_feed_comments;
create policy crm_feed_comment_read on public.crm_feed_comments for select to authenticated
  using(public.crm_collab_active(workspace_id) and public.crm_feed_visible(post_id));
drop policy if exists crm_feed_reaction_read on public.crm_feed_reactions;
create policy crm_feed_reaction_read on public.crm_feed_reactions for select to authenticated
  using(public.crm_collab_active(workspace_id) and public.crm_feed_visible(post_id));

create or replace function public.crm_chat_message_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',m.id,'conversationId',m.conversation_id,
    'senderId',m.sender_id,'senderName',m.sender_name,'body',m.body,
    'createdAt',m.created_at,'editedAt',m.edited_at,'deletedAt',m.deleted_at)
  from public.crm_chat_messages m where m.id=p_id;
$$;
create or replace function public.crm_chat_conversation_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',c.id,'kind',c.kind,
    'title',case when c.kind='team' then 'Equipe' else public.crm_collab_name(
      case when c.direct_a=auth.uid() then c.direct_b else c.direct_a end) end,
    'peerId',case when c.kind='team' then null
      when c.direct_a=auth.uid() then c.direct_b else c.direct_a end,
    'createdAt',c.created_at,
    'lastMessage',(select case when m.deleted_at is null then m.body else 'Mensagem excluída' end
      from public.crm_chat_messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),
    'lastMessageAt',(select m.created_at from public.crm_chat_messages m
      where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),
    'unreadCount',(select count(*)::integer from public.crm_chat_messages m where m.conversation_id=c.id
      and m.sender_id is distinct from auth.uid() and m.deleted_at is null
      and m.created_at>coalesce((select r.last_read_at from public.crm_chat_reads r
        where r.conversation_id=c.id and r.user_id=auth.uid()),'-infinity'::timestamptz)))
  from public.crm_chat_conversations c where c.id=p_id;
$$;
create or replace function public.crm_chat_list()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare team uuid; conversations jsonb;
begin
  team:=public.crm_collab_workspace();
  insert into public.crm_chat_conversations(workspace_id,kind,creator_id)
    values(team,'team',auth.uid()) on conflict(workspace_id) where kind='team' do nothing;
  select coalesce(jsonb_agg(item order by coalesce((item->>'lastMessageAt')::timestamptz,
    (item->>'createdAt')::timestamptz) desc,item->>'id'),'[]'::jsonb) into conversations
    from (select public.crm_chat_conversation_json(c.id) as item
      from public.crm_chat_conversations c where c.workspace_id=team and public.crm_chat_visible(c.id)) q;
  return jsonb_build_object('conversations',conversations,'totalUnread',
    (select coalesce(sum((value->>'unreadCount')::integer),0) from jsonb_array_elements(conversations)));
end;
$$;
create or replace function public.crm_chat_open(p_peer_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare team uuid; first_user uuid; second_user uuid; conversation uuid;
begin
  team:=public.crm_collab_workspace();
  if p_peer_id is null or p_peer_id=auth.uid() or not exists(select 1 from public.crm_members m
    where m.workspace_id=team and m.user_id=p_peer_id and m.active) then
    raise exception 'Escolha outro colaborador ativo desta organização.' using errcode='22023';
  end if;
  first_user:=least(auth.uid(),p_peer_id);second_user:=greatest(auth.uid(),p_peer_id);
  insert into public.crm_chat_conversations(workspace_id,kind,direct_a,direct_b,creator_id)
    values(team,'direct',first_user,second_user,auth.uid())
    on conflict(workspace_id,direct_a,direct_b) where kind='direct' do nothing;
  select c.id into conversation from public.crm_chat_conversations c
    where c.workspace_id=team and c.kind='direct' and c.direct_a=first_user and c.direct_b=second_user;
  perform public.crm_chat_require(conversation);
  return public.crm_chat_conversation_json(conversation);
end;
$$;
create or replace function public.crm_chat_history(p_conversation_id uuid,
  p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 31)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.crm_chat_require(p_conversation_id);
  if p_limit is null or p_limit not between 1 and 51
     or (p_before_created_at is null)<>(p_before_id is null) then
    raise exception 'Paginação inválida.' using errcode='22023';
  end if;
  return (select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb)
    from (select public.crm_chat_message_json(m.id) item,m.created_at,m.id
      from public.crm_chat_messages m where m.conversation_id=p_conversation_id
        and (p_before_created_at is null or (m.created_at,m.id)<(p_before_created_at,p_before_id))
      order by m.created_at desc,m.id desc limit p_limit) q);
end;
$$;
create or replace function public.crm_chat_send(p_conversation_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare conversation public.crm_chat_conversations%rowtype; message uuid; content text;
begin
  conversation:=public.crm_chat_require(p_conversation_id);content:=btrim(p_body,E' \t\r\n');
  if content is null or length(content) not between 1 and 4000 then
    raise exception 'A mensagem precisa ter entre 1 e 4000 caracteres.' using errcode='22023';
  end if;
  insert into public.crm_chat_messages(workspace_id,conversation_id,sender_id,sender_name,body)
    values(conversation.workspace_id,conversation.id,auth.uid(),public.crm_collab_name(auth.uid()),content)
    returning id into message;
  return public.crm_chat_message_json(message);
end;
$$;
create or replace function public.crm_chat_edit(p_message_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare message public.crm_chat_messages%rowtype; content text;
begin
  select * into message from public.crm_chat_messages where id=p_message_id for update;
  if not found then raise exception 'Mensagem não encontrada.' using errcode='P0002'; end if;
  perform public.crm_chat_require(message.conversation_id);
  if message.sender_id is distinct from auth.uid() or message.deleted_at is not null then
    raise exception 'Você pode editar somente suas mensagens.' using errcode='42501';
  end if;
  content:=btrim(p_body,E' \t\r\n');
  if content is null or length(content) not between 1 and 4000 then
    raise exception 'A mensagem precisa ter entre 1 e 4000 caracteres.' using errcode='22023';
  end if;
  update public.crm_chat_messages set body=content,edited_at=clock_timestamp() where id=message.id;
  return public.crm_chat_message_json(message.id);
end;
$$;
create or replace function public.crm_chat_delete(p_message_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare message public.crm_chat_messages%rowtype; conversation public.crm_chat_conversations%rowtype;
begin
  select * into message from public.crm_chat_messages where id=p_message_id for update;
  if not found then raise exception 'Mensagem não encontrada.' using errcode='P0002'; end if;
  conversation:=public.crm_chat_require(message.conversation_id);
  if message.sender_id is distinct from auth.uid() and
    not(conversation.kind='team' and public.crm_role(conversation.workspace_id)='admin') then
    raise exception 'Você não pode excluir esta mensagem.' using errcode='42501';
  end if;
  if message.deleted_at is null then
    update public.crm_chat_messages set body='',deleted_at=clock_timestamp() where id=message.id;
  end if;
  return jsonb_build_object('ok',true);
end;
$$;
create or replace function public.crm_chat_mark_read(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare conversation public.crm_chat_conversations%rowtype; read_at timestamptz:=clock_timestamp();
begin
  conversation:=public.crm_chat_require(p_conversation_id);
  insert into public.crm_chat_reads(conversation_id,user_id,workspace_id,last_read_at)
    values(conversation.id,auth.uid(),conversation.workspace_id,read_at)
    on conflict(conversation_id,user_id) do update set last_read_at=greatest(crm_chat_reads.last_read_at,excluded.last_read_at);
  return jsonb_build_object('ok',true,'lastReadAt',read_at);
end;
$$;

create or replace function public.crm_feed_post_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',p.id,'authorId',p.author_id,'authorName',p.author_name,
    'body',p.body,'createdAt',p.created_at,'editedAt',p.edited_at,'deletedAt',p.deleted_at,'pinned',p.pinned,
    'commentCount',(select count(*)::integer from public.crm_feed_comments c where c.post_id=p.id and c.deleted_at is null),
    'reactions',jsonb_build_object(
      'like',(select count(*)::integer from public.crm_feed_reactions r where r.post_id=p.id and r.reaction='like'),
      'celebrate',(select count(*)::integer from public.crm_feed_reactions r where r.post_id=p.id and r.reaction='celebrate'),
      'heart',(select count(*)::integer from public.crm_feed_reactions r where r.post_id=p.id and r.reaction='heart')),
    'myReaction',(select r.reaction from public.crm_feed_reactions r where r.post_id=p.id and r.user_id=auth.uid()))
  from public.crm_feed_posts p where p.id=p_id;
$$;
create or replace function public.crm_feed_comment_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',c.id,'postId',c.post_id,'authorId',c.author_id,'authorName',c.author_name,
    'body',c.body,'createdAt',c.created_at,'editedAt',c.edited_at,'deletedAt',c.deleted_at)
  from public.crm_feed_comments c where c.id=p_id;
$$;
create or replace function public.crm_feed_list(p_before_pinned boolean default null,
  p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 21)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare team uuid;
begin
  team:=public.crm_collab_workspace();
  if p_limit is null or p_limit not between 1 and 51
    or (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_pinned is null)<>(p_before_id is null) then
    raise exception 'Paginação inválida.' using errcode='22023';
  end if;
  return (select coalesce(jsonb_agg(item order by pinned desc,created_at desc,id desc),'[]'::jsonb)
    from (select public.crm_feed_post_json(p.id) item,p.pinned,p.created_at,p.id
      from public.crm_feed_posts p where p.workspace_id=team and p.deleted_at is null
        and (p_before_id is null or (p.pinned,p.created_at,p.id)<(p_before_pinned,p_before_created_at,p_before_id))
      order by p.pinned desc,p.created_at desc,p.id desc limit p_limit) q);
end;
$$;
create or replace function public.crm_feed_create(p_body text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare team uuid; post uuid; content text:=btrim(p_body,E' \t\r\n');
begin
  team:=public.crm_collab_workspace();
  if content is null or length(content) not between 1 and 8000 then
    raise exception 'A publicação precisa ter entre 1 e 8000 caracteres.' using errcode='22023';
  end if;
  insert into public.crm_feed_posts(workspace_id,author_id,author_name,body)
    values(team,auth.uid(),public.crm_collab_name(auth.uid()),content) returning id into post;
  return public.crm_feed_post_json(post);
end;
$$;
create or replace function public.crm_feed_edit(p_post_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare post public.crm_feed_posts%rowtype; content text:=btrim(p_body,E' \t\r\n');
begin
  post:=public.crm_feed_require(p_post_id);
  if post.author_id is distinct from auth.uid() then
    raise exception 'Você pode editar somente suas publicações.' using errcode='42501';
  end if;
  if content is null or length(content) not between 1 and 8000 then
    raise exception 'A publicação precisa ter entre 1 e 8000 caracteres.' using errcode='22023';
  end if;
  update public.crm_feed_posts set body=content,edited_at=clock_timestamp() where id=post.id and deleted_at is null;
  if not found then raise exception 'Publicação não encontrada.' using errcode='P0002'; end if;
  return public.crm_feed_post_json(post.id);
end;
$$;
create or replace function public.crm_feed_delete(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare post public.crm_feed_posts%rowtype;
begin
  post:=public.crm_feed_require(p_post_id);
  if post.author_id is distinct from auth.uid() and public.crm_role(post.workspace_id)<>'admin' then
    raise exception 'Você não pode excluir esta publicação.' using errcode='42501';
  end if;
  update public.crm_feed_posts set body='',deleted_at=clock_timestamp(),pinned=false where id=post.id;
  return jsonb_build_object('ok',true);
end;
$$;
create or replace function public.crm_feed_pin(p_post_id uuid,p_pinned boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare post public.crm_feed_posts%rowtype;
begin
  post:=public.crm_feed_require(p_post_id);
  if public.crm_role(post.workspace_id)<>'admin' then
    raise exception 'Somente administradores podem fixar publicações.' using errcode='42501';
  end if;
  if p_pinned is null then raise exception 'Informe se a publicação deve ser fixada.' using errcode='22023'; end if;
  update public.crm_feed_posts set pinned=p_pinned where id=post.id and deleted_at is null;
  if not found then raise exception 'Publicação não encontrada.' using errcode='P0002'; end if;
  return public.crm_feed_post_json(post.id);
end;
$$;
create or replace function public.crm_feed_react(p_post_id uuid,p_reaction text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare post public.crm_feed_posts%rowtype;
begin
  post:=public.crm_feed_require(p_post_id);
  if p_reaction is not null and p_reaction not in ('like','celebrate','heart') then
    raise exception 'Escolha uma reação válida.' using errcode='22023';
  end if;
  perform 1 from public.crm_feed_posts where id=post.id and deleted_at is null for update;
  if not found then raise exception 'Publicação não encontrada.' using errcode='P0002'; end if;
  if p_reaction is null then
    -- Postgres Changes DELETE events do not enforce RLS and carry the PK.
    -- Keep normal removals as authorized UPDATE tombstones; opaque row PKs
    -- also prevent administrative cascade deletes from exposing participant IDs.
    update public.crm_feed_reactions set reaction=null where post_id=post.id and user_id=auth.uid();
  else
    insert into public.crm_feed_reactions(post_id,user_id,workspace_id,reaction)
      values(post.id,auth.uid(),post.workspace_id,p_reaction)
      on conflict(post_id,user_id) do update set reaction=excluded.reaction;
  end if;
  return public.crm_feed_post_json(post.id);
end;
$$;
create or replace function public.crm_feed_comments(p_post_id uuid,
  p_before_created_at timestamptz default null,p_before_id uuid default null,p_limit integer default 21)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.crm_feed_require(p_post_id);
  if p_limit is null or p_limit not between 1 and 51
    or (p_before_created_at is null)<>(p_before_id is null) then
    raise exception 'Paginação inválida.' using errcode='22023';
  end if;
  return (select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb)
    from (select public.crm_feed_comment_json(c.id) item,c.created_at,c.id
      from public.crm_feed_comments c where c.post_id=p_post_id and c.deleted_at is null
        and (p_before_id is null or (c.created_at,c.id)<(p_before_created_at,p_before_id))
      order by c.created_at desc,c.id desc limit p_limit) q);
end;
$$;
create or replace function public.crm_feed_comment_create(p_post_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare post public.crm_feed_posts%rowtype; comment_id uuid; content text:=btrim(p_body,E' \t\r\n');
begin
  post:=public.crm_feed_require(p_post_id);
  if content is null or length(content) not between 1 and 2000 then
    raise exception 'O comentário precisa ter entre 1 e 2000 caracteres.' using errcode='22023';
  end if;
  perform 1 from public.crm_feed_posts where id=post.id and deleted_at is null for share;
  if not found then raise exception 'Publicação não encontrada.' using errcode='P0002'; end if;
  insert into public.crm_feed_comments(workspace_id,post_id,author_id,author_name,body)
    values(post.workspace_id,post.id,auth.uid(),public.crm_collab_name(auth.uid()),content)
    returning id into comment_id;
  return public.crm_feed_comment_json(comment_id);
end;
$$;
create or replace function public.crm_feed_comment_edit(p_comment_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare comment public.crm_feed_comments%rowtype; content text:=btrim(p_body,E' \t\r\n');
begin
  select * into comment from public.crm_feed_comments where id=p_comment_id for update;
  if not found then raise exception 'Comentário não encontrado.' using errcode='P0002'; end if;
  perform public.crm_feed_require(comment.post_id);
  if comment.author_id is distinct from auth.uid() or comment.deleted_at is not null then
    raise exception 'Você pode editar somente seus comentários.' using errcode='42501';
  end if;
  if content is null or length(content) not between 1 and 2000 then
    raise exception 'O comentário precisa ter entre 1 e 2000 caracteres.' using errcode='22023';
  end if;
  update public.crm_feed_comments set body=content,edited_at=clock_timestamp() where id=comment.id;
  return public.crm_feed_comment_json(comment.id);
end;
$$;
create or replace function public.crm_feed_comment_delete(p_comment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare comment public.crm_feed_comments%rowtype;
begin
  select * into comment from public.crm_feed_comments where id=p_comment_id for update;
  if not found then raise exception 'Comentário não encontrado.' using errcode='P0002'; end if;
  perform public.crm_feed_require(comment.post_id);
  if comment.author_id is distinct from auth.uid() and public.crm_role(comment.workspace_id)<>'admin' then
    raise exception 'Você não pode excluir este comentário.' using errcode='42501';
  end if;
  if comment.deleted_at is null then
    update public.crm_feed_comments set body='',deleted_at=clock_timestamp() where id=comment.id;
  end if;
  return jsonb_build_object('ok',true);
end;
$$;

-- Helpers are not an alternate route around the authorized RPC boundary.
do $$
declare item record;
begin
  for item in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname ~ '^crm_(chat|feed|collab)_'
  loop execute format('revoke all on function %s from public,anon,authenticated',item.signature);end loop;
end;
$$;
grant execute on function public.crm_collab_active(uuid),public.crm_chat_visible(uuid),public.crm_feed_visible(uuid),
  public.crm_chat_list(),public.crm_chat_open(uuid),public.crm_chat_history(uuid,timestamptz,uuid,integer),
  public.crm_chat_send(uuid,text),public.crm_chat_edit(uuid,text),public.crm_chat_delete(uuid),public.crm_chat_mark_read(uuid),
  public.crm_feed_list(boolean,timestamptz,uuid,integer),public.crm_feed_create(text),public.crm_feed_edit(uuid,text),
  public.crm_feed_delete(uuid),public.crm_feed_pin(uuid,boolean),public.crm_feed_react(uuid,text),
  public.crm_feed_comments(uuid,timestamptz,uuid,integer),public.crm_feed_comment_create(uuid,text),
  public.crm_feed_comment_edit(uuid,text),public.crm_feed_comment_delete(uuid) to authenticated;

-- Managed Supabase projects already have this publication; local PostgreSQL tests may not.
do $$
declare item text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach item in array array['crm_chat_conversations','crm_chat_messages','crm_chat_reads',
      'crm_feed_posts','crm_feed_comments','crm_feed_reactions'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
        and schemaname='public' and tablename=item) then
        execute format('alter publication supabase_realtime add table public.%I',item);
      end if;
    end loop;
  end if;
end;
$$;
commit;
