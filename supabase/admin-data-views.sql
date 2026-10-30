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
--                                 + referral enrichment (code / referred-by /
--                                 signups / rewards)
--   admin_admin_directory         admin accounts joined with emails
--   admin_audit_directory         audit log joined with admin emails
--   admin_promo_redemptions       promo redemptions joined with redeemer identity
--   admin_referrals               every referral joined to BOTH users' identities
--   admin_referral_leaderboard(p_from, p_to)   per-referrer aggregates (date-ranged)
--   admin_events                             platform event feed for the admin bell
--   admin_monthly_report(p_from, p_to)         the whole monthly digest, one JSON
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
    where c.owner_id = p.id)                       as card_count,
  -- Effective Pro NOW - NEW COLUMN MUST STAY LAST: create or replace view
  -- can only APPEND columns; inserting mid-list (e.g. before status) fails
  -- with 42P16 cannot change name of view column. Mirrors the customer
  -- app lazy isPro() expiry and admin_dashboard_stats pro_subscribers:
  -- exempt always; plan = pro only while pro_expires_at is unexpired.
  -- Lets the users list filter who is on Pro right now with a plain .eq()
  -- instead of PostgREST or-composition that clashes with the search filter.
  (p.is_exempt
     or (coalesce(p.plan, 'free') = 'pro'
         and p.pro_expires_at > now()))           as is_pro_effective,
  -- Referral enrichment (section 9) — APPENDED (see the column-order note
  -- above): the user's own shareable code, who referred them, and how many
  -- people they referred / how many of those converted. Correlated
  -- subqueries stay cheap at page size behind the referrals indexes below.
  p.referral_code                                 as referral_code,
  (select r.referrer_id
     from public.referrals r
    where r.referred_id = p.id
    limit 1)                                      as referred_by_id,
  (select rp.username
     from public.referrals r
     join public.profiles rp on rp.id = r.referrer_id
    where r.referred_id = p.id
    limit 1)                                      as referred_by_username,
  (select count(*)
     from public.referrals r
    where r.referrer_id = p.id)                   as referral_signups,
  (select count(*)
     from public.referrals r
    where r.referrer_id = p.id
      and r.status = 'rewarded')                  as referral_rewards
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
-- 3b. Promo redemptions view — "who redeemed which code"
-- ---------------------------------------------------------------------------
-- NOTE: public.promo_codes and public.promo_redemptions are created by the
-- CUSTOMER app's migration (konneqta/supabase/promo-codes-setup.sql). This
-- view joins each redemption to the redeemer's identity so the admin promos
-- page can drill into a code with ONE query. code_snapshot is denormalised
-- on the redemption row by the customer RPC, so it stays correct even if the
-- code row is later deleted. LEFT JOINs keep orphaned rows (profile or code
-- deleted) visible instead of silently dropping them.
create or replace view public.admin_promo_redemptions as
select
  pr.id                                            as id,
  pr.promo_code_id                                 as promo_code_id,
  pr.code_snapshot                                 as code,
  pr.days_granted                                  as days_granted,
  pr.created_at                                    as redeemed_at,
  pr.user_id                                       as user_id,
  u.email                                          as email,
  p.username                                       as username,
  p.full_name                                      as full_name
from public.promo_redemptions pr
left join public.profiles p on p.id = pr.user_id
left join auth.users u on u.id = pr.user_id;

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
    -- Effective Pro count — mirrors the customer app's lazy isPro() expiry
    -- (lib/admin/grants.ts proState): exempt profiles are always Pro;
    -- otherwise plan = 'pro' only counts while pro_expires_at is unexpired.
    (select count(*) from public.profiles p
       where p.is_exempt
          or (p.plan = 'pro' and p.pro_expires_at > now()))                as pro_subscribers,
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

revoke all on public.admin_promo_redemptions from public, anon, authenticated;
grant  select on public.admin_promo_redemptions to service_role;

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

