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
