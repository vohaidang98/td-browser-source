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
