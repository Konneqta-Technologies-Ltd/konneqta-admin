import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Admin data-access layer.
 *
 * All reads go through the SQL views / RPCs defined in
 * supabase/admin-data-views.sql (service-role only). Every query is
 * O(page size) — the legacy implementation loaded every auth user,
 * profile, and card row into Node memory on each request.
 */

export type DashboardStats = {
  totalUsers: number;
  activeCards: number;
  payments30d: number;
  paymentRevenue30d: number;
  proSubscribers: number;
  deactivatedUsers: number;
  recentSignups: Array<{ id: string; email: string; createdAt: string }>;
};

export type CustomerUser = {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  plan: string;
  isExempt: boolean;
  proExpiresAt: string | null;
  status: "active" | "deactivated" | "suspended";
  createdAt: string;
  cardCount: number;
};

export type AdminRole = {
  id: string;
  name: string;
  display_name: string;
};

export type AdminAccount = {
  id: string;
  userId: string;
  email: string;
  role: AdminRole;
  status: "active" | "suspended" | "revoked";
  invitedAt: string | null;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  adminEmail: string;
};

/** Row shape of the admin_customer_directory view. */
type DirectoryRow = {
  id: string;
  email: string | null;
  username: string | null;
  full_name: string | null;
  plan: string | null;
  is_exempt: boolean | null;
  pro_expires_at: string | null;
  status: "active" | "deactivated" | "suspended";
  created_at: string | null;
  card_count: number | null;
};

export const CUSTOMERS_PER_PAGE = 25;
export const CUSTOMERS_PER_PAGE_MAX = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strip characters that carry meaning in PostgREST filter syntax / SQL LIKE
 * patterns (`%`, `_` wildcards aside — see buildCustomerSearchFilter) so user
 * input can never widen or break the query.
 */
