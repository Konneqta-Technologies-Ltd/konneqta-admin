import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase auth callback (route handler).
 *
 * NOT a Google/OAuth callback — this app only uses email + password. This
 * endpoint exists as the single landing point for Supabase auth flows that
 * arrive via email links:
 *   - Password recovery
 *   - Future: admin invitation links
 *
 * Flow: exchange `code` for a session → redirect to /admin (the dashboard
 * layout runs the full admin check and bounces non-admins to /login).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // `next` lets flows redirect somewhere specific after the exchange
  // (e.g. a password-reset page). Defaults to the dashboard.
  const next = searchParams.get("next") ?? "/admin";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Missing or invalid code — send to login with an error flag.
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}