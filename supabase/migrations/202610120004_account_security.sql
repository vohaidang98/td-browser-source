begin;

alter table public.app_users add column if not exists recovery_requested_at timestamptz;

-- Called before any Auth password update: fail before changing a password if
-- this migration is absent. No secret or service-role key is shipped in the app.
create or replace function public.td_account_security_ready(p_rotating boolean default false)
returns boolean language plpgsql stable security definer set search_path=public
as $$ begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  if p_rotating then
    if exists(select 1 from public.profile_locks l where l.lease_until>now() and (l.user_id=auth.uid()
      or exists(select 1 from public.cloud_profiles p where p.id=l.profile_id and p.owner_id=auth.uid()))) then
      raise exception 'Đóng hồ sơ trên tất cả thiết bị rồi đặt lại mật khẩu.';
    end if;
    if public.td_is_admin() and exists(select 1 from public.profile_key_envelopes own where own.user_id=auth.uid()
      and not exists(select 1 from public.profile_key_envelopes backup join public.app_users u on u.user_id=backup.user_id
        where backup.profile_id=own.profile_id and backup.user_id<>auth.uid() and u.role='admin' and u.status='active')) then
      raise exception 'Admin đang giữ khóa duy nhất. Dùng máy còn lưu đăng nhập hoặc nhờ admin dự phòng trước khi khôi phục.';
    end if;
  end if;
  return true;
end $$;

-- Supabase Auth updates password + encrypted key metadata together. This trigger
-- runs in that database transaction; a failed key update rolls back the update.
create or replace function public.td_sync_account_key_update()
returns trigger language plpgsql security definer set search_path=public,auth
as $$
declare previous public.app_users%rowtype; m jsonb; rotated boolean;
begin
  m := new.raw_user_meta_data;
  if coalesce(m->>'td_key_operation_id','') = coalesce(old.raw_user_meta_data->>'td_key_operation_id','') then return new; end if;
  select * into previous from public.app_users where user_id=new.id for update;
  if not found or previous.status<>'active' then raise exception 'active_user_required'; end if;
  if (m->>'td_key_expected_public') is distinct from previous.public_key
    or (m->>'td_key_expected_ciphertext') is distinct from previous.private_key_ciphertext then
    raise exception 'Khóa tài khoản đã thay đổi. Hãy đăng nhập lại và thử lại.';
  end if;
  if coalesce(length(m->>'td_public_key'),0) not between 400 and 2000
    or coalesce(length(m->>'td_private_key_ciphertext'),0) not between 1000 and 12000
    or coalesce(length(m->>'td_private_key_salt'),0)<>24
    or coalesce(length(m->>'td_private_key_iv'),0)<>16
    or coalesce(length(m->>'td_private_key_tag'),0)<>24 then raise exception 'invalid_key_metadata'; end if;
  rotated := previous.public_key is distinct from (m->>'td_public_key');
  if rotated then
    if exists(select 1 from public.profile_locks l where l.lease_until>now()
      and (l.user_id=new.id or exists(select 1 from public.cloud_profiles p where p.id=l.profile_id and p.owner_id=new.id))) then
      raise exception 'Đóng hồ sơ trên các thiết bị rồi thử đặt lại mật khẩu.';
    end if;
    -- Protect the sole admin's only decrypting key from accidental destruction.
    if previous.role='admin' and exists(
      select 1 from public.profile_key_envelopes own where own.user_id=new.id and not exists(
        select 1 from public.profile_key_envelopes backup join public.app_users u on u.user_id=backup.user_id
        where backup.profile_id=own.profile_id and backup.user_id<>new.id and u.role='admin' and u.status='active'
      )
    ) then raise exception 'Admin này đang giữ khóa duy nhất của một số hồ sơ. Cần khóa đã lưu trên máy hoặc admin dự phòng trước khi khôi phục.'; end if;
    delete from public.profile_key_envelopes where user_id=new.id;
  end if;
  update public.app_users set public_key=m->>'td_public_key', private_key_ciphertext=m->>'td_private_key_ciphertext',
    private_key_salt=m->>'td_private_key_salt',private_key_iv=m->>'td_private_key_iv',private_key_tag=m->>'td_private_key_tag',
    recovery_requested_at=case when rotated then now() else recovery_requested_at end,updated_at=now()
    where user_id=new.id;
  new.raw_user_meta_data := new.raw_user_meta_data - 'td_key_expected_public' - 'td_key_expected_ciphertext';
  return new;
end $$;
drop trigger if exists td_auth_key_updated on auth.users;
create trigger td_auth_key_updated before update of raw_user_meta_data on auth.users
for each row execute function public.td_sync_account_key_update();

create or replace function public.td_admin_recovery_candidates(p_user_id uuid)
returns table(profile_id uuid,profile_name text,public_key text,admin_envelope text)
language plpgsql stable security definer set search_path=public
as $$ begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  if not exists(select 1 from public.app_users where user_id=p_user_id and status='active') then raise exception 'recipient_not_active'; end if;
  return query select p.id,p.profile_name,u.public_key,e.encrypted_key
    from public.cloud_profiles p cross join public.app_users u
    left join public.profile_key_envelopes e on e.profile_id=p.id and e.user_id=auth.uid()
    where u.user_id=p_user_id and p.status='active' and (
      p.owner_id=p_user_id or u.role='admin' or exists(select 1 from public.profile_shares s where s.profile_id=p.id and s.recipient_id=p_user_id)
    ) order by p.profile_name;
end $$;

