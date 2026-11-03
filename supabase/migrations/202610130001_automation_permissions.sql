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
