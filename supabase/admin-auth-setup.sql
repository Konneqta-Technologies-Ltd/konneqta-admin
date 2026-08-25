-- ============================================================================
-- Konneqta Admin — Authorization schema
-- ============================================================================
-- Run this in the Supabase SQL editor (or via supabase CLI) on the SAME
-- project that powers the customer app.
--
-- Design principles (agreed 2026-08-13):
--   1. Being a Konneqta user does NOT make someone an admin. Admin access
--      exists ONLY as explicit rows in admin_users.
--   2. No signup: admin accounts are created by a Super Admin via the
--      server-side admin API (service role) — never public registration.
--   3. RLS is the enforcement boundary. The browser can never read or write
--      these tables except where explicitly allowed below.
--   4. There is NO trigger that automatically makes anyone an admin. The
--      first Super Admin is bootstrapped with an explicit, one-time SQL
--      statement (see the BOOTSTRAP section at the bottom).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Roles: super_admin, admin, support, ...
create table if not exists public.admin_roles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,          -- machine name: 'super_admin'
  display_name text not null,                 -- human name: 'Super Admin'
  description  text,
  created_at   timestamptz not null default now()
);

-- Permissions: granular capabilities, e.g. 'users.read', 'admins.create'
create table if not exists public.admin_permissions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,           -- 'users.read'
  description text,
  created_at  timestamptz not null default now()
);

