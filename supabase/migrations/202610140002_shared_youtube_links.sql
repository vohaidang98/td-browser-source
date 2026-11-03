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
