import { getAdminUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

/**
 * Root page — no home page for the admin app.
 *
 *   Authenticated + active admin → /admin (dashboard)
 *   Anything else                → /login
 *
 * The proxy already ensures only authenticated users reach this page, but we
 * re-check here server-side (defense in depth).
 */
export default async function RootPage() {
  const session = await getAdminUser();

  if (session?.admin?.status === "active") {
    redirect("/admin");
  }

  redirect("/login");
}