-- The gatekeeper table. A user is an admin ONLY if a row exists here.
create table if not exists public.admin_users (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  role_id      uuid not null references public.admin_roles (id),
  status       text not null default 'active'
               check (status in ('active', 'suspended', 'revoked')),
  invited_by   uuid references public.admin_users (id),
  invited_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Many-to-many: which permissions belong to which role.
create table if not exists public.admin_role_permissions (
  role_id       uuid not null references public.admin_roles (id) on delete cascade,
  permission_id uuid not null references public.admin_permissions (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- Audit log: every sensitive admin action gets recorded.
-- Append-only by design (no update/delete policies granted to anyone).
create table if not exists public.admin_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references public.admin_users (id) on delete cascade,
  action      text not null,                  -- 'user.suspend', 'admin.create'
  target_type text,                           -- 'user', 'payment', 'admin'
  target_id   text,                           -- id of the affected row
  metadata    jsonb default '{}'::jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index if not exists idx_admin_users_user_id on public.admin_users (user_id);
create index if not exists idx_admin_audit_logs_admin_id on public.admin_audit_logs (admin_id);
create index if not exists idx_admin_audit_logs_created_at on public.admin_audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- 1b. Privileged customer-management RPCs
-- ---------------------------------------------------------------------------
-- These functions let the admin app update customer auth/profile state without
-- exposing the service-role key. They are callable only by service_role.
-- Suspension is stored in auth.users.banned_until and can only be changed by
-- the server-side service role through this restricted SECURITY DEFINER RPC.

create or replace function public.admin_set_user_suspension(
  target_user_id uuid,
  should_suspend boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if should_suspend then
    update auth.users
    set banned_until = '9999-12-31 23:59:59+00'::timestamptz,
        updated_at = now()
    where id = target_user_id;
  else
    update auth.users
    set banned_until = null,
        updated_at = now()
    where id = target_user_id;
  end if;

  if not found then
    raise exception 'Auth user not found';
  end if;
end;
$$;

revoke all on function public.admin_set_user_suspension(uuid, boolean) from public;
revoke all on function public.admin_set_user_suspension(uuid, boolean) from anon;
revoke all on function public.admin_set_user_suspension(uuid, boolean) from authenticated;
grant execute on function public.admin_set_user_suspension(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger for admin_users
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at
  before update on public.admin_users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
-- service_role bypasses RLS, so the server-side admin API can do everything.
-- These policies control what the anon/publishable key (browser) can do —
-- which is almost nothing.

alter table public.admin_roles            enable row level security;
alter table public.admin_permissions      enable row level security;
alter table public.admin_users            enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_audit_logs       enable row level security;

-- admin_roles: any AUTHENTICATED user may read (needed for the login flow's
-- role lookup + the admin UI). Writes are service-role only (no policy).
drop policy if exists "roles readable by authenticated" on public.admin_roles;
create policy "roles readable by authenticated"
  on public.admin_roles for select
  to authenticated
  using (true);

-- admin_users: a user may read ONLY their own row. This is what
-- getAdminUser() relies on. All inserts/updates/deletes are service-role
-- only (Super Admin flows go through the server API).
drop policy if exists "users read own admin row" on public.admin_users;
create policy "users read own admin row"
  on public.admin_users for select
  to authenticated
  using (auth.uid() = user_id);

-- admin_permissions / admin_role_permissions: readable by AUTHENTICATED
-- users whose own admin_users row is active. (The permission check runs
-- server-side with the service-role client anyway; this just keeps the
-- browser from enumerating the whole authorization matrix from an anonymous
-- context.)
drop policy if exists "permissions readable by active admins" on public.admin_permissions;
create policy "permissions readable by active admins"
  on public.admin_permissions for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
        and au.status = 'active'
    )
  );

drop policy if exists "role_permissions readable by active admins" on public.admin_role_permissions;
create policy "role_permissions readable by active admins"
  on public.admin_role_permissions for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
        and au.status = 'active'
    )
  );

-- admin_audit_logs: active admins may read (for the audit viewer).
-- INSERTs happen via the service-role client from server code.
-- No UPDATE or DELETE policy exists — the log is append-only.
drop policy if exists "audit logs readable by active admins" on public.admin_audit_logs;
create policy "audit logs readable by active admins"
  on public.admin_audit_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
        and au.status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Seed roles + permissions
-- ---------------------------------------------------------------------------

insert into public.admin_roles (name, display_name, description) values
  ('super_admin', 'Super Admin', 'Full, unrestricted access to every admin capability.'),
  ('admin',       'Admin',       'Day-to-day administration. Cannot manage other admins.')
on conflict (name) do nothing;

insert into public.admin_permissions (name, description) values
  ('admins.read',    'View the list of admin accounts'),
  ('admins.create',  'Invite new admin accounts'),
  ('admins.update',  'Change admin roles / statuses'),
  ('admins.delete',  'Remove admin accounts'),
  ('users.read',     'View customer users and profiles'),
  ('users.update',   'Edit / suspend customer accounts'),
  ('users.delete',   'Delete customer accounts'),
  ('payments.read',  'View payments and transactions'),
  ('payments.refund','Issue refunds'),
  ('audit.read',     'View the admin audit log')
on conflict (name) do nothing;

-- super_admin gets every permission.
insert into public.admin_role_permissions (role_id, permission_id)
select r.id, p.id
from public.admin_roles r
cross join public.admin_permissions p
where r.name = 'super_admin'
on conflict do nothing;

-- regular admin gets the day-to-day set (no admins.*, no payments.refund,
-- no users.delete).
insert into public.admin_role_permissions (role_id, permission_id)
select r.id, p.id
from public.admin_roles r
join public.admin_permissions p
  on p.name in ('users.read', 'users.update', 'payments.read', 'audit.read')
where r.name = 'admin'
on conflict do nothing;

-- ============================================================================
-- 5. BOOTSTRAP — the first Super Admin (RUN MANUALLY, ONE TIME)
-- ============================================================================
-- Do NOT automate this. Replace the email below with the auth user that
-- should become the Super Admin, then run this statement exactly once.
--
--   insert into public.admin_users (user_id, role_id, status)
--   select u.id, r.id, 'active'
--   from auth.users u
--   cross join public.admin_roles r
--   where u.email = 'YOUR-EMAIL-HERE'
--     and r.name = 'super_admin';
--
-- To verify:
--   select au.id, u.email, r.name, au.status
--   from public.admin_users au
--   join auth.users u on u.id = au.user_id
--   join public.admin_roles r on r.id = au.role_id;

-- ============================================================================
-- 6. COMPLIMENTARY PRO GRANTS ("grant Pro without payment")
-- ============================================================================
-- Adds the `users.grant_pro` permission and the `pro_grants` audit table
-- behind the /admin/users/[id] "Pro access" panel and /admin/grants page.
--
-- The grant itself just writes profiles.plan / profiles.pro_expires_at with
-- the service role (the customer app's protect_entitlements trigger allows
-- exactly that role), and the customer app's lazy isPro() expiry drops the
-- user back to free the moment the timestamp passes — no cron needed.
-- ============================================================================

-- Permission (super_admin picks it up automatically via the cross-join seed
-- above when this script is re-run; the day-to-day 'admin' role does NOT get
-- it by default because comp access is monetisation-sensitive. To enable it
-- for regular admins, run:
--   insert into public.admin_role_permissions (role_id, permission_id)
--   select r.id, p.id from public.admin_roles r, public.admin_permissions p
--   where r.name = 'admin' and p.name = 'users.grant_pro'
--   on conflict do nothing;)
insert into public.admin_permissions (name, description) values
  ('users.grant_pro', 'Grant or revoke complimentary Pro access')
on conflict (name) do nothing;

create table if not exists public.pro_grants (
    id          uuid primary key default gen_random_uuid(),

    -- The customer receiving the complimentary Pro access (profiles.id).
    user_id     uuid not null references public.profiles(id) on delete cascade,

    -- The admin_users row that granted it. SET NULL so deleting an admin
    -- account preserves the grant history.
    granted_by  uuid references public.admin_users(id) on delete set null,

    -- Username snapshot at grant time (survives renames / deletion).
    username    text not null,

    -- How many days were granted (1 .. 3650 = 10 years).
    days        integer not null check (days > 0 and days <= 3650),

    -- When this grant's Pro access ends (mirrors profiles.pro_expires_at).
    expires_at  timestamptz not null,

    -- Free-form reason: "giveaway winner", "beta tester", "goodwill"…
    note        text,

    -- Filled when an admin revokes early. Same lazy model as elsewhere:
    -- revoked_at IS NULL and expires_at > now() means "currently active".
    revoked_at  timestamptz,
    revoked_by  uuid references public.admin_users(id) on delete set null,

    created_at  timestamptz not null default now()
);

create index if not exists pro_grants_user_idx    on public.pro_grants (user_id);
create index if not exists pro_grants_expires_idx on public.pro_grants (expires_at);
create index if not exists pro_grants_created_idx on public.pro_grants (created_at desc);

-- RLS: service-role only (every read/write in this admin app goes through
-- lib/supabase/admin.ts), so NO anon/authenticated policies are created.
alter table public.pro_grants enable row level security;
-- ============================================================================

-- ============================================================================