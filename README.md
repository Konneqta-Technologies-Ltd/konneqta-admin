# Konneqta Admin

Internal administration console for the Konneqta platform — invite-only,
role-based, and fully audited. Built with Next.js (App Router), Supabase,
and Tailwind CSS.

> **Not the Next.js you know** — this project pins a recent Next.js major.
> Consult `node_modules/next/dist/docs/` before touching framework APIs.

## Features

- **Dashboard** — live platform stats (users, cards, payments, Pro subscribers)
- **Customer users** — server-side search (email / username / name / UUID),
  pagination, suspension with exact pre-suspension-status restore
- **Referrals** — every signup made with a referral code (signed-up →
  rewarded / revoked), code + status + date-range filters with quick
  presets, per-referrer leaderboard, and referral stats on each user's page
- **Broadcasts** — push notifications to an audience (Everyone / Active /
  Pro / Free / Suspended / Deactivated, or one user): lands in the app's
  notification center AND on devices (Web Push for browsers/PWA, Expo Push
  for iOS/Android), respecting per-user opt-outs, fully audit-logged
- **Monthly report** — the full platform digest (signups, revenue, Pro
  conversions/churn, referrals + top referrers, promo redemptions,
  engagement, admin activity) emailed via ZeptoMail on the 1st by Vercel
  Cron, previewable for any past month, re-sendable by a Super Admin
- **Admin bell** — live platform-event feed in the top bar (new signups,
  payments, referral rewards, grants, promo redemptions, broadcasts,
  suspensions) with an unread badge, polling the read-only `admin_events`
  view — no triggers, no writes to the customer app
- **Complimentary Pro grants** — grant/extend/revoke Pro without payment,
  with stacking expiry windows and a full grant history
- **Administrators** — invite admins (Supabase invitation email), change
  roles/statuses, last-super-admin protection
- **Audit log** — every sensitive action, filterable by action and admin

## Scripts

| Command             | What it does                  |
| ------------------- | ----------------------------- |
| `pnpm dev`          | Start the dev server          |
| `pnpm build`        | Production build              |
| `pnpm start`        | Serve the production build    |
| `pnpm lint`         | ESLint (Next core-web-vitals) |
| `pnpm typecheck`    | `tsc --noEmit`                |
| `pnpm test`         | Vitest unit tests (CI mode)   |
| `pnpm test:watch`   | Vitest in watch mode          |

## Architecture

```
proxy.ts                      optimistic auth check + Supabase cookie refresh
lib/auth/session.ts           getAdminUser() — React cache()-wrapped
lib/auth/guard.ts             requireAdmin() / requireAdminApi() / hasPermission()
lib/supabase/admin.ts         service-role client (SERVER ONLY)
lib/supabase/server.ts        anon-key server client (respects RLS)
lib/supabase/client.ts        browser client (login only)
lib/admin/data.ts             reads via SQL views/RPCs (see DB section)
lib/admin/grants.ts           complimentary-Pro domain logic
lib/admin/referrals.ts        referral drill-down reads (view + leaderboard RPC)
lib/admin/notify.ts           device push senders (Web Push VAPID + Expo Push)
lib/admin/broadcast.ts        audience resolution + the broadcast pipeline
lib/admin/monthly-report.ts   digest stats + email/text rendering
lib/admin/email.ts            ZeptoMail sender (monthly digest)
app/admin/**                  dashboard pages (server components)
app/api/admin/**              mutation endpoints (guarded, audited)
app/api/cron/monthly-report   scheduled digest send (CRON_SECRET-protected)
```

### Security model

1. **No public signup.** Admin access exists only as rows in `admin_users`,
   created by a Super Admin through the app.
2. **Defense in depth.** The proxy performs an optimistic cookie check;
   `requireAdmin()` (pages) / `requireAdminApi()` (API) do full verification;
   RLS is the database boundary.
3. **RBAC.** Permissions (`users.read`, `admins.create`, …) attach to roles via
   `admin_role_permissions`. `super_admin` bypasses every check.
4. **Append-only audit.** Every mutation inserts into `admin_audit_logs`;
   no update/delete policies exist.

## Database setup

