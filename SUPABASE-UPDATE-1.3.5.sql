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

