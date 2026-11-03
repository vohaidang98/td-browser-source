-- TD Browser account and encrypted profile storage schema.
-- Run in the Supabase SQL editor for the project already configured in the app.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  public_key text,
  private_key_ciphertext text,
  private_key_salt text,
  private_key_iv text,
  private_key_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(setting_key, setting_value)
values ('profile_sharing', '{"enabled":false}'::jsonb)
on conflict (setting_key) do nothing;

create table if not exists public.cloud_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete cascade,
  created_by uuid not null references public.app_users(user_id),
  profile_name text not null,
  revision integer not null default 0 check (revision >= 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  cipher_sha256 text,
  cipher_size bigint not null default 0 check (cipher_size >= 0),
  cipher_iv text,
  cipher_tag text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cloud_profiles_owner_idx on public.cloud_profiles(owner_id, updated_at desc);

create table if not exists public.profile_key_envelopes (
  profile_id uuid not null references public.cloud_profiles(id) on delete cascade,
  user_id uuid not null references public.app_users(user_id) on delete cascade,
  encrypted_key text not null,
  updated_at timestamptz not null default now(),
  primary key(profile_id, user_id)
);

create table if not exists public.profile_shares (
  profile_id uuid not null references public.cloud_profiles(id) on delete cascade,
  recipient_id uuid not null references public.app_users(user_id) on delete cascade,
  granted_by uuid not null references public.app_users(user_id),
  created_at timestamptz not null default now(),
  primary key(profile_id, recipient_id)
);

create table if not exists public.profile_locks (
  profile_id uuid primary key references public.cloud_profiles(id) on delete cascade,
  user_id uuid not null references public.app_users(user_id) on delete cascade,
  client_token text not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.profile_locks add column if not exists client_token text;
update public.profile_locks set client_token='legacy-' || user_id::text where client_token is null;
alter table public.profile_locks alter column client_token set not null;

create or replace function public.td_bootstrap_user()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
begin
  insert into public.app_users(user_id, email, public_key, private_key_ciphertext, private_key_salt, private_key_iv, private_key_tag)
  values (
    new.id,
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'td_public_key',
    new.raw_user_meta_data ->> 'td_private_key_ciphertext',
    new.raw_user_meta_data ->> 'td_private_key_salt',
    new.raw_user_meta_data ->> 'td_private_key_iv',
    new.raw_user_meta_data ->> 'td_private_key_tag'
  )
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists td_auth_user_created on auth.users;
create trigger td_auth_user_created after insert on auth.users
for each row execute function public.td_bootstrap_user();

-- Backfill accounts that already existed before this migration.
insert into public.app_users(user_id, email, public_key, private_key_ciphertext, private_key_salt, private_key_iv, private_key_tag)
select id, coalesce(email, ''), raw_user_meta_data ->> 'td_public_key',
  raw_user_meta_data ->> 'td_private_key_ciphertext', raw_user_meta_data ->> 'td_private_key_salt',
  raw_user_meta_data ->> 'td_private_key_iv', raw_user_meta_data ->> 'td_private_key_tag'
from auth.users
on conflict(user_id) do update set email=excluded.email;

create or replace function public.td_is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.app_users u where u.user_id = auth.uid() and u.role = 'admin' and u.status = 'active') $$;

create or replace function public.td_is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.app_users u where u.user_id = auth.uid() and u.status = 'active') $$;

create or replace function public.td_can_access_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.td_is_active_user() and (
    public.td_is_admin()
    or exists(select 1 from public.cloud_profiles p where p.id = p_profile_id and p.owner_id = auth.uid() and p.status = 'active')
    or exists(select 1 from public.profile_shares s join public.cloud_profiles p on p.id = s.profile_id where s.profile_id = p_profile_id and s.recipient_id = auth.uid() and p.status = 'active')
  )
$$;

alter table public.app_users enable row level security;
alter table public.app_settings enable row level security;
alter table public.cloud_profiles enable row level security;
alter table public.profile_key_envelopes enable row level security;
alter table public.profile_shares enable row level security;
alter table public.profile_locks enable row level security;

