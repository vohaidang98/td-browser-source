-- TD Browser 1.3.1. Run once in the project's Supabase SQL Editor.
begin;
alter table public.app_users add column if not exists automation_enabled boolean not null default false;

create or replace function public.td_can_use_automation()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.app_users u where u.user_id = auth.uid()
  and u.status = 'active' and (u.role = 'admin' or u.automation_enabled)); $$;

create or replace function public.td_admin_list_users_v2()
returns table(user_id uuid,email text,role text,status text,created_at timestamptz,has_recovery_key boolean,automation_enabled boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  return query select u.user_id,u.email,u.role,u.status,u.created_at,
    (u.public_key is not null and u.private_key_ciphertext is not null),u.automation_enabled
    from public.app_users u order by u.created_at desc;
end; $$;

create or replace function public.td_admin_set_user_v2(p_user_id uuid,p_role text,p_status text,p_automation_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  if p_role is null or p_role not in ('user','admin') or p_status is null or p_status not in ('active','disabled') or p_automation_enabled is null then raise exception 'invalid_user_state'; end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or p_status <> 'active') then raise exception 'cannot_disable_current_admin'; end if;
  update public.app_users set role=p_role,status=p_status,automation_enabled=p_automation_enabled,updated_at=now() where user_id=p_user_id;
  if not found then raise exception 'user_not_found'; end if;
end; $$;

revoke all on function public.td_can_use_automation() from public,anon;
revoke all on function public.td_admin_list_users_v2() from public,anon;
revoke all on function public.td_admin_set_user_v2(uuid,text,text,boolean) from public,anon;
grant execute on function public.td_can_use_automation() to authenticated;
grant execute on function public.td_admin_list_users_v2() to authenticated;
grant execute on function public.td_admin_set_user_v2(uuid,text,text,boolean) to authenticated;
-- Existing app_users policies allow self/admin reads; direct writes stay revoked.
revoke insert,update,delete on public.app_users from anon,authenticated;
notify pgrst, 'reload schema';
commit;

-- TD Browser 1.3.2: Admin manages shared Desktop OAuth client, users link their own channels.
-- Requires the existing account schema and Flow permissions migration.
begin;

drop policy if exists "active users read settings" on public.app_settings;
create policy "active users read settings" on public.app_settings for select to authenticated
using (public.td_is_active_user() and setting_key <> 'google_client_desktop');

create or replace function public.td_google_desktop_client()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare config jsonb;
begin
  if not public.td_can_use_automation() then raise exception 'flow_permission_required'; end if;
  select setting_value into config from public.app_settings where setting_key='google_client_desktop';
  return config;
end; $$;

create or replace function public.td_admin_set_google_desktop_client(p_client jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare config jsonb;
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  if p_client is null or jsonb_typeof(p_client) <> 'object'
    or coalesce(jsonb_typeof(p_client->'client_id'),'') <> 'string'
    or coalesce(p_client->>'client_id','') !~ '^[A-Za-z0-9_.-]{10,250}\.apps\.googleusercontent\.com$'
    or coalesce(jsonb_typeof(p_client->'client_secret'),'') <> 'string'
    or length(coalesce(p_client->>'client_secret','')) not between 1 and 500
    or coalesce(jsonb_typeof(p_client->'project_id'),'') <> 'string'
    or length(p_client->>'project_id') > 150 then raise exception 'invalid_desktop_client'; end if;
  config=jsonb_build_object('client_id',p_client->>'client_id','client_secret',p_client->>'client_secret','project_id',p_client->>'project_id','updated_at',now());
  insert into public.app_settings(setting_key,setting_value,updated_at)
  values ('google_client_desktop',config,now())
  on conflict (setting_key) do update set setting_value=excluded.setting_value,updated_at=excluded.updated_at;
  return config;
end; $$;

revoke all on function public.td_google_desktop_client() from public,anon;
revoke all on function public.td_admin_set_google_desktop_client(jsonb) from public,anon;
grant execute on function public.td_google_desktop_client() to authenticated;
grant execute on function public.td_admin_set_google_desktop_client(jsonb) to authenticated;
revoke insert,update,delete on public.app_settings from anon,authenticated;
notify pgrst, 'reload schema';
commit;

-- TD Browser 1.3.3: channel credentials encrypted with the existing Cloud profile key.
begin;
create table if not exists public.profile_youtube_links (
  profile_id uuid primary key references public.cloud_profiles(id) on delete cascade,
  client_id text not null, channel_id text not null,
  encrypted_payload jsonb, revoked boolean not null default false,
  revision bigint not null default 1, updated_at timestamptz not null default now()
);
alter table public.profile_youtube_links enable row level security;
revoke all on table public.profile_youtube_links from anon,authenticated;

create or replace function public.td_list_profile_youtube_links(p_profile_ids uuid[])
returns setof public.profile_youtube_links language plpgsql stable security definer set search_path=public as $$
begin
  if not public.td_can_use_automation() then raise exception 'flow_permission_required'; end if;
  if p_profile_ids is null or cardinality(p_profile_ids)>200 then raise exception 'invalid_profile_list'; end if;
  return query select l.* from public.profile_youtube_links l where l.profile_id=any(p_profile_ids) and public.td_can_access_profile(l.profile_id);
end; $$;

create or replace function public.td_put_profile_youtube_link(p_profile_id uuid,p_client_id text,p_channel_id text,p_payload jsonb,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path=public as $$
declare next_revision bigint; configured_client text;
begin
  if not public.td_can_use_automation() or not public.td_can_access_profile(p_profile_id) then raise exception 'profile_access_denied'; end if;
  select setting_value->>'client_id' into configured_client from public.app_settings where setting_key='google_client_desktop';
  if p_client_id is null or p_client_id is distinct from configured_client then raise exception 'google_client_changed'; end if;
  if p_channel_id is null or p_channel_id !~ '^UC[A-Za-z0-9_-]{22}$' or p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_channel_link'; end if;
  if p_expected_revision>0 and not exists(select 1 from public.profile_youtube_links where profile_id=p_profile_id) then raise exception 'youtube_link_changed'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000
    or coalesce(p_payload->>'iv','') !~ '^[A-Za-z0-9+/]{16}$'
    or coalesce(p_payload->>'tag','') !~ '^[A-Za-z0-9+/]{22}==$'
    or coalesce(p_payload->>'ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception 'invalid_encrypted_link'; end if;
  insert into public.profile_youtube_links(profile_id,client_id,channel_id,encrypted_payload,revoked,revision)
  values(p_profile_id,p_client_id,p_channel_id,p_payload,false,1)
  on conflict(profile_id) do update set client_id=excluded.client_id,channel_id=excluded.channel_id,encrypted_payload=excluded.encrypted_payload,revoked=false,revision=profile_youtube_links.revision+1,updated_at=now()
    where profile_youtube_links.revision=p_expected_revision
  returning revision into next_revision;
  if next_revision is null then raise exception 'youtube_link_changed'; end if;
  return next_revision;
end; $$;

create or replace function public.td_admin_revoke_profile_youtube_link(p_profile_id uuid,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path=public as $$
declare next_revision bigint;
begin
  if not public.td_is_admin() or not public.td_can_access_profile(p_profile_id) then raise exception 'admin_required'; end if;
  update public.profile_youtube_links set encrypted_payload=null,revoked=true,revision=revision+1,updated_at=now()
  where profile_id=p_profile_id and revision=p_expected_revision returning revision into next_revision;
  if next_revision is null then raise exception 'youtube_link_changed'; end if;
  return next_revision;
end; $$;
revoke all on function public.td_list_profile_youtube_links(uuid[]) from public,anon;
revoke all on function public.td_put_profile_youtube_link(uuid,text,text,jsonb,bigint) from public,anon;
revoke all on function public.td_admin_revoke_profile_youtube_link(uuid,bigint) from public,anon;
grant execute on function public.td_list_profile_youtube_links(uuid[]) to authenticated;
grant execute on function public.td_put_profile_youtube_link(uuid,text,text,jsonb,bigint) to authenticated;
grant execute on function public.td_admin_revoke_profile_youtube_link(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;

-- TD Browser 1.3.3: searchable recipients for one profile; no keys exposed.
begin;
create or replace function public.td_list_share_recipients(
  p_profile_id uuid,p_search text default '',p_offset integer default 0,p_limit integer default 51
)
returns table(user_id uuid,email text,already_shared boolean,can_receive boolean)
language plpgsql stable security definer set search_path=public as $$
declare profile_owner uuid; sharing_enabled boolean;
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  if not public.td_can_access_profile(p_profile_id) then raise exception 'profile_access_denied'; end if;
  select p.owner_id into profile_owner from public.cloud_profiles p where p.id=p_profile_id and p.status='active';
  if profile_owner is null then raise exception 'profile_access_denied'; end if;
  select coalesce((s.setting_value->>'enabled')::boolean,false) into sharing_enabled from public.app_settings s where s.setting_key='profile_sharing';
  if not public.td_is_admin() and (profile_owner<>auth.uid() or not coalesce(sharing_enabled,false)) then raise exception 'user_sharing_disabled'; end if;
  if length(coalesce(p_search,''))>254 or p_offset is null or p_offset<0 or p_offset>1000000 or p_limit is null or p_limit<1 or p_limit>51 then raise exception 'invalid_recipient_query'; end if;
  return query select u.user_id,u.email,
    exists(select 1 from public.profile_shares s where s.profile_id=p_profile_id and s.recipient_id=u.user_id) as already_shared,
    (u.public_key is not null and u.private_key_ciphertext is not null and a.email_confirmed_at is not null) as can_receive
    from public.app_users u join auth.users a on a.id=u.user_id
    where u.status='active' and u.user_id<>auth.uid() and u.user_id<>profile_owner and u.email is not null
      and position(lower(trim(coalesce(p_search,''))) in lower(u.email))>0
    order by exists(select 1 from public.profile_shares s where s.profile_id=p_profile_id and s.recipient_id=u.user_id) asc,u.email asc,u.user_id asc offset p_offset limit p_limit;
end; $$;
revoke all on function public.td_list_share_recipients(uuid,text,integer,integer) from public,anon;
grant execute on function public.td_list_share_recipients(uuid,text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;

begin;

-- No profile FK: a deletion must survive removal of its source record.
create table if not exists public.td_profile_delete_requests (
  id uuid primary key default gen_random_uuid(),
  cloud_profile_id uuid,
  user_id uuid,
  device_id uuid,
  local_profile_id text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  applied_at timestamptz,
  storage_cleaned_at timestamptz,
  check ((cloud_profile_id is not null and device_id is null and local_profile_id is null)
    or (cloud_profile_id is null and user_id is not null and device_id is not null and local_profile_id is not null and local_profile_id ~ '^TD_[A-Za-z0-9_-]+$'))
);
create unique index if not exists td_profile_delete_cloud_idx on public.td_profile_delete_requests(cloud_profile_id) where cloud_profile_id is not null;
create unique index if not exists td_profile_delete_local_idx on public.td_profile_delete_requests(user_id,device_id,local_profile_id) where cloud_profile_id is null;
alter table public.td_profile_delete_requests enable row level security;
revoke all on table public.td_profile_delete_requests from public,anon,authenticated;

create or replace function public.td_admin_request_profile_delete(p_cloud_profile_id uuid default null,p_user_id uuid default null,p_device_id uuid default null,p_local_profile_id text default null)
returns uuid language plpgsql security definer set search_path=public
as $$
declare request_id uuid; owner_uuid uuid;
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  if p_cloud_profile_id is not null then
    if p_device_id is not null or p_local_profile_id is not null then raise exception 'invalid_delete_scope'; end if;
    select owner_id into owner_uuid from public.cloud_profiles where id=p_cloud_profile_id for update;
    if not found then
      select id into request_id from public.td_profile_delete_requests where cloud_profile_id=p_cloud_profile_id;
      if request_id is null then raise exception 'profile_not_found'; end if;
      return request_id;
    end if;
    if p_user_id is not null and p_user_id<>owner_uuid then raise exception 'profile_owner_changed'; end if;
    insert into public.td_profile_delete_requests(cloud_profile_id,user_id,requested_by)
      values(p_cloud_profile_id,owner_uuid,auth.uid())
      on conflict(cloud_profile_id) where cloud_profile_id is not null do update set cloud_profile_id=excluded.cloud_profile_id
      returning id into request_id;
    -- The durable instruction and source removal commit together. Other devices
    -- retain the instruction even after shares, envelopes and locks cascade away.
    delete from public.cloud_profiles where id=p_cloud_profile_id;
  else
    if p_user_id is null or p_device_id is null or p_local_profile_id is null
      or length(p_local_profile_id)>160 or p_local_profile_id !~ '^TD_[A-Za-z0-9_-]+$' then raise exception 'invalid_delete_scope'; end if;
    if not exists(select 1 from public.app_device_profile_catalog d cross join lateral jsonb_array_elements(d.profiles) p
      where d.user_id=p_user_id and d.device_id=p_device_id and p->>'local_id'=p_local_profile_id) then raise exception 'profile_not_in_device_catalog'; end if;
    insert into public.td_profile_delete_requests(user_id,device_id,local_profile_id,requested_by)
      values(p_user_id,p_device_id,p_local_profile_id,auth.uid())
      on conflict(user_id,device_id,local_profile_id) where cloud_profile_id is null do update set local_profile_id=excluded.local_profile_id
      returning id into request_id;
  end if;
  return request_id;
end;
$$;

create or replace function public.td_my_profile_delete_requests(p_device_id uuid,p_source_ids jsonb)
returns table(id uuid,cloud_profile_id uuid,local_profile_id text,requested_at timestamptz)
language plpgsql stable security definer set search_path=public
as $$
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  if p_device_id is null or p_source_ids is null or jsonb_typeof(p_source_ids)<>'array'
    or jsonb_array_length(p_source_ids)>20000 then raise exception 'invalid_delete_query'; end if;
  return query select r.id,r.cloud_profile_id,r.local_profile_id,r.requested_at from public.td_profile_delete_requests r
    where (r.cloud_profile_id is not null and r.cloud_profile_id::text in (select jsonb_array_elements_text(p_source_ids)))
      or (r.cloud_profile_id is null and r.user_id=auth.uid() and r.device_id=p_device_id and r.applied_at is null);
end;
$$;

create or replace function public.td_ack_profile_delete(p_request_id uuid,p_device_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  update public.td_profile_delete_requests set applied_at=coalesce(applied_at,now())
    where id=p_request_id and cloud_profile_id is null and user_id=auth.uid() and device_id=p_device_id;
end;
$$;

create or replace function public.td_admin_pending_profile_storage_cleanup()
returns table(id uuid,cloud_profile_id uuid) language plpgsql stable security definer set search_path=public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  return query select r.id,r.cloud_profile_id from public.td_profile_delete_requests r
    where r.cloud_profile_id is not null and r.storage_cleaned_at is null order by r.requested_at limit 25;
end;
$$;

create or replace function public.td_admin_ack_profile_storage_cleanup(p_request_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  update public.td_profile_delete_requests set storage_cleaned_at=coalesce(storage_cleaned_at,now()) where id=p_request_id and cloud_profile_id is not null;
end;
$$;

create or replace function public.td_profile_was_admin_deleted(p_profile_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.td_profile_delete_requests where cloud_profile_id=p_profile_id) $$;
-- Prevent an old Admin client from creating new chunks after source deletion.
-- Admin read/delete policies remain available for the durable cleanup worker.
drop policy if exists "td block deleted profile inserts" on storage.objects;
create policy "td block deleted profile inserts" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id<>'td-browser-profile-data' or not public.td_profile_was_admin_deleted(public.td_storage_profile_id(name)));
drop policy if exists "td block deleted profile updates" on storage.objects;
create policy "td block deleted profile updates" on storage.objects as restrictive for update to authenticated
  using (bucket_id<>'td-browser-profile-data' or not public.td_profile_was_admin_deleted(public.td_storage_profile_id(name)))
  with check (bucket_id<>'td-browser-profile-data' or not public.td_profile_was_admin_deleted(public.td_storage_profile_id(name)));

-- Stop new sharing through older clients as well as the current UI. Existing
-- grants are retained; this migration does not silently revoke access.
update public.app_settings set setting_value=jsonb_build_object('enabled',false) where setting_key='profile_sharing';
do $$ declare fn record; begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('td_share_cloud_profile','td_share_cloud_profile_v2','td_admin_set_user_sharing')
  loop execute format('revoke all on function %s from public,anon,authenticated',fn.signature); end loop;
end $$;

revoke all on function public.td_admin_request_profile_delete(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.td_my_profile_delete_requests(uuid,jsonb) from public,anon;
revoke all on function public.td_ack_profile_delete(uuid,uuid) from public,anon;
revoke all on function public.td_admin_pending_profile_storage_cleanup() from public,anon;
revoke all on function public.td_admin_ack_profile_storage_cleanup(uuid) from public,anon;
revoke all on function public.td_profile_was_admin_deleted(uuid) from public,anon;
grant execute on function public.td_admin_request_profile_delete(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.td_my_profile_delete_requests(uuid,jsonb) to authenticated;
grant execute on function public.td_ack_profile_delete(uuid,uuid) to authenticated;
grant execute on function public.td_admin_pending_profile_storage_cleanup() to authenticated;
grant execute on function public.td_admin_ack_profile_storage_cleanup(uuid) to authenticated;
grant execute on function public.td_profile_was_admin_deleted(uuid) to authenticated;

create or replace function public.td_sync_device_profile_catalog(p_device_id uuid,p_app_version text,p_profiles jsonb)
returns timestamptz language plpgsql security definer set search_path=public
as $$
declare clean jsonb; seen_at timestamptz:=clock_timestamp();
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  if p_device_id is null or length(coalesce(p_app_version,''))>40 then raise exception 'invalid_device'; end if;
  if p_profiles is null or jsonb_typeof(p_profiles)<>'array' then raise exception 'invalid_catalog'; end if;
  if jsonb_array_length(p_profiles)>10000 or octet_length(p_profiles::text)>5000000 then raise exception 'catalog_too_large'; end if;
  if exists(select 1 from jsonb_array_elements(p_profiles) p where jsonb_typeof(p)<>'object' or coalesce(p->>'local_id','')='' or length(p->>'local_id')>160) then raise exception 'invalid_catalog_profile'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'local_id',left(p->>'local_id',160),
    'cloud_id',case when p->>'cloud_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p->>'cloud_id' else null end,
    'name',left(coalesce(p->>'name','Hồ sơ mới'),120),
    'running',coalesce(p->>'running','false')='true',
    'admin_deleted',coalesce(p->>'admin_deleted','false')='true',
    'revision',case when p->>'revision' ~ '^[0-9]{1,9}$' then (p->>'revision')::integer else 0 end
  )),'[]'::jsonb) into clean from jsonb_array_elements(p_profiles) p;
  insert into public.app_device_profile_catalog(user_id,device_id,app_version,profiles,last_seen,connected)
  values(auth.uid(),p_device_id,left(p_app_version,40),clean,seen_at,true)
  on conflict(user_id,device_id) do update set app_version=excluded.app_version,profiles=excluded.profiles,last_seen=excluded.last_seen,connected=true;
  return seen_at;
end;
$$;


commit;

