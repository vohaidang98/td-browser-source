begin;

create table if not exists public.app_device_profile_catalog (
  user_id uuid not null references public.app_users(user_id) on delete cascade,
  device_id uuid not null,
  app_version text not null,
  profiles jsonb not null default '[]'::jsonb check (jsonb_typeof(profiles)='array'),
  last_seen timestamptz not null default now(),
  connected boolean not null default true,
  primary key(user_id,device_id)
);
create index if not exists app_device_profile_catalog_seen_idx on public.app_device_profile_catalog(user_id,last_seen desc);
alter table public.app_device_profile_catalog enable row level security;
revoke all on table public.app_device_profile_catalog from public, anon, authenticated;

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
    'revision',case when p->>'revision' ~ '^[0-9]{1,9}$' then (p->>'revision')::integer else 0 end
  )),'[]'::jsonb) into clean from jsonb_array_elements(p_profiles) p;
  insert into public.app_device_profile_catalog(user_id,device_id,app_version,profiles,last_seen,connected)
  values(auth.uid(),p_device_id,left(p_app_version,40),clean,seen_at,true)
  on conflict(user_id,device_id) do update set app_version=excluded.app_version,profiles=excluded.profiles,last_seen=excluded.last_seen,connected=true;
  return seen_at;
end;
$$;

create or replace function public.td_disconnect_device_profile_catalog(p_device_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.app_device_profile_catalog set connected=false where user_id=auth.uid() and device_id=p_device_id;
end;
$$;

create or replace function public.td_admin_profile_catalog_status()
returns table(user_id uuid,last_seen timestamptz,profile_count bigint,device_count bigint,online_devices bigint,app_version text,server_time timestamptz)
language plpgsql stable security definer set search_path=public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  return query select u.user_id,
    (select max(d.last_seen) from public.app_device_profile_catalog d where d.user_id=u.user_id),
    (select count(distinct coalesce(p->>'cloud_id',d.device_id::text||':'||(p->>'local_id')))
      from public.app_device_profile_catalog d cross join lateral jsonb_array_elements(d.profiles) p where d.user_id=u.user_id),
    (select count(*) from public.app_device_profile_catalog d where d.user_id=u.user_id),
    (select count(*) from public.app_device_profile_catalog d where d.user_id=u.user_id and d.connected and d.last_seen>now()-interval '90 seconds'),
    (select d.app_version from public.app_device_profile_catalog d where d.user_id=u.user_id order by d.last_seen desc limit 1),now()
    from public.app_users u;
end;
$$;

create or replace function public.td_admin_user_profile_catalog(p_user_id uuid)
returns table(device_id uuid,last_seen timestamptz,app_version text,profiles jsonb,connected boolean,server_time timestamptz)
language plpgsql stable security definer set search_path=public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  return query select d.device_id,d.last_seen,d.app_version,d.profiles,d.connected,now()
    from public.app_device_profile_catalog d where d.user_id=p_user_id order by d.last_seen desc;
end;
$$;

revoke all on function public.td_sync_device_profile_catalog(uuid,text,jsonb) from public,anon;
revoke all on function public.td_disconnect_device_profile_catalog(uuid) from public,anon;
revoke all on function public.td_admin_profile_catalog_status() from public,anon;
revoke all on function public.td_admin_user_profile_catalog(uuid) from public,anon;
grant execute on function public.td_sync_device_profile_catalog(uuid,text,jsonb) to authenticated;
grant execute on function public.td_disconnect_device_profile_catalog(uuid) to authenticated;
grant execute on function public.td_admin_profile_catalog_status() to authenticated;
grant execute on function public.td_admin_user_profile_catalog(uuid) to authenticated;

commit;
