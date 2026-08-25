This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

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

| Variable                              | Used by                            |
| ------------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`            | Browser, server, proxy             |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`| Browser, server, proxy (anon key)  |
| `SUPABASE_SERVICE_ROLE_KEY`           | Server-only (`lib/supabase/admin`) |

The build is designed to succeed even when these are absent (CI), but the app
requires them at runtime.

### Admin database setup

Run `supabase/admin-auth-setup.sql` in the SQL editor of the same Supabase
project used by the customer app. The script is idempotent and should be run
again when it changes. It installs:

- Admin roles, permissions, accounts, and append-only audit logs
- RLS policies for the admin authorization boundary
- The service-role-only customer suspension RPC used by `/admin/users`
- The `pro_grants` table + `users.grant_pro` permission behind the
  complimentary-Pro flow (`/admin/users/[id]` panel and `/admin/grants`)

The Phase 2 dashboard provides live platform statistics, customer search and
suspension, admin invitations and access management, and an audit log viewer.

### Build-time safety note

`"use client"` pages are still prerendered (SSR'd) during `next build`.
Never create a Supabase browser client at component top-level — always create
it lazily inside event handlers/effects (see `app/login/page.tsx` and
`app/admin/logout-button.tsx`), otherwise the build fails when env vars are
not present in the build environment.
