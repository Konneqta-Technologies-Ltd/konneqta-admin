import { createAdminClient } from "@/lib/supabase/admin";

type AuthUser = {
  id: string;
  email?: string;
  created_at: string;
  banned_until?: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  plan: string | null;
  is_exempt: boolean | null;
  pro_expires_at: string | null;
  status: "active" | "deactivated" | null;
};

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

async function listAuthUsers(): Promise<AuthUser[]> {
  const admin = createAdminClient();
  const users: AuthUser[] = [];
  const perPage = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const batch = data.users as AuthUser[];
    users.push(...batch);
    if (batch.length < perPage) break;
  }

  return users;
}

function countByOwner(rows: Array<{ owner_id: string }> | null) {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    counts.set(row.owner_id, (counts.get(row.owner_id) ?? 0) + 1);
  }
  return counts;
}

function isAuthUserBanned(user: AuthUser | undefined) {
  if (!user?.banned_until) return false;
  return new Date(user.banned_until).getTime() > Date.now();
}

export async function getDashboardStats(
  includePayments: boolean
): Promise<DashboardStats> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [profiles, cards, payments, revenue, subscriptions, deactivated, authUsers] =
    await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("cards").select("id", { count: "exact", head: true }),
      includePayments
        ? admin
            .from("payments")
            .select("id", { count: "exact", head: true })
            .eq("status", "successful")
            .gte("created_at", since)
        : Promise.resolve({ count: 0, error: null }),
      includePayments
        ? admin
            .from("payments")
            .select("amount")
            .eq("status", "successful")
            .gte("created_at", since)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("status", "deactivated"),
      listAuthUsers(),
    ]);

  const revenueRows = (revenue.data ?? []) as Array<{ amount: number | string }>;
  const paymentRevenue30d = revenueRows.reduce(
    (total, row) => total + Number(row.amount || 0),
    0
  );

  const recentSignups = authUsers
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
    .map((user) => ({
      id: user.id,
      email: user.email ?? "Unknown email",
      createdAt: user.created_at,
    }));

  return {
    totalUsers: profiles.count ?? 0,
    activeCards: cards.count ?? 0,
    payments30d: payments.count ?? 0,
    paymentRevenue30d,
    proSubscribers: subscriptions.count ?? 0,
    deactivatedUsers: deactivated.count ?? 0,
    recentSignups,
  };
}

export async function getCustomerUsers(search = ""): Promise<CustomerUser[]> {
  const admin = createAdminClient();
  const authUsers = await listAuthUsers();
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const ids = authUsers.map((user) => user.id);

  if (ids.length === 0) return [];

  const [{ data: profiles, error: profilesError }, { data: cards, error: cardsError }] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, username, full_name, plan, is_exempt, pro_expires_at, status"
        )
        .in("id", ids),
      admin.from("cards").select("owner_id").in("owner_id", ids),
    ]);

  if (profilesError) throw profilesError;
  if (cardsError) throw cardsError;

  const cardCounts = countByOwner(cards as Array<{ owner_id: string }>);
  const normalizedSearch = search.trim().toLowerCase();

  return ((profiles ?? []) as ProfileRow[])
    .map((profile) => {
      const authUser = authById.get(profile.id);
      return {
        id: profile.id,
        email: authUser?.email ?? "Unknown email",
        username: profile.username,
        fullName: profile.full_name,
        plan: profile.plan ?? "free",
        isExempt: Boolean(profile.is_exempt),
        proExpiresAt: profile.pro_expires_at,
        status: isAuthUserBanned(authUser)
          ? "suspended"
          : profile.status === "deactivated"
            ? "deactivated"
            : "active",
        createdAt: authUser?.created_at ?? "",
        cardCount: cardCounts.get(profile.id) ?? 0,
      } satisfies CustomerUser;
    })
    .filter((user) => {
      if (!normalizedSearch) return true;
      return [user.email, user.username, user.fullName, user.id]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedSearch));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCustomerUser(id: string): Promise<CustomerUser | null> {
  const users = await getCustomerUsers();
  return users.find((user) => user.id === id) ?? null;
}

export async function getAdminAccounts(): Promise<AdminAccount[]> {
  const admin = createAdminClient();
  const [{ data, error }, authUsers] = await Promise.all([
    admin
      .from("admin_users")
      .select(
        "id, user_id, status, invited_at, created_at, role:admin_roles(id, name, display_name)"
      )
      .order("created_at", { ascending: false }),
    listAuthUsers(),
  ]);

  if (error) throw error;
  const authById = new Map(authUsers.map((user) => [user.id, user]));

  return (data ?? []).map((row) => {
    const role = row.role as unknown as AdminRole;
    return {
      id: row.id,
      userId: row.user_id,
      email: authById.get(row.user_id)?.email ?? "Unknown email",
      role,
      status: row.status as AdminAccount["status"],
      invitedAt: row.invited_at,
      createdAt: row.created_at,
    };
  });
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

export async function getAuditLogs(limit = 100): Promise<AuditLog[]> {
  const admin = createAdminClient();
  const [{ data, error }, authUsers] = await Promise.all([
    admin
      .from("admin_audit_logs")
      .select("id, action, target_type, target_id, metadata, created_at, admin_id")
      .order("created_at", { ascending: false })
      .limit(limit),
    listAuthUsers(),
  ]);

  if (error) throw error;

  const adminIds = [...new Set((data ?? []).map((row) => row.admin_id))];
  if (adminIds.length === 0) return [];

  const { data: adminRows, error: adminError } = await admin
    .from("admin_users")
    .select("id, user_id")
    .in("id", adminIds);
  if (adminError) throw adminError;

  const userIdByAdminId = new Map(
    (adminRows ?? []).map((row) => [row.id, row.user_id])
  );
  const emailByUserId = new Map(
    authUsers.map((user) => [user.id, user.email ?? "Unknown email"])
  );

  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    adminEmail:
      emailByUserId.get(userIdByAdminId.get(row.admin_id) ?? "") ??
      "Unknown email",
  }));
}
