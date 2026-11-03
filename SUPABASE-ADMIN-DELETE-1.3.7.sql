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
