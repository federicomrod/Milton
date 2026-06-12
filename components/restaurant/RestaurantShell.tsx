// components/restaurant/RestaurantShell.tsx
//
// App shell for all restaurant routes. Renders a fixed left sidebar with
// grouped navigation and a scrollable main content area. Used by both
// app/(restaurant-cockpit)/layout.tsx (cockpit) and
// app/dashboard/restaurant/layout.tsx (subroutes).
//
// Design:
//   - Sidebar is `lg:sticky top-0 h-screen` so it stays in view while the
//     main column scrolls. Below `lg` we render a slim top bar instead —
//     a real mobile drawer is out of scope for this milestone.
//   - Navigation is split into Main / Operations / Automation / Admin.
//     Legacy CFO-style routes live in a collapsed bottom section so they
//     stay reachable but stop dominating the visual hierarchy.
//   - The shell is route-aware: each item highlights via `usePathname()`
//     against its own `match` predicate, so e.g. `/dashboard/restaurant`
//     doesn't light up "Menu & Recipes".
//
// Performance:
//   - Pure client component. No data fetching; that lives in the routes
//     it wraps.

"use client";

import { type ComponentType, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  Target,
  BookOpen,
  Carrot,
  Receipt,
  Sparkles,
  Settings,
  User,
  Archive,
  ChevronDown,
  ChevronRight,
  Building2,
  MessageSquareText,
} from "lucide-react";
import { LogoutButton } from "@/components/dashboard/logout-button";

// ---------------------------------------------------------------------------
// Nav model
// ---------------------------------------------------------------------------

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Optional override for active-state matching. Default: exact match
   *  for the cockpit root, prefix match for everything else. */
  match?: (pathname: string) => boolean;
  /** Optional badge text (e.g. "Soon") shown right-aligned. */
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const PRIMARY_GROUPS: NavGroup[] = [
  {
    label: "Main",
    items: [
      {
        href: "/dashboard/restaurant",
        label: "Cockpit",
        icon: LayoutDashboard,
        // Exact match — sub-routes (upload, menu, ...) have their own items.
        match: (p) => p === "/dashboard/restaurant",
      },
      {
        href: "/dashboard/restaurant/briefing",
        label: "Ask Milton",
        icon: MessageSquareText,
      },
      {
        href: "/dashboard/restaurant/upload",
        label: "POS Sales",
        icon: Upload,
      },
      {
        href: "/dashboard/restaurant#targets",
        label: "Targets",
        icon: Target,
        // Highlight only when actually on the cockpit; hash routes don't
        // get a server-side active state because the URL hash isn't in
        // `usePathname()` output.
        match: () => false,
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/dashboard/restaurant/menu",
        label: "Menu & Recipes",
        icon: BookOpen,
      },
      {
        href: "/dashboard/restaurant/ingredients",
        label: "Ingredients",
        icon: Carrot,
      },
      {
        href: "/dashboard/restaurant/costs/upload",
        label: "Import Costs",
        icon: Upload,
      },
      {
        href: "/dashboard/restaurant/suppliers",
        label: "Suppliers",
        icon: Building2,
      },
      {
        href: "/dashboard/restaurant/invoices",
        label: "Supplier Invoices",
        icon: Receipt,
      },
    ],
  },
  {
    label: "Automation",
    items: [
      {
        href: "/dashboard/restaurant/agents",
        label: "Agents",
        icon: Sparkles,
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/dashboard/settings",
        label: "Settings",
        icon: Settings,
      },
      {
        href: "/dashboard/account",
        label: "Account",
        icon: User,
      },
    ],
  },
];

const LEGACY_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Legacy Dashboard", icon: Archive },
  { href: "/dashboard/analytics", label: "Old Analytics", icon: Archive },
  { href: "/dashboard/reporting", label: "Reporting", icon: Archive },
  { href: "/dashboard/data", label: "Data Uploads", icon: Archive },
  { href: "/dashboard/model", label: "Model (Paused)", icon: Archive },
  { href: "/dashboard/scenarios", label: "Scenarios", icon: Archive },
];

function defaultMatch(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function RestaurantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Sidebar — visible at lg+. Below that, we collapse it and surface
          a slim top bar (rendered further down). */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 border-r border-border bg-background sticky top-0 h-screen">
        <SidebarBrand />
        <nav
          aria-label="Restaurant navigation"
          className="flex-1 overflow-y-auto px-3 py-4 space-y-6"
        >
          {PRIMARY_GROUPS.map((group) => (
            <SidebarGroup key={group.label} group={group} pathname={pathname} />
          ))}
          <LegacyGroup pathname={pathname} />
        </nav>
        <SidebarFooter />
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar — visible below lg. Keeps the brand reachable
            and indicates we collapsed the sidebar. */}
        <div className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-background">
          <Link
            href="/dashboard/restaurant"
            className="flex items-center gap-2"
          >
            <Image src="/Milton_Logo.png" alt="Milton" width={24} height={24} />
            <span className="text-base font-bold">milton.</span>
          </Link>
          <span className="text-xs text-muted-foreground">
            Sidebar collapsed on small screens
          </span>
        </div>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar pieces
// ---------------------------------------------------------------------------

function SidebarBrand() {
  // Restaurant selector is a placeholder for the multi-location future. For
  // now we just show the brand + a non-interactive "switcher" affordance.
  return (
    <div className="px-4 pt-5 pb-4 border-b border-border space-y-3">
      <Link href="/dashboard/restaurant" className="flex items-center gap-2">
        <Image src="/Milton_Logo.png" alt="Milton" width={28} height={28} />
        <span className="text-lg font-bold tracking-tight">milton.</span>
      </Link>
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border border-border bg-muted/40 hover:bg-muted text-left"
        title="Restaurant selector — multi-location is coming"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Building2 className="h-4 w-4 text-orange-500 shrink-0" />
          <span className="text-sm font-medium truncate">
            Pinche Gringo BBQ
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
    </div>
  );
}

function SidebarGroup({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  return (
    <div className="space-y-1">
      <p className="px-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {group.label}
      </p>
      <ul className="space-y-0.5">
        {group.items.map((item) => (
          <SidebarLink key={item.label} item={item} pathname={pathname} />
        ))}
      </ul>
    </div>
  );
}

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = defaultMatch(item, pathname);
  return (
    <li>
      <Link
        href={item.href}
        className={
          "flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm font-medium transition-colors " +
          (active
            ? "bg-primary/10 text-primary"
            : "text-foreground/80 hover:bg-muted hover:text-foreground")
        }
        aria-current={active ? "page" : undefined}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </span>
        {item.badge && (
          <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            {item.badge}
          </span>
        )}
      </Link>
    </li>
  );
}

/** Collapsed-by-default "Legacy" group containing the old CFO-style routes. */
function LegacyGroup({ pathname }: { pathname: string }) {
  // Auto-expand when the user is currently on a legacy route so they see
  // where they are.
  const hasActiveLegacy = LEGACY_ITEMS.some((i) => defaultMatch(i, pathname));
  const [open, setOpen] = useState<boolean>(hasActiveLegacy);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          Legacy
        </span>
      </button>
      {open && (
        <ul className="space-y-0.5">
          {LEGACY_ITEMS.map((item) => (
            <SidebarLink key={item.label} item={item} pathname={pathname} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SidebarFooter() {
  return (
    <div className="border-t border-border px-3 py-3">
      <LogoutButton />
    </div>
  );
}