drop policy if exists "app users self or admin read" on public.app_users;
create policy "app users self or admin read" on public.app_users for select to authenticated
using (user_id = auth.uid() or public.td_is_admin());
drop policy if exists "active users read settings" on public.app_settings;
create policy "active users read settings" on public.app_settings for select to authenticated
using (public.td_is_active_user());
drop policy if exists "profile access read" on public.cloud_profiles;
create policy "profile access read" on public.cloud_profiles for select to authenticated
using (public.td_can_access_profile(id));
drop policy if exists "profile access envelope read" on public.profile_key_envelopes;
create policy "profile access envelope read" on public.profile_key_envelopes for select to authenticated
using (user_id = auth.uid() or public.td_is_admin());
drop policy if exists "profile access share read" on public.profile_shares;
create policy "profile access share read" on public.profile_shares for select to authenticated
using (recipient_id = auth.uid() or public.td_is_admin() or exists(select 1 from public.cloud_profiles p where p.id = profile_id and p.owner_id = auth.uid()));
drop policy if exists "profile lock access read" on public.profile_locks;
create policy "profile lock access read" on public.profile_locks for select to authenticated
using (public.td_can_access_profile(profile_id));

create or replace function public.td_admin_list_users()
returns table(user_id uuid, email text, role text, status text, created_at timestamptz, has_recovery_key boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  return query select u.user_id, u.email, u.role, u.status, u.created_at, (u.public_key is not null and u.private_key_ciphertext is not null)
  from public.app_users u order by u.created_at desc;
end;
$$;

create or replace function public.td_admin_set_user(p_user_id uuid, p_role text, p_status text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  if p_role not in ('user','admin') or p_status not in ('active','disabled') then raise exception 'invalid_user_state'; end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or p_status <> 'active') then raise exception 'cannot_disable_current_admin'; end if;
  update public.app_users set role = p_role, status = p_status, updated_at = now() where user_id = p_user_id;
  if not found then raise exception 'user_not_found'; end if;
end;
$$;

create or replace function public.td_admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  return (select setting_value from public.app_settings where setting_key = 'profile_sharing');
end;
$$;

create or replace function public.td_admin_set_user_sharing(p_enabled boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  update public.app_settings set setting_value = jsonb_build_object('enabled', p_enabled), updated_at = now() where setting_key = 'profile_sharing';
end;
$$;

create or replace function public.td_admin_public_keys()
returns table(user_id uuid, email text, public_key text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  return query select u.user_id, u.email, u.public_key from public.app_users u where u.role = 'admin' and u.status = 'active' and u.public_key is not null;
end;
$$;

create or replace function public.td_lookup_profile_recipient(p_email text)
returns table(user_id uuid, email text, public_key text)
language plpgsql stable security definer set search_path = public
as $$
declare sharing_enabled boolean;
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  select coalesce((setting_value ->> 'enabled')::boolean, false) into sharing_enabled from public.app_settings where setting_key = 'profile_sharing';
  if not public.td_is_admin() and not sharing_enabled then raise exception 'user_sharing_disabled'; end if;
  return query select u.user_id, u.email, u.public_key from public.app_users u
    where lower(u.email) = lower(trim(p_email)) and u.status = 'active' and u.public_key is not null;
end;
$$;

create or replace function public.td_create_cloud_profile(
  p_owner_id uuid, p_profile_name text, p_cipher_iv text, p_cipher_tag text,
  p_envelopes jsonb default '[]'::jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid; envelope jsonb;
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  if not public.td_is_admin() and p_owner_id <> auth.uid() then raise exception 'admin_required'; end if;
  if not exists(select 1 from public.app_users where user_id = p_owner_id and status = 'active') then raise exception 'owner_not_active'; end if;
  if length(trim(coalesce(p_profile_name,''))) < 1 or length(p_profile_name) > 120 then raise exception 'invalid_profile_name'; end if;
  insert into public.cloud_profiles(owner_id, created_by, profile_name, revision, cipher_iv, cipher_tag)
  values(p_owner_id, auth.uid(), trim(p_profile_name), 0, p_cipher_iv, p_cipher_tag) returning id into new_id;
  for envelope in select * from jsonb_array_elements(coalesce(p_envelopes, '[]'::jsonb)) loop
    if not public.td_is_admin() and (envelope->>'user_id')::uuid <> auth.uid() and not exists(select 1 from public.app_users where user_id = (envelope->>'user_id')::uuid and role = 'admin' and status = 'active') then
      raise exception 'invalid_envelope_recipient';
    end if;
    insert into public.profile_key_envelopes(profile_id,user_id,encrypted_key)
    values(new_id,(envelope->>'user_id')::uuid,envelope->>'encrypted_key');
  end loop;
  if not exists(select 1 from public.profile_key_envelopes where profile_id = new_id and user_id = p_owner_id) then raise exception 'owner_key_envelope_required'; end if;
  if exists(select 1 from public.app_users u where u.role='admin' and u.status='active' and (u.public_key is null or not exists(
    select 1 from public.profile_key_envelopes e where e.profile_id=new_id and e.user_id=u.user_id
  ))) then raise exception 'admin_key_envelope_required'; end if;
  return new_id;
end;
$$;

create or replace function public.td_publish_cloud_profile(
  p_profile_id uuid, p_revision integer, p_chunk_count integer, p_sha256 text, p_cipher_size bigint,
  p_cipher_iv text, p_cipher_tag text, p_admin_envelopes jsonb default '[]'::jsonb
)
returns void language plpgsql security definer set search_path = public
as $$
declare owner_uuid uuid; envelope jsonb;
begin
  if not public.td_can_access_profile(p_profile_id) then raise exception 'profile_access_denied'; end if;
  select owner_id into owner_uuid from public.cloud_profiles where id = p_profile_id for update;
  if owner_uuid <> auth.uid() and not public.td_is_admin()
    and not exists(select 1 from public.profile_shares where profile_id=p_profile_id and recipient_id=auth.uid()) then
    raise exception 'owner_or_admin_required';
  end if;
  if p_revision < 1 or p_chunk_count < 1 or p_cipher_size < 1 or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid_manifest'; end if;
  update public.cloud_profiles set revision=p_revision, chunk_count=p_chunk_count, cipher_sha256=p_sha256,
    cipher_size=p_cipher_size, cipher_iv=p_cipher_iv, cipher_tag=p_cipher_tag, updated_at=now() where id=p_profile_id;
  for envelope in select * from jsonb_array_elements(coalesce(p_admin_envelopes,'[]'::jsonb)) loop
    if not public.td_is_admin() and not exists(select 1 from public.app_users where user_id=(envelope->>'user_id')::uuid and role='admin' and status='active') then raise exception 'admin_envelope_required'; end if;
    insert into public.profile_key_envelopes(profile_id,user_id,encrypted_key)
    values(p_profile_id,(envelope->>'user_id')::uuid,envelope->>'encrypted_key')
    on conflict(profile_id,user_id) do update set encrypted_key=excluded.encrypted_key, updated_at=now();
  end loop;
  if exists(select 1 from public.app_users u where u.role='admin' and u.status='active' and (u.public_key is null or not exists(
    select 1 from public.profile_key_envelopes e where e.profile_id=p_profile_id and e.user_id=u.user_id
  ))) then raise exception 'admin_key_envelope_required'; end if;
end;
$$;

create or replace function public.td_share_cloud_profile(p_profile_id uuid, p_recipient_email text, p_encrypted_key text)
returns void language plpgsql security definer set search_path = public
as $$
declare p_owner uuid; recipient uuid; sharing_enabled boolean;
begin
  if not public.td_can_access_profile(p_profile_id) then raise exception 'profile_access_denied'; end if;
  select owner_id into p_owner from public.cloud_profiles where id=p_profile_id;
  select coalesce((setting_value->>'enabled')::boolean,false) into sharing_enabled from public.app_settings where setting_key='profile_sharing';
  if not public.td_is_admin() and (p_owner <> auth.uid() or not sharing_enabled) then raise exception 'user_sharing_disabled'; end if;
  select u.user_id into recipient from public.app_users u where lower(u.email)=lower(trim(p_recipient_email)) and u.status='active' and u.public_key is not null;
  if recipient is null then raise exception 'recipient_not_found'; end if;
  if recipient = p_owner then raise exception 'cannot_share_to_owner'; end if;
  insert into public.profile_key_envelopes(profile_id,user_id,encrypted_key) values(p_profile_id,recipient,p_encrypted_key)
    on conflict(profile_id,user_id) do update set encrypted_key=excluded.encrypted_key,updated_at=now();
  insert into public.profile_shares(profile_id,recipient_id,granted_by) values(p_profile_id,recipient,auth.uid())
    on conflict(profile_id,recipient_id) do update set granted_by=excluded.granted_by;
end;
$$;

create or replace function public.td_list_cloud_profiles()
returns table(id uuid, owner_id uuid, owner_email text, profile_name text, revision integer, chunk_count integer,
  cipher_sha256 text, cipher_size bigint, cipher_iv text, cipher_tag text, status text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  return query select p.id,p.owner_id,u.email,p.profile_name,p.revision,p.chunk_count,p.cipher_sha256,p.cipher_size,
    p.cipher_iv,p.cipher_tag,p.status,p.created_at,p.updated_at
    from public.cloud_profiles p join public.app_users u on u.user_id=p.owner_id
    where public.td_is_admin() or p.owner_id=auth.uid() or exists(select 1 from public.profile_shares s where s.profile_id=p.id and s.recipient_id=auth.uid())
    order by p.updated_at desc;
end;
$$;

create or replace function public.td_admin_transfer_profile(p_profile_id uuid, p_owner_id uuid, p_owner_envelope text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  if not exists(select 1 from public.app_users where user_id=p_owner_id and status='active') then raise exception 'owner_not_active'; end if;
  if exists(select 1 from public.profile_locks where profile_id=p_profile_id and lease_until>now()) then raise exception 'profile_locked'; end if;
  update public.cloud_profiles set owner_id=p_owner_id, updated_at=now() where id=p_profile_id;
  if not found then raise exception 'profile_not_found'; end if;
  delete from public.profile_shares where profile_id=p_profile_id;
  delete from public.profile_key_envelopes e where e.profile_id=p_profile_id and e.user_id<>p_owner_id
    and not exists(select 1 from public.app_users u where u.user_id=e.user_id and u.role='admin' and u.status='active');
  insert into public.profile_key_envelopes(profile_id,user_id,encrypted_key) values(p_profile_id,p_owner_id,p_owner_envelope)
    on conflict(profile_id,user_id) do update set encrypted_key=excluded.encrypted_key,updated_at=now();
end;
$$;

create or replace function public.td_admin_rename_profile(p_profile_id uuid, p_profile_name text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  if length(trim(coalesce(p_profile_name,''))) < 1 or length(p_profile_name)>120 then raise exception 'invalid_profile_name'; end if;
  update public.cloud_profiles set profile_name=trim(p_profile_name),updated_at=now() where id=p_profile_id;
  if not found then raise exception 'profile_not_found'; end if;
end;
$$;

create or replace function public.td_rename_cloud_profile(p_profile_id uuid, p_profile_name text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  if not public.td_is_admin() and not exists(select 1 from public.cloud_profiles where id=p_profile_id and owner_id=auth.uid()) then raise exception 'owner_or_admin_required'; end if;
  if length(trim(coalesce(p_profile_name,''))) < 1 or length(p_profile_name)>120 then raise exception 'invalid_profile_name'; end if;
  update public.cloud_profiles set profile_name=trim(p_profile_name),updated_at=now() where id=p_profile_id;
  if not found then raise exception 'profile_not_found'; end if;
end;
$$;

drop function if exists public.td_delete_cloud_profile(uuid);
create or replace function public.td_delete_cloud_profile(p_profile_id uuid, p_client_token text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.td_can_access_profile(p_profile_id) then raise exception 'profile_access_denied'; end if;
  if not public.td_is_admin() and not exists(select 1 from public.cloud_profiles where id=p_profile_id and owner_id=auth.uid()) then raise exception 'owner_or_admin_required'; end if;
  if exists(select 1 from public.profile_locks where profile_id=p_profile_id and lease_until > now() and (user_id <> auth.uid() or client_token <> p_client_token)) then raise exception 'profile_locked'; end if;
  delete from public.cloud_profiles where id=p_profile_id;
end;
$$;

drop function if exists public.td_claim_profile_lock(uuid);
create or replace function public.td_claim_profile_lock(p_profile_id uuid, p_client_token text)
returns timestamptz language plpgsql security definer set search_path = public
as $$
declare current_user_id uuid; current_lease timestamptz; new_lease timestamptz := now()+interval '2 hours';
begin
  if not public.td_can_access_profile(p_profile_id) then raise exception 'profile_access_denied'; end if;
  if p_client_token is null or length(p_client_token)>100 then raise exception 'invalid_client_token'; end if;
  insert into public.profile_locks(profile_id,user_id,client_token,lease_until) values(p_profile_id,auth.uid(),p_client_token,new_lease)
  on conflict(profile_id) do update set user_id=excluded.user_id,client_token=excluded.client_token,lease_until=excluded.lease_until,updated_at=now()
    where public.profile_locks.lease_until < now() or (public.profile_locks.user_id=auth.uid() and public.profile_locks.client_token=p_client_token);
  if not found then
    select user_id,lease_until into current_user_id,current_lease from public.profile_locks where profile_id=p_profile_id;
    raise exception 'profile_locked:%:%',current_user_id,current_lease;
  end if;
  return new_lease;
end;
$$;

drop function if exists public.td_renew_profile_lock(uuid);
create or replace function public.td_renew_profile_lock(p_profile_id uuid, p_client_token text)
returns timestamptz language plpgsql security definer set search_path = public
as $$
declare new_lease timestamptz := now()+interval '2 hours';
begin
  update public.profile_locks set lease_until=new_lease,updated_at=now() where profile_id=p_profile_id and user_id=auth.uid() and client_token=p_client_token;
  if not found then raise exception 'profile_lock_not_owned'; end if;
  return new_lease;
end;
$$;

drop function if exists public.td_release_profile_lock(uuid);
create or replace function public.td_release_profile_lock(p_profile_id uuid, p_client_token text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  delete from public.profile_locks where profile_id=p_profile_id and user_id=auth.uid() and client_token=p_client_token;
end;
$$;

create or replace function public.td_my_key_envelope(p_profile_id uuid)
returns text language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.td_can_access_profile(p_profile_id) then raise exception 'profile_access_denied'; end if;
  return (select encrypted_key from public.profile_key_envelopes where profile_id=p_profile_id and user_id=auth.uid());
end;
$$;

create or replace function public.td_profile_key_for_user(p_profile_id uuid, p_user_id uuid)
returns text language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.td_can_access_profile(p_profile_id) then raise exception 'profile_access_denied'; end if;
  if not public.td_is_admin() and not exists(select 1 from public.cloud_profiles where id=p_profile_id and owner_id=auth.uid()) then raise exception 'owner_or_admin_required'; end if;
  return (select encrypted_key from public.profile_key_envelopes where profile_id=p_profile_id and user_id=p_user_id);
end;
$$;

create or replace function public.td_update_admin_key_envelopes(p_profile_id uuid, p_envelopes jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare envelope jsonb;
begin
  if not public.td_is_admin() or not public.td_can_access_profile(p_profile_id) then raise exception 'admin_required'; end if;
  for envelope in select * from jsonb_array_elements(coalesce(p_envelopes,'[]'::jsonb)) loop
    if not exists(select 1 from public.app_users where user_id=(envelope->>'user_id')::uuid and role='admin' and status='active') then raise exception 'admin_envelope_required'; end if;
    insert into public.profile_key_envelopes(profile_id,user_id,encrypted_key)
    values(p_profile_id,(envelope->>'user_id')::uuid,envelope->>'encrypted_key')
    on conflict(profile_id,user_id) do update set encrypted_key=excluded.encrypted_key,updated_at=now();
  end loop;
  if exists(select 1 from public.app_users u where u.role='admin' and u.status='active' and not exists(
    select 1 from public.profile_key_envelopes e where e.profile_id=p_profile_id and e.user_id=u.user_id
  )) then raise exception 'admin_key_envelope_required'; end if;
end;
$$;

create or replace function public.td_storage_profile_id(p_name text)
returns uuid language plpgsql immutable
as $$ begin return split_part(p_name,'/',1)::uuid; exception when others then return null; end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('td-browser-profile-data','td-browser-profile-data',false,52428800,array['application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=52428800;

drop policy if exists "td profile chunks read" on storage.objects;
create policy "td profile chunks read" on storage.objects for select to authenticated
using (bucket_id='td-browser-profile-data' and public.td_can_access_profile(public.td_storage_profile_id(name)));
drop policy if exists "td profile chunks insert" on storage.objects;
create policy "td profile chunks insert" on storage.objects for insert to authenticated
with check (bucket_id='td-browser-profile-data' and public.td_can_access_profile(public.td_storage_profile_id(name)));
drop policy if exists "td profile chunks update" on storage.objects;
create policy "td profile chunks update" on storage.objects for update to authenticated
using (bucket_id='td-browser-profile-data' and public.td_can_access_profile(public.td_storage_profile_id(name)))
with check (bucket_id='td-browser-profile-data' and public.td_can_access_profile(public.td_storage_profile_id(name)));
drop policy if exists "td profile chunks delete" on storage.objects;
create policy "td profile chunks delete" on storage.objects for delete to authenticated
using (bucket_id='td-browser-profile-data' and public.td_can_access_profile(public.td_storage_profile_id(name)));

grant execute on function public.td_is_admin() to authenticated;
grant execute on function public.td_is_active_user() to authenticated;
grant execute on function public.td_can_access_profile(uuid) to authenticated;
grant execute on function public.td_admin_list_users() to authenticated;
grant execute on function public.td_admin_set_user(uuid,text,text) to authenticated;
grant execute on function public.td_admin_get_settings() to authenticated;
grant execute on function public.td_admin_set_user_sharing(boolean) to authenticated;
grant execute on function public.td_admin_public_keys() to authenticated;
grant execute on function public.td_lookup_profile_recipient(text) to authenticated;
grant execute on function public.td_create_cloud_profile(uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.td_publish_cloud_profile(uuid,integer,integer,text,bigint,text,text,jsonb) to authenticated;
grant execute on function public.td_share_cloud_profile(uuid,text,text) to authenticated;
grant execute on function public.td_list_cloud_profiles() to authenticated;
grant execute on function public.td_admin_transfer_profile(uuid,uuid,text) to authenticated;
grant execute on function public.td_admin_rename_profile(uuid,text) to authenticated;
grant execute on function public.td_rename_cloud_profile(uuid,text) to authenticated;
grant execute on function public.td_delete_cloud_profile(uuid,text) to authenticated;
grant execute on function public.td_claim_profile_lock(uuid,text) to authenticated;
grant execute on function public.td_renew_profile_lock(uuid,text) to authenticated;
grant execute on function public.td_release_profile_lock(uuid,text) to authenticated;
grant execute on function public.td_my_key_envelope(uuid) to authenticated;
grant execute on function public.td_profile_key_for_user(uuid,uuid) to authenticated;
grant execute on function public.td_update_admin_key_envelopes(uuid,jsonb) to authenticated;
grant execute on function public.td_storage_profile_id(text) to authenticated;

revoke all on function public.td_bootstrap_user() from public, anon, authenticated;
revoke all on function public.td_is_admin() from public, anon;
revoke all on function public.td_is_active_user() from public, anon;
revoke all on function public.td_can_access_profile(uuid) from public, anon;
revoke all on function public.td_admin_list_users() from public, anon;
revoke all on function public.td_admin_set_user(uuid,text,text) from public, anon;
revoke all on function public.td_admin_get_settings() from public, anon;
revoke all on function public.td_admin_set_user_sharing(boolean) from public, anon;
revoke all on function public.td_admin_public_keys() from public, anon;
revoke all on function public.td_lookup_profile_recipient(text) from public, anon;
revoke all on function public.td_create_cloud_profile(uuid,text,text,text,jsonb) from public, anon;
revoke all on function public.td_publish_cloud_profile(uuid,integer,integer,text,bigint,text,text,jsonb) from public, anon;
revoke all on function public.td_share_cloud_profile(uuid,text,text) from public, anon;
revoke all on function public.td_list_cloud_profiles() from public, anon;
revoke all on function public.td_admin_transfer_profile(uuid,uuid,text) from public, anon;
revoke all on function public.td_admin_rename_profile(uuid,text) from public, anon;
revoke all on function public.td_rename_cloud_profile(uuid,text) from public, anon;
revoke all on function public.td_delete_cloud_profile(uuid,text) from public, anon;
revoke all on function public.td_claim_profile_lock(uuid,text) from public, anon;
revoke all on function public.td_renew_profile_lock(uuid,text) from public, anon;
revoke all on function public.td_release_profile_lock(uuid,text) from public, anon;
revoke all on function public.td_my_key_envelope(uuid) from public, anon;
revoke all on function public.td_profile_key_for_user(uuid,uuid) from public, anon;
revoke all on function public.td_update_admin_key_envelopes(uuid,jsonb) from public, anon;
revoke all on function public.td_storage_profile_id(text) from public, anon;

revoke all on table public.app_users, public.app_settings, public.cloud_profiles,
  public.profile_key_envelopes, public.profile_shares, public.profile_locks from anon, authenticated;
grant select on table public.app_users, public.app_settings, public.cloud_profiles,
  public.profile_key_envelopes, public.profile_shares, public.profile_locks to authenticated;

-- Bootstrap only the initial account as administrator after registering it:
-- update public.app_users set role='admin' where lower(email)=lower('owner@example.com');
