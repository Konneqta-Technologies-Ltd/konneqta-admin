"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/grants", label: "Pro grants", grantPermissionOnly: true },
  { href: "/admin/promos", label: "Promo codes", promoPermissionOnly: true },
  { href: "/admin/admins", label: "Admins", superAdminOnly: true },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav({
  isSuperAdmin,
  canGrantPro = false,
  canManagePromos = false,
  mobile = false,
}: {
  isSuperAdmin: boolean;
  canGrantPro?: boolean;
  canManagePromos?: boolean;
  mobile?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin navigation"
      className={
        mobile
          ? "flex gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-900 px-3 py-2 md:hidden"
          : "flex flex-1 flex-col gap-1 p-3"
      }
    >
      {!mobile && (
        <span className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Navigation
        </span>
      )}
      {links.map((link) => {
        if (link.superAdminOnly && !isSuperAdmin) return null;
        if (link.grantPermissionOnly && !canGrantPro) return null;
        if (link.promoPermissionOnly && !canManagePromos) return null;
        const active =
          link.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-zinc-800 font-medium text-white"
                : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}