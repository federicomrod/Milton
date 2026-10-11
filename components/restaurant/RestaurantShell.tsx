// components/restaurant/RestaurantShell.tsx
//
// App shell for all restaurant routes. Cockpit UX PR 1 (#128): compact
// sidebar (MAIN + DATA & SETTINGS), restaurant selector, persistent
// Ask Milton button, keyboard-accessible nav with aria-current.

"use client";

import { type ComponentType, Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Receipt,
  Settings,
  Building2,
  ChevronDown,
  Check,
  Plus,
  ChefHat,
  Flame,
  Menu,
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
import {
  PRIMARY_NAV_ITEMS,
  isPrimaryNavActive,
  navGroupLabel,
  primaryNavLabel,
  withShellParams,
  withLocationParam,
  type NavGroupId,
  type NavItemConfig,
} from "@/lib/restaurant/navigation";
import {
  DATE_FROM_PARAM,
  DATE_TO_PARAM,
  hasExplicitPageDateRange,
} from "@/lib/restaurant/page-date-range";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { DEFAULT_LANGUAGE } from "@/lib/restaurant/language";
import {
  RestaurantShellChromeProvider,
  type RestaurantShellChromeValue,
} from "@/components/restaurant/shell/shell-chrome-context";
import {
  AskMiltonButton,
  AskMiltonDrawer,
} from "@/components/restaurant/shell/AskMiltonDrawer";

export { withLocationParam, withShellParams };

const NAV_ICONS: Record<
  NavItemConfig["id"],
  ComponentType<{ className?: string }>
> = {
  cockpit: LayoutDashboard,
  sales: Flame,
  menu: BookOpen,
  costs: Receipt,
  kitchen: ChefHat,
  data_settings: Settings,
};

const SHELL_BUILD_MARKER = "RestaurantShell build: 2026-10-11-cockpit-ux-pr1";

export interface RestaurantShellLocation {
  id: string;
  name: string;
}

export function RestaurantShell({
  children,
  locations = [],
  lang = DEFAULT_LANGUAGE,
  isAdmin = false,
  lastSyncedAt = null,
}: {
  children: React.ReactNode;
  locations?: RestaurantShellLocation[];
  lang?: PreferredLanguage;
  isAdmin?: boolean;
  lastSyncedAt?: string | null;
}) {
  const pathname = usePathname() ?? "";
  const chrome: RestaurantShellChromeValue = { lang, isAdmin, lastSyncedAt };
  return (
    <RestaurantShellChromeProvider value={chrome}>
      <Suspense
        fallback={
          <RestaurantShellBody
            pathname={pathname}
            locations={locations}
            currentLocationId={null}
            dateFrom={null}
            dateTo={null}
            lang={lang}
          >
            {children}
          </RestaurantShellBody>
        }
      >
        <SearchParamsReader
          pathname={pathname}
          locations={locations}
          lang={lang}
        >
          {children}
        </SearchParamsReader>
      </Suspense>
    </RestaurantShellChromeProvider>
  );
}

function SearchParamsReader({
  children,
  locations,
  pathname,
  lang,
}: {
  children: React.ReactNode;
  locations: RestaurantShellLocation[];
  pathname: string;
  lang: PreferredLanguage;
}) {
  const searchParams = useSearchParams();
  const currentLocationId = searchParams.get("location");
  const dateFrom = hasExplicitPageDateRange(searchParams)
    ? searchParams.get(DATE_FROM_PARAM)
    : null;
  const dateTo = hasExplicitPageDateRange(searchParams)
    ? searchParams.get(DATE_TO_PARAM)
    : null;
  return (
    <RestaurantShellBody
      pathname={pathname}
      locations={locations}
      currentLocationId={currentLocationId}
      dateFrom={dateFrom}
      dateTo={dateTo}
      lang={lang}
    >
      {children}
    </RestaurantShellBody>
  );
}

function RestaurantShellBody({
  children,
  locations,
  currentLocationId,
  dateFrom,
  dateTo,
  pathname,
  lang,
}: {
  children: React.ReactNode;
  locations: RestaurantShellLocation[];
  currentLocationId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  pathname: string;
  lang: PreferredLanguage;
}) {
  const [askOpen, setAskOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (typeof window !== "undefined") {
    console.log(`[Milton] ${SHELL_BUILD_MARKER}`);
  }

  const shellParams = {
    locationId: currentLocationId,
    from: dateFrom,
    to: dateTo,
  };

  return (
    <div className="min-h-screen flex bg-muted/30">
      <aside className="hidden lg:flex lg:flex-col w-56 shrink-0 border-r border-border bg-background sticky top-0 h-screen">
        <SidebarBrand
          locations={locations}
          currentLocationId={currentLocationId}
          pathname={pathname}
          dateFrom={dateFrom}
          dateTo={dateTo}
          lang={lang}
        />
        <SidebarNav pathname={pathname} shellParams={shellParams} lang={lang} />
        <div className="px-3 pb-3 space-y-3">
          <AskMiltonButton lang={lang} onClick={() => setAskOpen(true)} />
          <SidebarFooter />
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="lg:hidden flex items-center justify-between px-4 h-12 border-b border-border bg-background">
          <Link
            href={withShellParams("/dashboard/restaurant", shellParams)}
            className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-sm"
          >
            <Image src="/Milton_Logo.png" alt="Milton" width={24} height={24} />
            <span className="text-base font-bold">milton.</span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full bg-primary text-primary-foreground h-8 px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              onClick={() => setAskOpen(true)}
            >
              {t(lang, "Ask Milton", "Pregunta a Milton")}
            </button>
            <button
              type="button"
              className="p-2 rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              aria-expanded={mobileOpen}
              aria-controls="mobile-restaurant-nav"
              onClick={() => setMobileOpen((v) => !v)}
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">
                {t(lang, "Open navigation", "Abrir navegación")}
              </span>
            </button>
          </div>
        </div>
        {mobileOpen ? (
          <div
            id="mobile-restaurant-nav"
            className="lg:hidden border-b border-border bg-background px-3 py-3"
          >
            <SidebarNav
              pathname={pathname}
              shellParams={shellParams}
              lang={lang}
            />
          </div>
        ) : null}

        <main className="flex-1 min-w-0">{children}</main>
      </div>

      <AskMiltonDrawer open={askOpen} onOpenChange={setAskOpen} lang={lang} />
    </div>
  );
}

function SidebarNav({
  pathname,
  shellParams,
  lang,
}: {
  pathname: string;
  shellParams: {
    locationId: string | null;
    from: string | null;
    to: string | null;
  };
  lang: PreferredLanguage;
}) {
  const groups: NavGroupId[] = ["main", "data_settings"];
  return (
    <nav
      aria-label={t(
        lang,
        "Restaurant navigation",
        "Navegación del restaurante"
      )}
      className="flex-1 overflow-y-auto px-3 py-3 space-y-5"
    >
      {groups.map((group) => (
        <div key={group} className="space-y-1">
          <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {navGroupLabel(group, lang)}
          </p>
          <ul className="space-y-0.5">
            {PRIMARY_NAV_ITEMS.filter((item) => item.group === group).map(
              (item) => (
                <SidebarLink
                  key={item.id}
                  item={item}
                  pathname={pathname}
                  shellParams={shellParams}
                  lang={lang}
                />
              )
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarBrand({
  locations,
  currentLocationId,
  pathname,
  dateFrom,
  dateTo,
  lang,
}: {
  locations: RestaurantShellLocation[];
  currentLocationId: string | null;
  pathname: string;
  dateFrom: string | null;
  dateTo: string | null;
  lang: PreferredLanguage;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  const selected = currentLocationId
    ? (locations.find((l) => l.id === currentLocationId) ?? null)
    : null;
  const displayLabel = selected
    ? selected.name
    : t(lang, "All Restaurants", "Todos los restaurantes");

  function switchTo(locationId: string | null) {
    const href = withShellParams(pathname, {
      locationId,
      from: dateFrom,
      to: dateTo,
    });
    router.push(href);
  }

  return (
    <div className="px-4 pt-4 pb-3 border-b border-border space-y-2.5">
      <Link
        href={withShellParams("/dashboard/restaurant", {
          locationId: currentLocationId,
          from: dateFrom,
          to: dateTo,
        })}
        className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-sm"
      >
        <Image src="/Milton_Logo.png" alt="Milton" width={28} height={28} />
        <span className="text-lg font-bold tracking-tight">milton.</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
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
            <span className="flex-1">
              {t(lang, "All Restaurants", "Todos los restaurantes")}
            </span>
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
            <span>{t(lang, "Add restaurant", "Agregar restaurante")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddRestaurantDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function SidebarLink({
  item,
  pathname,
  shellParams,
  lang,
}: {
  item: NavItemConfig;
  pathname: string;
  shellParams: {
    locationId: string | null;
    from: string | null;
    to: string | null;
  };
  lang: PreferredLanguage;
}) {
  const Icon = NAV_ICONS[item.id];
  const active = isPrimaryNavActive(item, pathname);
  const label = primaryNavLabel(item.id, lang);
  return (
    <li>
      <Link
        href={withShellParams(item.href, shellParams)}
        className={
          "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 " +
          (active
            ? "bg-primary/10 text-primary"
            : "text-foreground/80 hover:bg-muted hover:text-foreground")
        }
        aria-current={active ? "page" : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

function SidebarFooter() {
  return (
    <div className="border-t border-border pt-3">
      <LogoutButton />
    </div>
  );
}
