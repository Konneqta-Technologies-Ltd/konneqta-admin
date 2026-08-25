import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { grantPro } from "@/lib/admin/grants";

/**
 * POST /api/admin/users/[id]/grant-pro — grant complimentary Pro.
 * Body: { days: number, note?: string }
 */
export async function POST(
  request: Request,
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
  const body = (await request.json().catch(() => null)) as {
    days?: unknown;
    note?: unknown;
  } | null;

  const days = typeof body?.days === "number" ? body.days : Number(body?.days);
  if (!Number.isFinite(days)) {
    return NextResponse.json(
      { error: "A whole number of days is required." },
      { status: 400 }
    );
  }
  const note = typeof body?.note === "string" ? body.note : null;

  const result = await grantPro({
    userId: id,
    days,
    note,
    adminId: guard.session.admin!.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