-- ---------------------------------------------------------------------------
-- 9. Referrals view — "who signed up with which code"
-- ---------------------------------------------------------------------------
-- public.referrals is created by the CUSTOMER app (lib/referrals attaches
-- rows at signup; rewards fire on the referred user's first successful
-- payment). One row per referral, joined to BOTH sides' identities so the
-- admin referrals page needs ONE query. LEFT JOINs keep orphaned rows
-- visible instead of silently dropping them. referrer_code is the CURRENT
-- shareable code from profiles (code_snapshot is frozen at attach time and
-- can go stale if the code was regenerated).
create or replace view public.admin_referrals as
select
  r.id                                              as id,
  r.code_snapshot                                   as code,
  r.status                                          as status,
  r.reward_days                                     as reward_days,
  r.created_at                                      as created_at,
  r.rewarded_at                                     as rewarded_at,
  r.revoked_at                                      as revoked_at,
  -- Referred (the new signup).
  r.referred_id                                     as referred_id,
  u.email                                           as referred_email,
  p.username                                        as referred_username,
  p.full_name                                       as referred_full_name,
  -- Referrer (the code owner).
  r.referrer_id                                     as referrer_id,
  ru.email                                          as referrer_email,
  rp.username                                       as referrer_username,
  rp.full_name                                      as referrer_full_name,
  rp.referral_code                                  as referrer_code
from public.referrals r
left join public.profiles p on p.id = r.referred_id
left join auth.users u on u.id = r.referred_id
left join public.profiles rp on rp.id = r.referrer_id
left join auth.users ru on ru.id = r.referrer_id;