Run **both** scripts in the SQL editor of the SAME Supabase project that
powers the customer app, in this order. Both are idempotent — re-run them
whenever they change.

| Script                          | Installs                                                    |
| ------------------------------- | ----------------------------------------------------------- |
| `supabase/admin-auth-setup.sql` | Admin roles/permissions/accounts, RLS policies, audit logs, the legacy suspension RPC, `pro_grants` |
| `supabase/admin-data-views.sql` | Directory views (incl. `admin_referrals` + referral-enriched customer directory) + dashboard stats + the **atomic** suspension RPC + `admin_referral_leaderboard` / `admin_monthly_report` RPCs (+ indexes) |
| `supabase/admin-broadcast-setup.sql` | The `admin_broadcast` notification type + per-user preference, the `notifications.send` permission, and the `admin_report_logs` idempotency ledger |

The second script is what makes the admin app scale: the dashboard, user
search, admin list, and audit viewer each run **one** O(page) query instead
of loading the entire auth user base into memory.

After the first run of `admin-auth-setup.sql`, bootstrap the first Super
Admin with the one-time statement at the bottom of that script.

### Deploy order

1. Apply any new SQL to Supabase first (the scripts are additive).
2. Deploy the app. Rollback = revert the code; leftover views are inert.

## Vercel deployment

### Vercel project settings (important)

This repo lives at the **root** of the repository — make sure Vercel is not
pointing at a subdirectory:

- **Settings → General → Root Directory**: leave empty (i.e. repo root), since
  `package.json` is at the top level. A mismatch here causes
  `Error: No Next.js version detected`.
- **Framework Preset**: Next.js (pinned via `vercel.json`).
- **Install Command**: `pnpm install` (pinned via `vercel.json`; the lockfile
  is `pnpm-lock.yaml`).
- **Node.js Version**: 22 (pinned via `.nvmrc`).

If a previous deploy failed with `No Next.js version detected`, clear the
stale build cache once: **Deployments → ⋯ → Redeploy → check "clear cache"**.

### Environment variables

Set these in **Vercel → Settings → Environment Variables** (and in GitHub
Actions secrets for CI):

| Variable                               | Used by                            |
| -------------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Browser, server, proxy             |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser, server, proxy (anon key)  |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server-only (`lib/supabase/admin`) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`         | Web Push leg of broadcasts — MUST be the same values the customer web app uses |
| `VAPID_PRIVATE_KEY`                    | Web Push signing (server-only)     |
| `VAPID_SUBJECT`                        | Push service contact (mailto:)     |
| `ZEPTOMAIL_API_KEY`                    | Monthly digest email (same key convention as the customer app) |
| `REPORT_RECIPIENT_EMAIL`               | Where the digest lands (falls back to `ADMIN_NOTIFICATION_EMAIL`) |
| `REPORT_FROM_EMAIL`                    | Optional verified sender (default `info@konneqta.com`) |
| `CRON_SECRET`                          | Protects `/api/cron/monthly-report` (Vercel injects the header automatically) |

### Scheduled jobs

`vercel.json` registers a Vercel Cron hitting `/api/cron/monthly-report`
daily at 06:00 UTC. The route sends only within the first 3 days of a month
(a missed run retries the next day) and sends each period exactly once
(`admin_report_logs` unique index). To re-send a period, use Reports →
"Send now" as a Super Admin (that path deliberately clears the idempotency
row first).

The build is designed to succeed even when these are absent (CI), but the app
requires them at runtime.

### Build-time safety note

`"use client"` pages are still prerendered (SSR'd) during `next build`.
Never create a Supabase browser client at component top-level — always create
it lazily inside event handlers/effects (see `app/login/page.tsx` and
`app/admin/logout-button.tsx`), otherwise the build fails when env vars are
not present in the build environment.

## Testing

Unit tests cover the pure domain logic (grant lifecycle, Pro expiry math,
search-term sanitisation, formatting):

```bash
pnpm test        # CI mode
pnpm test:watch  # watch mode
```

CI (`.github/workflows/ci.yml`) runs lint → type-check → tests → build on
every push/PR to `main` and `dev`.

