import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 Proxy (formerly Middleware).
 *
 * Two responsibilities:
 *   1. Refresh the Supabase auth session cookies on every request.
 *   2. Optimistic route protection:
 *        /login          → always allowed
 *        /auth/callback  → always allowed
 *        everything else → requires an auth session
 *
 * NOTE (per Next.js docs): Proxy performs OPTIMISTIC checks only — it looks
 * for the presence of session cookies. Full authorization (is this user an
 * ACTIVE admin in admin_users?) is enforced server-side in the pages/API
 * routes via requireAdmin() / requireAdminApi() from lib/auth/guard.
 */

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // ── 1. Supabase session refresh ────────────────────────────────────────
  // createServerClient attaches cookie updates to `response` so the refreshed
  // tokens survive to the browser.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() (not getSession()) — it validates the JWT against
  // Supabase Auth server-side instead of trusting the cookie contents.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  // ── 2. Optimistic route protection ─────────────────────────────────────
  if (isPublicPath) {
    // Logged-in users shouldn't see /login — send them to the dashboard.
    // (The dashboard itself will run the full admin check.)
    if (user && pathname === "/login") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return response;
  }

  // Any other path requires a session. If none, bounce to /login.
  if (!user) {
    const redirectUrl = new URL("/login", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  // Run on all app paths except Next.js internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};