export function sanitizeSearchTerm(term: string | null | undefined): string {
  return (term ?? "").trim().replace(/[%,"()\\]/g, "");
}

/**
 * PostgREST `.or(...)` filter across the directory view's searchable columns.
 * Returns null when the term is empty after sanitising.
 */
export function buildCustomerSearchFilter(
  term: string | null | undefined
): string | null {
  const clean = sanitizeSearchTerm(term);
  if (!clean) return null;

  const like = `%${clean}%`;
  const parts = [
    `email.ilike.${like}`,
    `username.ilike.${like}`,
    `full_name.ilike.${like}`,
  ];
  if (UUID_RE.test(clean)) parts.push(`id.eq.${clean}`);
  return parts.join(",");
}

function toCustomerUser(row: DirectoryRow): CustomerUser {
  return {
    id: row.id,
    email: row.email ?? "Unknown email",
    username: row.username,
    fullName: row.full_name,
    plan: row.plan ?? "free",
    isExempt: Boolean(row.is_exempt),
    proExpiresAt: row.pro_expires_at,
    status: row.status,
    createdAt: row.created_at ?? "",
    cardCount: row.card_count ?? 0,
  };
}

/**
 * Dashboard stats — one RPC call (admin_dashboard_stats) plus one 5-row
 * select for recent signups. Previously 8 round trips + a JS revenue sum
 * over every successful payment row.
 */
export async function getDashboardStats(
  includePayments: boolean
): Promise<DashboardStats> {
  const admin = createAdminClient();

  const [{ data: rawStats, error: statsError }, { data: recent, error: recentError }] =
    await Promise.all([
      admin.rpc("admin_dashboard_stats", { include_payments: includePayments }),
      admin
        .from("admin_customer_directory")
        .select("id, email, created_at")
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ]);

  if (statsError) throw statsError;
  if (recentError) throw recentError;

  const row = ((rawStats ?? []) as Array<Record<string, unknown>>)[0] ?? {};
  const num = (value: unknown) => Number(value ?? 0);

  return {
    totalUsers: num(row.total_users),
    activeCards: num(row.active_cards),
    payments30d: num(row.payments_30d),
    paymentRevenue30d: num(row.payment_revenue_30d),
    proSubscribers: num(row.pro_subscribers),
    deactivatedUsers: num(row.deactivated_users),
    recentSignups: (
      (recent ?? []) as Array<{
        id: string;
        email: string | null;
        created_at: string | null;
      }>
    ).map((signup) => ({
      id: signup.id,
      email: signup.email ?? "Unknown email",
      createdAt: signup.created_at ?? "",
    })),
  };
}

export type CustomerPage = {
  users: CustomerUser[];
  /** Total matching rows (from Postgres count, not a JS array length). */
  total: number;
  page: number;
  perPage: number;
};

/**
 * Paginated, searchable customer list — one query on the directory view.
 * Search/filter/order/range all execute in Postgres.
 */
export async function getCustomerUsers(
  search = "",
  page = 1,
  perPage = CUSTOMERS_PER_PAGE
): Promise<CustomerPage> {
  const admin = createAdminClient();

  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safePerPage = Math.min(
    CUSTOMERS_PER_PAGE_MAX,
    Math.max(1, Math.trunc(perPage) || CUSTOMERS_PER_PAGE)
  );

  const filter = buildCustomerSearchFilter(search);
  let query = admin
    .from("admin_customer_directory")
    .select("*", { count: "exact" });
  if (filter) query = query.or(filter);

  const { data, error, count } = await query
    .order("created_at", { ascending: false, nullsFirst: false })
    .range((safePage - 1) * safePerPage, safePage * safePerPage - 1);

  if (error) throw error;

  return {
    users: ((data ?? []) as DirectoryRow[]).map(toCustomerUser),
    total: count ?? 0,
    page: safePage,
    perPage: safePerPage,
  };
}

/**
 * Single customer by profile id — ONE row fetched (previously the entire
 * user base was loaded to find one user).
 */
export async function getCustomerUser(id: string): Promise<CustomerUser | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("admin_customer_directory")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? toCustomerUser(data as DirectoryRow) : null;
}

/**
 * Admin accounts with emails — one query on admin_admin_directory
 * (previously admin_users + the entire auth user list).
 */
export async function getAdminAccounts(): Promise<AdminAccount[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("admin_admin_directory")
    .select(
      "id, user_id, email, role_id, role_name, role_display_name, status, invited_at, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  type Row = {
    id: string;
    user_id: string;
    email: string | null;
    role_id: string;
    role_name: string;
    role_display_name: string;
    status: AdminAccount["status"];
    invited_at: string | null;
    created_at: string;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    email: row.email ?? "Unknown email",
    role: {
      id: row.role_id,
      name: row.role_name,
      display_name: row.role_display_name,
    },
    status: row.status,
    invitedAt: row.invited_at,
    createdAt: row.created_at,
  }));
}

export async function getAdminRoles(): Promise<AdminRole[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_roles")
    .select("id, name, display_name")
    .order("display_name");

  if (error) throw error;
  return (data ?? []) as AdminRole[];
}

/**
 * Recent audit log entries with admin emails, newest first — one query on
 * admin_audit_directory. Optional substring filters keep the filtering in
 * Postgres. Returns [] (logged, non-fatal) if the view isn't deployed yet.
 */
export async function getAuditLogs(options?: {
  limit?: number;
  action?: string;
  admin?: string;
}): Promise<AuditLog[]> {
  try {
    const admin = createAdminClient();
    const limit = Math.min(500, Math.max(1, options?.limit ?? 100));

    let query = admin
      .from("admin_audit_directory")
      .select(
        "id, action, target_type, target_id, metadata, created_at, admin_email"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    const actionTerm = sanitizeSearchTerm(options?.action);
    if (actionTerm) query = query.ilike("action", `%${actionTerm}%`);
    const adminTerm = sanitizeSearchTerm(options?.admin);
    if (adminTerm) query = query.ilike("admin_email", `%${adminTerm}%`);

    const { data, error } = await query;
    if (error) {
      logger.warn("admin/data", "audit directory read failed", error.message);
      return [];
    }

    type Row = {
      id: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
      admin_email: string | null;
    };

    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      adminEmail: row.admin_email ?? "Unknown email",
    }));
  } catch (err) {
    logger.warn("admin/data", "getAuditLogs error (non-fatal)", err);
    return [];
  }
}
