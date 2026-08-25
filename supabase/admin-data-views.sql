-- ============================================================================
-- Konneqta Admin — Scalable data-access layer (run AFTER admin-auth-setup.sql)
-- ============================================================================
-- Run this in the Supabase SQL editor (or via supabase CLI) on the SAME
-- project that powers the customer app. The script is idempotent: safe to
-- re-run whenever it changes.
--
-- Why this exists: the admin app previously paged through the ENTIRE
-- auth.users table (up to 10k users / 10 round trips) just to map
-- user_id -> email, loaded every profile + card row into Node memory to
-- search/filter/sort, and summed 30-day payment revenue row-by-row in JS.
-- These objects move all of that into Postgres:
--
--   admin_customer_directory      profiles + auth email + card count + status
--   admin_admin_directory         admin accounts joined with emails
--   admin_audit_directory         audit log joined with admin emails
--   admin_dashboard_stats()       every dashboard count + revenue SUM, one call
--   admin_find_auth_user_id_by_email()  replaces the auth.admin.listUsers scan
--   admin_set_customer_suspension()     ATOMIC suspend/unsuspend incl.
--                                       profile-status save/restore
--
-- Everything is SERVICE-ROLE ONLY (revoked from anon/authenticated), matching
-- the app's rule that privileged reads go through lib/supabase/admin.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Customer directory view
-- ---------------------------------------------------------------------------
-- One row per profile, joined with the auth email and a card count.
-- `status` mirrors the app's precedence exactly:
--   auth ban (banned_until > now)  >  profile deactivated  >  active.
-- LEFT JOIN keeps orphaned profiles (auth user deleted) visible with a NULL
-- email — the app maps that to "Unknown email" like it always has.
create or replace view public.admin_customer_directory as
select
  p.id                                             as id,
  u.email                                          as email,
  p.username                                       as username,
  p.full_name                                      as full_name,
  coalesce(p.plan, 'free')                         as plan,
  p.is_exempt                                      as is_exempt,
  p.pro_expires_at                                 as pro_expires_at,
  case
    when u.banned_until is not null
      and u.banned_until > now()                   then 'suspended'
    when p.status = 'deactivated'                  then 'deactivated'
    else 'active'
  end                                              as status,
  u.created_at                                     as created_at,
  (select count(*)
     from public.cards c
    where c.owner_id = p.id)                       as card_count
from public.profiles p
left join auth.users u on u.id = p.id;

-- ---------------------------------------------------------------------------
-- 2. Admin directory view
-- ---------------------------------------------------------------------------
create or replace view public.admin_admin_directory as
select
  au.id                as id,
  au.user_id           as user_id,
  u.email              as email,
  ar.id                as role_id,
  ar.name              as role_name,
  ar.display_name      as role_display_name,
  au.status            as status,
  au.invited_at        as invited_at,
  au.created_at        as created_at
from public.admin_users au
join public.admin_roles ar on ar.id = au.role_id
left join auth.users u on u.id = au.user_id;

-- ---------------------------------------------------------------------------
-- 3. Audit directory view
-- ---------------------------------------------------------------------------
-- Audit rows joined straight to the acting admin's email, so the audit
-- viewer needs exactly ONE query (previously: audit page + all auth users
-- + all admin_users).
create or replace view public.admin_audit_directory as
select
  l.id            as id,
  l.action        as action,
  l.target_type   as target_type,
  l.target_id     as target_id,
  l.metadata      as metadata,
  l.created_at    as created_at,
  coalesce(u.email, 'Unknown email') as admin_email
from public.admin_audit_logs l
join public.admin_users au on au.id = l.admin_id
left join auth.users u on u.id = au.user_id;

-- ---------------------------------------------------------------------------
-- 4. Dashboard stats — one call instead of 7 queries + a JS revenue sum
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats(
  include_payments boolean default true
)
returns table (
  total_users         bigint,
  active_cards        bigint,
  payments_30d        bigint,
  payment_revenue_30d numeric,
  pro_subscribers     bigint,
  deactivated_users   bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.profiles)                                  as total_users,
    (select count(*) from public.cards)                                     as active_cards,
    case when include_payments then
      (select count(*) from public.payments pay
        where pay.status = 'successful'
          and pay.created_at >= now() - interval '30 days')
    else 0::bigint end                                                      as payments_30d,
    case when include_payments then
      (select coalesce(sum(pay.amount), 0) from public.payments pay
        where pay.status = 'successful'
          and pay.created_at >= now() - interval '30 days')
    else 0::numeric end                                                     as payment_revenue_30d,
    (select count(*) from public.subscriptions s where s.status = 'active') as pro_subscribers,
    (select count(*) from public.profiles p where p.status = 'deactivated') as deactivated_users;
