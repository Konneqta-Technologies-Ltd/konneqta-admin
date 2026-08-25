import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { revokePro } from "@/lib/admin/grants";

/**
 * POST /api/admin/users/[id]/revoke-pro — revoke complimentary Pro now.
 * Refuses while the user has an active paid subscription.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error },
      { status: guard.status }
    );
  }
  if (!(await hasPermission(guard.session, "users.grant_pro"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const result = await revokePro({
    userId: id,
    adminId: guard.session.admin!.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true });
}