create or replace function public.td_admin_restore_profile_key(p_user_id uuid,p_profile_id uuid,p_expected_public_key text,p_encrypted_key text,p_expected_admin_envelope text)
returns void language plpgsql security definer set search_path=public
as $$
declare recipient public.app_users%rowtype; profile public.cloud_profiles%rowtype;
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  select * into recipient from public.app_users where user_id=p_user_id for update;
  if not found or recipient.status<>'active' then raise exception 'recipient_not_active'; end if;
  if recipient.public_key is distinct from p_expected_public_key then raise exception 'recipient_key_changed_retry'; end if;
  select * into profile from public.cloud_profiles where id=p_profile_id for update;
  if not found or profile.status<>'active' then raise exception 'profile_not_found'; end if;
  if recipient.role<>'admin' and profile.owner_id<>p_user_id
    and not exists(select 1 from public.profile_shares where profile_id=p_profile_id and recipient_id=p_user_id) then
    raise exception 'profile_access_denied'; end if;
  if not exists(select 1 from public.profile_key_envelopes e where e.profile_id=p_profile_id and e.user_id=auth.uid() and e.encrypted_key=p_expected_admin_envelope) then raise exception 'admin_key_changed_retry'; end if;
  if coalesce(length(p_encrypted_key),0) not between 300 and 2000 then raise exception 'invalid_key_envelope'; end if;
  insert into public.profile_key_envelopes(profile_id,user_id,encrypted_key)
  values(p_profile_id,p_user_id,p_encrypted_key)
  on conflict(profile_id,user_id) do update set encrypted_key=excluded.encrypted_key,updated_at=now();
  if not exists(select 1 from public.cloud_profiles p where p.status='active' and (
      p.owner_id=p_user_id or recipient.role='admin' or exists(select 1 from public.profile_shares s where s.profile_id=p.id and s.recipient_id=p_user_id)
    ) and not exists(select 1 from public.profile_key_envelopes e where e.profile_id=p.id and e.user_id=p_user_id)) then
    update public.app_users set recovery_requested_at=null where user_id=p_user_id;
  end if;
end $$;

revoke all on function public.td_sync_account_key_update() from public,anon,authenticated;
revoke all on function public.td_account_security_ready(boolean) from public,anon;
revoke all on function public.td_admin_recovery_candidates(uuid) from public,anon;
revoke all on function public.td_admin_restore_profile_key(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.td_account_security_ready(boolean) to authenticated;
grant execute on function public.td_admin_recovery_candidates(uuid) to authenticated;
grant execute on function public.td_admin_restore_profile_key(uuid,uuid,text,text,text) to authenticated;


create or replace function public.td_assert_envelope_public_key(p_user_id uuid,p_public_key text)
returns void language plpgsql security definer set search_path=public
as $$ declare actual text; begin
  select public_key into actual from public.app_users where user_id=p_user_id and status='active' for share;
  if not found or actual is distinct from p_public_key then raise exception 'Khóa người nhận đã thay đổi hoặc app quá cũ. Cập nhật app rồi thử lại.'; end if;
end $$;
revoke all on function public.td_assert_envelope_public_key(uuid,text) from public,anon,authenticated;

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
    perform public.td_assert_envelope_public_key((envelope->>'user_id')::uuid,envelope->>'public_key');
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
    perform public.td_assert_envelope_public_key((envelope->>'user_id')::uuid,envelope->>'public_key');
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

create or replace function public.td_update_admin_key_envelopes(p_profile_id uuid, p_envelopes jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare envelope jsonb;
begin
  if not public.td_is_admin() or not public.td_can_access_profile(p_profile_id) then raise exception 'admin_required'; end if;
  for envelope in select * from jsonb_array_elements(coalesce(p_envelopes,'[]'::jsonb)) loop
    perform public.td_assert_envelope_public_key((envelope->>'user_id')::uuid,envelope->>'public_key');
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

create or replace function public.td_share_cloud_profile_v2(p_profile_id uuid,p_recipient_email text,p_encrypted_key text,p_expected_public_key text)
returns void language plpgsql security definer set search_path=public
as $$ declare recipient uuid; begin
  if not public.td_is_active_user() then raise exception 'active_user_required'; end if;
  select user_id into recipient from public.app_users where lower(email)=lower(trim(p_recipient_email)) and status='active';
  if not found then raise exception 'recipient_not_found'; end if;
  perform public.td_assert_envelope_public_key(recipient,p_expected_public_key);
  perform public.td_share_cloud_profile(p_profile_id,p_recipient_email,p_encrypted_key);
end $$;
create or replace function public.td_admin_transfer_profile_v2(p_profile_id uuid,p_owner_id uuid,p_owner_envelope text,p_expected_public_key text)
returns void language plpgsql security definer set search_path=public
as $$ begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  perform public.td_assert_envelope_public_key(p_owner_id,p_expected_public_key);
  perform public.td_admin_transfer_profile(p_profile_id,p_owner_id,p_owner_envelope);
end $$;
revoke all on function public.td_share_cloud_profile(uuid,text,text) from authenticated;
revoke all on function public.td_admin_transfer_profile(uuid,uuid,text) from authenticated;
revoke all on function public.td_share_cloud_profile_v2(uuid,text,text,text) from public,anon;
revoke all on function public.td_admin_transfer_profile_v2(uuid,uuid,text,text) from public,anon;
grant execute on function public.td_share_cloud_profile_v2(uuid,text,text,text) to authenticated;
grant execute on function public.td_admin_transfer_profile_v2(uuid,uuid,text,text) to authenticated;

commit;
