begin;

create or replace function public.td_admin_revoke_profile_share(p_profile_id uuid, p_recipient_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare profile_owner uuid;
begin
  if not public.td_is_admin() then raise exception 'admin_required'; end if;
  select owner_id into profile_owner from public.cloud_profiles where id=p_profile_id for update;
  if profile_owner is null then raise exception 'profile_not_found'; end if;
  if profile_owner=p_recipient_id then raise exception 'cannot_revoke_owner'; end if;
  if exists(select 1 from public.profile_locks where profile_id=p_profile_id and user_id=p_recipient_id and lease_until>now()) then
    raise exception 'profile_locked';
  end if;
  delete from public.profile_shares where profile_id=p_profile_id and recipient_id=p_recipient_id;
  -- Administrators retain their existing authority and encryption keys.
  delete from public.profile_key_envelopes e where e.profile_id=p_profile_id and e.user_id=p_recipient_id
    and not exists(select 1 from public.app_users u where u.user_id=p_recipient_id and u.role='admin');
end;
$$;

revoke all on function public.td_admin_revoke_profile_share(uuid,uuid) from public, anon;
grant execute on function public.td_admin_revoke_profile_share(uuid,uuid) to authenticated;

commit;