-- ---------------------------------------------------------------------------
-- 10. Referral leaderboard — per-referrer aggregates, date-ranged
-- ---------------------------------------------------------------------------
-- p_from (inclusive) / p_to (EXCLUSIVE) are calendar dates; NULLs mean
-- unbounded. When a range is set, a referrer appears if they have ANY
-- in-range activity (a signup attached in range OR a reward converted in
-- range); the signups/rewards counters each respect their own date column.
create or replace function public.admin_referral_leaderboard(
  p_from date default null,
  p_to   date default null
)
returns table (
  referrer_id      uuid,
  username         text,
  full_name        text,
  code             text,
  email            text,
  signups          bigint,
  rewards          bigint,
  days_awarded     bigint,
  last_rewarded_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.referrer_id                                                   as referrer_id,
    rp.username                                                     as username,
    rp.full_name                                                    as full_name,
    coalesce(rp.referral_code,
             (array_agg(r.code_snapshot order by r.created_at))[1]) as code,
    ru.email                                                        as email,
    count(*) filter (where
      (p_from is null or r.created_at >= p_from)
      and (p_to   is null or r.created_at <  p_to))                 as signups,
    count(*) filter (where r.status = 'rewarded'
      and (p_from is null or r.rewarded_at >= p_from)
      and (p_to   is null or r.rewarded_at <  p_to))                as rewards,
    coalesce(sum(r.reward_days) filter (where r.status = 'rewarded'
      and (p_from is null or r.rewarded_at >= p_from)
      and (p_to   is null or r.rewarded_at <  p_to)), 0)::bigint    as days_awarded,
    max(r.rewarded_at)                                              as last_rewarded_at
  from public.referrals r
  left join public.profiles rp on rp.id = r.referrer_id
  left join auth.users ru on ru.id = r.referrer_id
  where (p_from is null and p_to is null)
     or ((p_from is null or r.created_at >= p_from)
         and (p_to is null or r.created_at < p_to))
     or ((p_from is null or r.rewarded_at >= p_from)
         and (p_to is null or r.rewarded_at < p_to))
  group by r.referrer_id, rp.username, rp.full_name, rp.referral_code, ru.email
  order by rewards desc, signups desc, last_rewarded_at desc nulls last;
$$;

-- ---------------------------------------------------------------------------
-- 11. Monthly report — the ENTIRE digest in one JSON value
-- ---------------------------------------------------------------------------
-- p_from (inclusive) / p_to (EXCLUSIVE) bound the reporting window; pass the
-- previous calendar month (e.g. from=2026-10-01, to=2026-11-01). "Previous"
-- comparisons use an equally long window ending at p_from. Engagement stats
-- are fail-safe (a missing analytics_events degrades to {} instead of
-- failing the whole report).
create or replace function public.admin_monthly_report(
  p_from date,
  p_to   date
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_prev_from  date := p_from - (p_to - p_from);
  v_engagement jsonb := '{}'::jsonb;
  v_result     jsonb;
begin
  begin
    select jsonb_build_object(
      'cards_created',
        (select count(*) from public.cards c
          where c.created_at >= p_from and c.created_at < p_to),
      'profile_views',
        (select count(*) from public.analytics_events e
          where e.event_type = 'profile_view'
            and e.created_at >= p_from and e.created_at < p_to),
      'konneqts',
        (select count(*) from public.analytics_events e
          where e.event_type = 'konneqt'
            and e.created_at >= p_from and e.created_at < p_to)
    ) into v_engagement;
  exception when others then
    v_engagement := '{}'::jsonb;  -- analytics_events missing/renamed: degrade
  end;

  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'users', jsonb_build_object(
      'new',
        (select count(*) from auth.users u
          where u.created_at >= p_from and u.created_at < p_to),
      'prev_new',
        (select count(*) from auth.users u
          where u.created_at >= v_prev_from and u.created_at < p_from),
      'total',      (select count(*) from public.profiles),
      'suspended',  (select count(*) from auth.users u
                      where u.banned_until is not null
                        and u.banned_until > now()),
      'deactivated',(select count(*) from public.profiles p
                      where p.status = 'deactivated')
    ),
    'revenue', jsonb_build_object(
      'count',
        (select count(*) from public.payments pay
          where pay.status = 'successful'
            and pay.created_at >= p_from and pay.created_at < p_to),
      'total',
        (select coalesce(sum(pay.amount), 0) from public.payments pay
          where pay.status = 'successful'
            and pay.created_at >= p_from and pay.created_at < p_to),
      'prev_total',
        (select coalesce(sum(pay.amount), 0) from public.payments pay
          where pay.status = 'successful'
            and pay.created_at >= v_prev_from and pay.created_at < p_from),
      'failed',
        (select count(*) from public.payments pay
          where pay.status = 'failed'
            and pay.created_at >= p_from and pay.created_at < p_to),
      'premium_count',
        (select count(*) from public.payments pay
          where pay.status = 'successful' and pay.payment_type = 'premium_upgrade'
            and pay.created_at >= p_from and pay.created_at < p_to),
      'teams_count',
        (select count(*) from public.payments pay
          where pay.status = 'successful' and pay.payment_type = 'team_subscription'
            and pay.created_at >= p_from and pay.created_at < p_to)
    ),
    'pro', jsonb_build_object(
      -- Active at month END (same effective-Pro rule as the dashboard).
      'active_end',
        (select count(*) from public.profiles p
          where p.is_exempt
             or (coalesce(p.plan, 'free') = 'pro' and p.pro_expires_at > p_to)),
      -- Users whose FIRST-ever successful payment landed in the window.
      'new_conversions',
        (select count(*) from (
            select pay.user_id, min(pay.created_at) as first_pay
            from public.payments pay
            where pay.status = 'successful'
            group by pay.user_id
          ) f
          where f.first_pay >= p_from and f.first_pay < p_to),
      -- Pro windows that lapsed during the month (churn signal).
      'expired',
        (select count(*) from public.profiles p
          where not p.is_exempt
            and p.plan = 'pro'
            and p.pro_expires_at >= p_from and p.pro_expires_at < p_to),
      'grants',
        (select count(*) from public.pro_grants g
          where g.created_at >= p_from and g.created_at < p_to),
      'grants_days',
        (select coalesce(sum(g.days), 0) from public.pro_grants g
          where g.created_at >= p_from and g.created_at < p_to)
    ),
    'promos', jsonb_build_object(
      'redemptions',
        (select count(*) from public.promo_redemptions pr
          where pr.created_at >= p_from and pr.created_at < p_to),
      'top',
        (select coalesce(
           jsonb_agg(to_jsonb(x) order by x.redemptions desc, x.code),
           '[]'::jsonb)
         from (
           select
             pr.code_snapshot                      as code,
             count(*)                              as redemptions,
             coalesce(sum(pr.days_granted), 0)     as days_granted
           from public.promo_redemptions pr
           where pr.created_at >= p_from and pr.created_at < p_to
           group by pr.code_snapshot
           order by redemptions desc
           limit 5
         ) x)
    ),
    'engagement', v_engagement,
    'admin_actions',
      (select count(*) from public.admin_audit_logs l
        where l.created_at >= p_from and l.created_at < p_to)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Indexes for the new access patterns
-- ---------------------------------------------------------------------------
create index if not exists idx_referrals_referrer_id
  on public.referrals (referrer_id);
create index if not exists idx_referrals_created_at
  on public.referrals (created_at desc);
create index if not exists idx_referrals_rewarded_at
  on public.referrals (rewarded_at)
  where rewarded_at is not null;
create index if not exists idx_payments_created_at
  on public.payments (created_at desc);
create index if not exists idx_profiles_created_at
  on public.profiles (created_at desc);

-- ---------------------------------------------------------------------------
-- 13. Privileges — service_role only (new objects)
-- ---------------------------------------------------------------------------
revoke all on public.admin_referrals from public, anon, authenticated;
grant  select on public.admin_referrals to service_role;

revoke all on function public.admin_referral_leaderboard(date, date)
  from public, anon, authenticated;
grant execute on function public.admin_referral_leaderboard(date, date)
  to service_role;

revoke all on function public.admin_monthly_report(date, date)
  from public, anon, authenticated;
grant execute on function public.admin_monthly_report(date, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- 14. Admin events feed — platform activity for the admin bell
-- ---------------------------------------------------------------------------
-- A unified READ-ONLY feed assembled from tables that already exist. No
-- triggers, no writes to any customer hot path — the admin bell just polls
-- this view. Unread state lives in admin_notification_seen (per admin),
-- below. Everything is capped to the last 7 days to keep the view cheap.
create or replace view public.admin_events as
select
  'signup'                                                    as event_type,
  'New user signed up'                                        as title,
  coalesce(u.email, 'Unknown email')                          as body,
  '/admin/users/' || u.id::text                               as link,
  u.created_at                                                as created_at
from auth.users u
where u.created_at >= now() - interval '7 days'
union all
select
  'payment',
  case when not exists (
      select 1 from public.payments earlier
      where earlier.user_id = pay.user_id
        and earlier.status = 'successful'
        and earlier.created_at < pay.created_at
  ) then 'New Pro subscriber — first payment' else 'Payment received' end,
  concat(pay.payment_type, ' · ', pay.currency, ' ',
         pay.amount::bigint::text)                            as body,
  '/admin/users/' || pay.user_id::text                        as link,
  pay.created_at
from public.payments pay
where pay.status = 'successful'
  and pay.created_at >= now() - interval '7 days'
union all
select
  'referral',
  'Referral reward paid',
  concat('+', coalesce(r.reward_days, 0), ' days to @',
         coalesce(rp.username, 'unknown'))                    as body,
  '/admin/referrals?code=' || r.code_snapshot                 as link,
  r.rewarded_at
from public.referrals r
left join public.profiles rp on rp.id = r.referrer_id
where r.status = 'rewarded'
  and r.rewarded_at >= now() - interval '7 days'
union all
select
  'grant',
  'Complimentary Pro granted',
  concat('+', g.days, ' days to ', g.username)                as body,
  '/admin/users/' || g.user_id::text                          as link,
  g.created_at
from public.pro_grants g
where g.created_at >= now() - interval '7 days'
union all
select
  'promo',
  'Promo code redeemed',
  concat('Code ', pr.code_snapshot, ' — +', pr.days_granted, ' days') as body,
  '/admin/promos?code=' || pr.code_snapshot                   as link,
  pr.created_at
from public.promo_redemptions pr
where pr.created_at >= now() - interval '7 days'
union all
select
  'broadcast',
  'Broadcast sent',
  concat('Audience ', coalesce(l.metadata ->> 'audience', 'n/a'),
         ' — ', coalesce(l.metadata ->> 'recipients', '0'),
         ' recipient(s)')                                     as body,
  '/admin/broadcast'                                          as link,
  l.created_at
from public.admin_audit_logs l
where l.action = 'broadcast.send'
  and l.created_at >= now() - interval '7 days'
union all
select
  'notify',
  'Notification sent',
  coalesce(l.metadata ->> 'title', 'Direct notification')     as body,
  '/admin/users/' || coalesce(l.target_id, '')                as link,
  l.created_at
from public.admin_audit_logs l
where l.action = 'notification.send'
  and l.created_at >= now() - interval '7 days'
union all
select
  'suspend',
  'User suspended',
  'Account suspended by an administrator'                     as body,
  '/admin/users/' || coalesce(l.target_id, '')                as link,
  l.created_at
from public.admin_audit_logs l
where l.action = 'user.suspend'
  and l.created_at >= now() - interval '7 days'
union all
select
  'report',
  'Monthly report emailed',
  concat('Digest delivered to ',
         coalesce(l.metadata ->> 'recipient', 'inbox'))       as body,
  '/admin/reports'                                            as link,
  l.created_at
from public.admin_audit_logs l
where l.action = 'report.send'
  and l.created_at >= now() - interval '7 days';

-- Per-admin "seen" marker for the bell's unread badge. One row per admin;
-- upserted by POST /api/admin/events.
create table if not exists public.admin_notification_seen (
  admin_id   uuid primary key references public.admin_users (id) on delete cascade,
  seen_at    timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Service-role only.
alter table public.admin_notification_seen enable row level security;

revoke all on public.admin_events from public, anon, authenticated;
grant  select on public.admin_events to service_role;
