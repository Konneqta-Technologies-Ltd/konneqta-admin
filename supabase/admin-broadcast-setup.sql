-- ============================================================================
-- Konneqta Admin — Broadcast + report infrastructure (run AFTER
-- admin-auth-setup.sql and admin-data-views.sql)
-- ============================================================================
-- Additive, idempotent. Three concerns:
--
--   1. Admin push broadcasts — the customer app's `notifications` table has a
--      CHECK constraint on `type`; this re-adds it WITH 'admin_broadcast'
--      included, and adds the matching notification_preferences column
--      (default ON — users opt out in their app Settings, same as every
--      other notification type).
--
--   2. `notifications.send` admin permission — gates /admin/broadcast and the
--      per-user notify panel. super_admin bypasses permission checks in code,
--      but is linked explicitly like users.grant_pro so the seed is complete.
--
--   3. admin_report_logs — idempotency ledger for the monthly digest cron
--      (one row per report period; the unique index makes double-sends
--      impossible even across concurrent cron retries).
--
-- Run in the Supabase SQL editor on the SAME project as the customer app.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Allow the `admin_broadcast` notification type
-- ---------------------------------------------------------------------------
-- The customer app's notifications-setup.sql created the `notifications`
-- table with: type text not null check (type in ('konneqt', ...)), and
-- konneqt-requests-setup.sql later re-created it WITH 'konneqt_request'.
--
-- The live database may allow MORE types than any one file lists (the
-- customer app keeps adding them), and rows exist for every value in use —
-- which is why re-adding a hand-written list fails with 23514 "violated by
-- some row". So this block:
--   1. drops EVERY CHECK constraint covering the `type` column (found via
--      pg_constraint — names can differ across environments), and
--   2. re-adds ONE constraint allowing the base list + 'admin_broadcast' +
--      ANY value already present in the table (discovered at run time).
--
-- Fully idempotent: re-running drops the constraint this script added last
-- time and re-adds it. A partially-run attempt (constraint already dropped,
-- ALTER failed) is handled too — nothing found, nothing dropped, then added.
do $$
declare
  r       record;
  v_extra text;
begin
  -- 1. Drop every CHECK constraint over notifications.type.
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = con.connamespace
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = any (con.conkey)
    where nsp.nspname = 'public'
      and rel.relname = 'notifications'
      and con.contype = 'c'
      and att.attname = 'type'
  loop
    execute format('alter table public.notifications drop constraint %I', r.conname);
  end loop;

  -- 2. Collect type values ALREADY in the table that the base list below
  --    does not cover (defence against future customer-app types).
  select coalesce(string_agg(quote_literal(s.t), ', ') || ', ', '')
    into v_extra
  from (
    select distinct type as t
    from public.notifications
  ) s
  where s.t not in (
    'konneqt', 'konneqt_request', 'guest_konneqt', 'referral',
    'pro_expiry', 'weekly_digest', 'share_limit', 'admin_broadcast'
  );

  -- 3. Re-add: current customer-app allow-list + admin_broadcast + extras.
  execute format(
    'alter table public.notifications add constraint notifications_type_check
       check (type in (%s''konneqt'', ''konneqt_request'', ''guest_konneqt'', ''referral'', ''pro_expiry'', ''weekly_digest'', ''share_limit'', ''admin_broadcast''))',
    v_extra
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Per-user opt-out for admin broadcasts
-- ---------------------------------------------------------------------------
-- notification_preferences has one BOOLEAN COLUMN per type (missing row =
-- everything on). Missing row = all-on, so default true keeps that contract.
alter table public.notification_preferences
  add column if not exists admin_broadcast boolean not null default true;

-- ---------------------------------------------------------------------------
-- 3. notifications.send permission
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (name, description) values
  ('notifications.send', 'Send push notifications and broadcasts to users, and trigger the monthly report')
on conflict (name) do nothing;

-- Link to super_admin explicitly (mirrors the users.grant_pro seed: the
-- section-4 cross-join seed in admin-auth-setup.sql runs before this script
-- in a first pass and cannot pick this up on its own).
insert into public.admin_role_permissions (role_id, permission_id)
select r.id, p.id
from public.admin_roles r
cross join public.admin_permissions p
where r.name = 'super_admin' and p.name = 'notifications.send'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. admin_report_logs — monthly-digest idempotency ledger
-- ---------------------------------------------------------------------------
create table if not exists public.admin_report_logs (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end   date not null,
  -- 'cron' or the admin email that pressed "Send now".
  triggered_by text not null,
  recipient    text,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

-- One report per period, ever. The cron path inserts with on-conflict-do-
-- nothing and treats 0 inserted rows as "already sent"; the manual path
-- deletes the row first (deliberate re-send).
create unique index if not exists admin_report_logs_period_unique
  on public.admin_report_logs (period_start, period_end);

-- Service-role only (reads/writes go through lib/supabase/admin.ts).
alter table public.admin_report_logs enable row level security;