$$;

-- ---------------------------------------------------------------------------
-- 5. Auth-user lookup by email — replaces the auth.admin.listUsers() scan
-- used by the admin-invite flow.
-- ---------------------------------------------------------------------------
create or replace function public.admin_find_auth_user_id_by_email(
  p_email text
)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. ATOMIC customer suspension (auth ban + profile status in ONE transaction)
-- ---------------------------------------------------------------------------
-- Replaces the old two-write flow (admin_set_user_suspension RPC + separate
-- profiles update + audit-log-derived restore), which could half-apply and
-- reconstructed the pre-suspension status from audit metadata that is only
-- best-effort written.
--
-- The columns below remember the pre-suspension profile status on the row
-- itself, so unsuspend restores EXACTLY what was there (with the old
-- audit-metadata path kept as a fallback for suspensions made before this
-- script existed).
alter table public.profiles
  add column if not exists admin_suspended_previous_status text
    check (admin_suspended_previous_status in ('active', 'deactivated')),
  add column if not exists admin_suspended_at timestamptz;

create or replace function public.admin_set_customer_suspension(
  target_user_id uuid,
  should_suspend boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status  text;
  v_previous_status text;
begin
  -- Lock the profile row; raise if the user doesn't exist (atomic rollback).
  select p.status into v_current_status
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user_id) then
    raise exception 'Auth user not found';
  end if;

  if should_suspend then
    v_previous_status := case
      when v_current_status in ('active', 'deactivated') then v_current_status
      else 'active'
    end;

    update public.profiles
       set status = 'deactivated',
           admin_suspended_previous_status = v_previous_status,
           admin_suspended_at = now()
     where id = target_user_id;

    update auth.users
       set banned_until = '9999-12-31 23:59:59+00'::timestamptz,
           updated_at = now()
     where id = target_user_id;

    return v_previous_status;

  else
    -- 1st choice: the status saved on the row at suspend time.
    select p.admin_suspended_previous_status into v_previous_status
    from public.profiles p
    where p.id = target_user_id;

    -- 2nd choice: the last suspend's audit metadata (legacy suspensions).
    if v_previous_status is null then
      select (l.metadata ->> 'previous_profile_status') into v_previous_status
      from public.admin_audit_logs l
      where l.action = 'user.suspend'
        and l.target_type = 'user'
        and l.target_id = target_user_id::text
      order by l.created_at desc
      limit 1;
    end if;

    if coalesce(v_previous_status, '') not in ('active', 'deactivated') then
      v_previous_status := 'active';
    end if;

    update public.profiles
       set status = v_previous_status,
           admin_suspended_previous_status = null,
           admin_suspended_at = null
     where id = target_user_id;

    update auth.users
       set banned_until = null,
           updated_at = now()
     where id = target_user_id;

    return v_current_status;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Helpful indexes for the new access patterns
-- ---------------------------------------------------------------------------
create index if not exists idx_cards_owner_id
  on public.cards (owner_id);
create index if not exists idx_admin_audit_logs_action
  on public.admin_audit_logs (action, created_at desc);
create index if not exists idx_admin_audit_logs_target
  on public.admin_audit_logs (target_type, target_id);
create index if not exists idx_profiles_status
  on public.profiles (status);

-- OPTIONAL (enable if customer search feels slow at scale): trigram indexes
-- make `%term%` ILIKE searches index-assisted instead of full scans.
--   create extension if not exists pg_trgm with schema extensions;
--   create index if not exists idx_profiles_username_trgm
--     on public.profiles using gin (username gin_trgm_ops);
--   create index if not exists idx_profiles_full_name_trgm
--     on public.profiles using gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 8. Privileges — service_role only
-- ---------------------------------------------------------------------------
revoke all on public.admin_customer_directory from public, anon, authenticated;
grant  select on public.admin_customer_directory to service_role;

revoke all on public.admin_admin_directory from public, anon, authenticated;
grant  select on public.admin_admin_directory to service_role;

revoke all on public.admin_audit_directory from public, anon, authenticated;
grant  select on public.admin_audit_directory to service_role;

revoke all on function public.admin_dashboard_stats(boolean)
  from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats(boolean)
  to service_role;

revoke all on function public.admin_find_auth_user_id_by_email(text)
  from public, anon, authenticated;
grant execute on function public.admin_find_auth_user_id_by_email(text)
  to service_role;

revoke all on function public.admin_set_customer_suspension(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_set_customer_suspension(uuid, boolean)
  to service_role;
