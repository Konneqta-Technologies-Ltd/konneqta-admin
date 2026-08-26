import { hasPermission, requireAdminApi } from "@/lib/auth/guard";

import { NextResponse } from "next/server";
import { togglePromo } from "@/lib/admin/promos";

/**
 * PATCH /api/admin/promos/[id] — enable or disable a promo code.
 * Body: { active: boolean }
 *
 * Disabling is the manual kill switch: new redemptions stop instantly, days
 * already redeemed are preserved.
 */
export async function PATCH(
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
  if (!(await hasPermission(guard.session, "promos.manage"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    active?: unknown;
  } | null;

  if (typeof body?.active !== "boolean") {
    return NextResponse.json(
      { error: "An `active` boolean is required." },
      { status: 400 }
    );
  }

  const result = await togglePromo({
    id,
    active: body.active,
    adminId: guard.session.admin!.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true });
}
