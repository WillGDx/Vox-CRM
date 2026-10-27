-- Personal profile media and administrator-controlled workspace naming.
-- Profile details/preferences remain owned by Supabase Auth user_metadata.
begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('crm-personal-media', 'crm-personal-media', false, 8388608,
  array['image/png', 'image/jpeg', 'image/webp'])
on conflict(id) do update set public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.crm_personal_media_path_owner(p_name text)
returns uuid language sql immutable set search_path=pg_catalog as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(avatar|background)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$'
    then split_part(p_name,'/',1)::uuid else null end;
$$;

create or replace function public.crm_personal_media_can_write(p_name text, p_owner_id text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select coalesce(auth.uid() is not null
    and public.crm_personal_media_path_owner(p_name)=auth.uid()
    and p_owner_id=auth.uid()::text
    and exists(select 1 from public.crm_members m where m.user_id=auth.uid() and m.active),false);
$$;

create or replace function public.crm_personal_media_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare owner_user uuid := public.crm_personal_media_path_owner(p_name); actor uuid := auth.uid(); team uuid;
begin
  if actor is null or owner_user is null or p_owner_id is distinct from owner_user::text then return false; end if;
  select m.workspace_id into team from public.crm_members m where m.user_id=actor and m.active;
  if team is null then return false; end if;
  if actor=owner_user then return true; end if;
  return split_part(p_name,'/',2)='avatar'
    and exists(select 1 from public.crm_members m
      where m.workspace_id=team and m.user_id=owner_user and m.active);
end;
$$;

-- Grant this bucket's intended access without replacing other Storage policies.
drop policy if exists crm_personal_media_select on storage.objects;
create policy crm_personal_media_select on storage.objects for select to authenticated
  using(bucket_id='crm-personal-media' and public.crm_personal_media_can_read(name,owner_id));
drop policy if exists crm_personal_media_insert on storage.objects;
create policy crm_personal_media_insert on storage.objects for insert to authenticated
  with check(bucket_id='crm-personal-media' and public.crm_personal_media_can_write(name,owner_id));
drop policy if exists crm_personal_media_update on storage.objects;
create policy crm_personal_media_update on storage.objects for update to authenticated
  using(bucket_id='crm-personal-media' and public.crm_personal_media_can_write(name,owner_id))
  with check(bucket_id='crm-personal-media' and public.crm_personal_media_can_write(name,owner_id));
drop policy if exists crm_personal_media_delete on storage.objects;
create policy crm_personal_media_delete on storage.objects for delete to authenticated
  using(bucket_id='crm-personal-media' and public.crm_personal_media_can_write(name,owner_id));

-- Existing broad permissive policies must not expose private personal media.
-- The guards are neutral for every unrelated bucket and role policy.
drop policy if exists crm_personal_media_guard_select on storage.objects;
create policy crm_personal_media_guard_select on storage.objects as restrictive for select to public
  using(bucket_id<>'crm-personal-media' or public.crm_personal_media_can_read(name,owner_id));
drop policy if exists crm_personal_media_guard_insert on storage.objects;
create policy crm_personal_media_guard_insert on storage.objects as restrictive for insert to public
  with check(bucket_id<>'crm-personal-media' or public.crm_personal_media_can_write(name,owner_id));
drop policy if exists crm_personal_media_guard_update on storage.objects;
create policy crm_personal_media_guard_update on storage.objects as restrictive for update to public
  using(bucket_id<>'crm-personal-media' or public.crm_personal_media_can_write(name,owner_id))
  with check(bucket_id<>'crm-personal-media' or public.crm_personal_media_can_write(name,owner_id));
drop policy if exists crm_personal_media_guard_delete on storage.objects;
create policy crm_personal_media_guard_delete on storage.objects as restrictive for delete to public
  using(bucket_id<>'crm-personal-media' or public.crm_personal_media_can_write(name,owner_id));

create or replace function public.crm_profile_directory()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare team uuid; result jsonb;
begin
  select m.workspace_id into team from public.crm_members m where m.user_id=auth.uid() and m.active;
  if team is null then raise exception 'Seu acesso ao CRM precisa ser liberado.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',m.user_id,
    'displayName',left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),'Colaborador'),120),
    'avatarPath',case
      when public.crm_personal_media_path_owner(u.raw_user_meta_data->>'avatar_path')=m.user_id
        and split_part(u.raw_user_meta_data->>'avatar_path','/',2)='avatar'
      then u.raw_user_meta_data->>'avatar_path' else null end
    ) order by m.created_at,m.user_id),'[]'::jsonb)
    into result from public.crm_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=team and m.active;
  return result;
end;
$$;

create or replace function public.crm_set_workspace_name(p_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare team uuid; label text := btrim(p_name);
begin
  select m.workspace_id into team from public.crm_members m
    where m.user_id=auth.uid() and m.active and m.role='admin';
  if team is null then raise exception 'Apenas administradores alteram a organização.' using errcode='42501'; end if;
  if label is null or length(label) not between 1 and 120 then
    raise exception 'O nome da organização precisa ter entre 1 e 120 caracteres.' using errcode='22023';
  end if;
  perform 1 from public.crm_teams t where t.id=team for update;
  if public.crm_role(team) is distinct from 'admin' then
    raise exception 'Apenas administradores alteram a organização.' using errcode='42501';
  end if;
  update public.crm_teams set name=label where id=team;
  return jsonb_build_object('workspace',jsonb_build_object('id',team,'name',label));
end;
$$;

revoke all on function public.crm_personal_media_path_owner(text),
  public.crm_personal_media_can_write(text,text), public.crm_personal_media_can_read(text,text),
  public.crm_profile_directory(), public.crm_set_workspace_name(text) from public,anon,authenticated;
-- These boolean guards are safe for anonymous policy evaluation; they return false.
grant execute on function public.crm_personal_media_can_read(text,text),
  public.crm_personal_media_can_write(text,text) to anon,authenticated;
grant execute on function public.crm_profile_directory(),public.crm_set_workspace_name(text) to authenticated;

commit;
