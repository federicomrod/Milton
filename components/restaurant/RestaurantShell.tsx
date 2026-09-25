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
//     The restaurant pilot intentionally omits the old CFO-style routes
//     (analytics, reporting, data uploads, model, scenarios) from the nav.
//     Those pages still exist and are reachable if visited directly, but
//     they are no longer surfaced anywhere in the restaurant UI.
//   - The shell is route-aware: each item highlights via `usePathname()`
//     against its own `match` predicate, so e.g. `/dashboard/restaurant`
//     doesn't light up "Menu & Recipes".
//
// Multi-Restaurant UX v1: the sidebar brand area is a real switcher —
// "All Restaurants" (consolidated, no `?location=` param) or one of the
// company's own restaurant_locations (`?location=<uuid>`). It only ever
// shows RESTAURANT NAMES, never brand/location ids or internal jargon —
// see the `locations` prop, which the layout resolves server-side scoped
// to the caller's own company. The current selection is read client-side
// via `useSearchParams()` (layouts don't receive searchParams in the App
// Router) and is carried along when navigating between sidebar links, so
// it survives normal in-app navigation.
//
// Performance:
//   - Pure client component. No data fetching (beyond the switcher's own
//     "add restaurant" POST); the rest lives in the routes it wraps.

"use client";

import { type ComponentType, Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  ChevronDown,
  Building2,
  MessageSquareText,
  Check,
  Plus,
} from "lucide-react";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { AddRestaurantDialog } from "@/components/restaurant/AddRestaurantDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function defaultMatch(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/**
 * Carries the current `?location=` selection along to another nav item's
 * href, inserted before any hash fragment the item's own href already has
 * (only "Targets" does, today).
 */
export function withLocationParam(
  href: string,
  locationId: string | null
): string {
  if (!locationId) return href;
  const [pathAndQuery, hash] = href.split("#");
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  const withParam = `${pathAndQuery}${separator}location=${encodeURIComponent(locationId)}`;
  return hash ? `${withParam}#${hash}` : withParam;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

// Deployment verification marker — bump this string whenever you need to
// confirm in production which build is live. Visible in the browser console
// on every restaurant page; harmless (no UI impact).
const SHELL_BUILD_MARKER =
  "RestaurantShell build: 2026-09-25-multi-restaurant-switcher";

export interface RestaurantShellLocation {
  id: string;
  name: string;
}

export function RestaurantShell({
  children,
  locations = [],
}: {
  children: React.ReactNode;
  /** The caller's own company's restaurant_locations — resolved server-side
   *  by the layout, scoped to that company. Names only, never brand/location
   *  jargon exposed further than this. */
  locations?: RestaurantShellLocation[];
}) {
  const pathname = usePathname() ?? "";
  // useSearchParams() requires a Suspense boundary (Next.js app router
  // requirement for CSR bailout during prerendering) — isolated into
  // SearchParamsReader below so the fallback path here never calls it.
  return (
    <Suspense
      fallback={
        <RestaurantShellBody
          pathname={pathname}
          locations={locations}
          currentLocationId={null}
        >
          {children}
        </RestaurantShellBody>
      }
    >
      <SearchParamsReader pathname={pathname} locations={locations}>
        {children}
      </SearchParamsReader>
    </Suspense>
  );
}

function SearchParamsReader({
  children,
  locations,
  pathname,
}: {
  children: React.ReactNode;
  locations: RestaurantShellLocation[];
  pathname: string;
}) {
  const searchParams = useSearchParams();
  const currentLocationId = searchParams.get("location");
  return (
    <RestaurantShellBody
      pathname={pathname}
      locations={locations}
      currentLocationId={currentLocationId}
    >
      {children}
    </RestaurantShellBody>
  );
}

function RestaurantShellBody({
  children,
  locations,
  currentLocationId,
  pathname,
}: {
  children: React.ReactNode;
  locations: RestaurantShellLocation[];
  currentLocationId: string | null;
  pathname: string;
}) {
  if (typeof window !== "undefined") {
    console.log(`[Milton] ${SHELL_BUILD_MARKER}`);
  }

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Sidebar — visible at lg+. Below that, we collapse it and surface
          a slim top bar (rendered further down). */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 border-r border-border bg-background sticky top-0 h-screen">
        <SidebarBrand
          locations={locations}
          currentLocationId={currentLocationId}
          pathname={pathname}
        />
        <nav
          aria-label="Restaurant navigation"
          className="flex-1 overflow-y-auto px-3 py-4 space-y-6"
        >
          {PRIMARY_GROUPS.map((group) => (
            <SidebarGroup
              key={group.label}
              group={group}
              pathname={pathname}
              currentLocationId={currentLocationId}
            />
          ))}
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

function SidebarBrand({
  locations,
  currentLocationId,
  pathname,
}: {
  locations: RestaurantShellLocation[];
  currentLocationId: string | null;
  pathname: string;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  const selected = currentLocationId
    ? (locations.find((l) => l.id === currentLocationId) ?? null)
    : null;
  const displayLabel = selected ? selected.name : "All Restaurants";

  function switchTo(locationId: string | null) {
    const href = locationId
      ? `${pathname}?location=${encodeURIComponent(locationId)}`
      : pathname;
    router.push(href);
  }

  return (
    <div className="px-4 pt-5 pb-4 border-b border-border space-y-3">
      <Link href="/dashboard/restaurant" className="flex items-center gap-2">
        <Image src="/Milton_Logo.png" alt="Milton" width={28} height={28} />
        <span className="text-lg font-bold tracking-tight">milton.</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border border-border bg-muted/40 hover:bg-muted text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <Building2 className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium truncate">
                {displayLabel}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={() => switchTo(null)}>
            <span className="flex-1">All Restaurants</span>
            {!selected && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
          {locations.length > 0 && <DropdownMenuSeparator />}
          {locations.map((loc) => (
            <DropdownMenuItem key={loc.id} onClick={() => switchTo(loc.id)}>
              <span className="flex-1 truncate">{loc.name}</span>
              {selected?.id === loc.id && (
                <Check className="h-3.5 w-3.5 shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            <span>Add restaurant</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddRestaurantDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function SidebarGroup({
  group,
  pathname,
  currentLocationId,
}: {
  group: NavGroup;
  pathname: string;
  currentLocationId: string | null;
}) {
  return (
    <div className="space-y-1">
      <p className="px-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {group.label}
      </p>
      <ul className="space-y-0.5">
        {group.items.map((item) => (
          <SidebarLink
            key={item.label}
            item={item}
            pathname={pathname}
            currentLocationId={currentLocationId}
          />
        ))}
      </ul>
    </div>
  );
}

function SidebarLink({
  item,
  pathname,
  currentLocationId,
}: {
  item: NavItem;
  pathname: string;
  currentLocationId: string | null;
}) {
  const Icon = item.icon;
  const active = defaultMatch(item, pathname);
  return (
    <li>
      <Link
        href={withLocationParam(item.href, currentLocationId)}
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

function SidebarFooter() {
  return (
    <div className="border-t border-border px-3 py-3">
      <LogoutButton />
    </div>
  );
}
