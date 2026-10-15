// components/restaurant/RestaurantShell.tsx
//
// App shell for all restaurant routes. R1-09b: the five daily areas
// (Cockpit · Ventas · Menú · Costos · Cocina) with no group headers,
// ⚙ Configuración and the user at the bottom. "✦ Preguntar a Milton"
// lives once, top right, in OperatingPageHeader.

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
import { useSectionWarmth } from "@/components/restaurant/shell/use-section-warmth";
import { withSaveEpoch } from "@/lib/restaurant/save-epoch";
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
  primaryNavLabel,
  withShellParams,
  withLocationParam,
  type NavItemConfig,
} from "@/lib/restaurant/navigation";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import {
  RestaurantShellChromeProvider,
  useRestaurantShellChrome,
  type RestaurantShellChromeValue,
} from "@/components/restaurant/shell/shell-chrome-context";
import { AskMiltonDrawer } from "@/components/restaurant/shell/AskMiltonDrawer";
import {
  AskMiltonControllerProvider,
  useAskMiltonController,
} from "@/components/restaurant/shell/ask-milton-controller";

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
  lang = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  isAdmin = false,
  lastSyncedAt = null,
  userName = null,
  slim = false,
}: {
  children: React.ReactNode;
  locations?: RestaurantShellLocation[];
  lang?: PreferredLanguage;
  isAdmin?: boolean;
  lastSyncedAt?: string | null;
  userName?: string | null;
  /**
   * Onboarding: the same shell and look, but no section navigation or
   * restaurant switcher (there is no restaurant to switch to yet).
   */
  slim?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const chrome: RestaurantShellChromeValue = {
    lang,
    isAdmin,
    lastSyncedAt,
    userName,
  };
  return (
    <RestaurantShellChromeProvider value={chrome}>
      <Suspense
        fallback={
          <RestaurantShellBody
            pathname={pathname}
            locations={locations}
            currentLocationId={null}
            lang={lang}
            slim={slim}
          >
            {children}
          </RestaurantShellBody>
        }
      >
        <SearchParamsReader
          pathname={pathname}
          locations={locations}
          lang={lang}
          slim={slim}
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
  slim,
}: {
  children: React.ReactNode;
  locations: RestaurantShellLocation[];
  pathname: string;
  lang: PreferredLanguage;
  slim: boolean;
}) {
  const searchParams = useSearchParams();
  const currentLocationId = searchParams.get("location");
  return (
    <RestaurantShellBody
      pathname={pathname}
      locations={locations}
      currentLocationId={currentLocationId}
      lang={lang}
      slim={slim}
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
  lang,
  slim = false,
}: {
  children: React.ReactNode;
  locations: RestaurantShellLocation[];
  currentLocationId: string | null;
  pathname: string;
  lang: PreferredLanguage;
  slim?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  if (typeof window !== "undefined") {
    console.log(`[Milton] ${SHELL_BUILD_MARKER}`);
  }

  const shellParams = {
    locationId: currentLocationId,
  };

  return (
    <AskMiltonControllerProvider>
      <RestaurantShellChrome
        locations={locations}
        currentLocationId={currentLocationId}
        pathname={pathname}
        lang={lang}
        slim={slim}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        shellParams={shellParams}
      >
        {children}
      </RestaurantShellChrome>
    </AskMiltonControllerProvider>
  );
}

function RestaurantShellChrome({
  children,
  locations,
  currentLocationId,
  pathname,
  lang,
  mobileOpen,
  setMobileOpen,
  shellParams,
  slim = false,
}: {
  slim?: boolean;
  children: React.ReactNode;
  locations: RestaurantShellLocation[];
  currentLocationId: string | null;
  pathname: string;
  lang: PreferredLanguage;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  shellParams: { locationId: string | null };
}) {
  const {
    open: askOpen,
    onOpenChange: setAskOpen,
    openAskMilton,
  } = useAskMiltonController();

  return (
    <div className="min-h-screen flex bg-muted/30">
      <aside className="hidden lg:flex lg:flex-col w-56 shrink-0 border-r border-border bg-background sticky top-0 h-screen">
        {slim ? (
          <SlimSidebar lang={lang} />
        ) : (
          <>
            <SidebarBrand
              locations={locations}
              currentLocationId={currentLocationId}
              pathname={pathname}
              lang={lang}
            />
            <SidebarNav
              pathname={pathname}
              shellParams={shellParams}
              lang={lang}
            />
            <SidebarFooter
              pathname={pathname}
              shellParams={shellParams}
              lang={lang}
            />
          </>
        )}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="lg:hidden flex items-center justify-between px-4 h-12 border-b border-border bg-background">
          <Link
            href={
              slim ? "#" : withShellParams("/dashboard/restaurant", shellParams)
            }
            className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-sm"
          >
            <Image src="/Milton_Logo.png" alt="Milton" width={24} height={24} />
            <span className="text-base font-bold">milton.</span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-full bg-primary text-primary-foreground h-8 px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              onClick={() => openAskMilton()}
            >
              {t(lang, "Ask Milton", "Preguntar a Milton")}
            </button>
            <button
              type="button"
              hidden={slim}
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
        {mobileOpen && !slim ? (
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

/** Onboarding: the brand, where we are, and the way out. No sections yet. */
function SlimSidebar({ lang }: { lang: PreferredLanguage }) {
  const { userName } = useRestaurantShellChrome();
  return (
    <>
      <div className="px-4 pt-4 pb-3 border-b border-border space-y-2.5">
        <div className="flex items-center gap-2">
          <Image src="/Milton_Logo.png" alt="Milton" width={28} height={28} />
          <span className="text-lg font-bold tracking-tight">milton.</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(lang, "Initial setup", "Configuración inicial")}
        </p>
      </div>
      <div className="flex-1" />
      <div className="px-3 pb-3 pt-2 border-t border-border">
        <div className="flex items-center gap-1 px-2.5 text-sm text-muted-foreground">
          {userName ? <span className="truncate">{userName} ·</span> : null}
          <LogoutButton lang={lang} variant="link" />
        </div>
      </div>
    </>
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
  };
  lang: PreferredLanguage;
}) {
  return (
    <nav
      aria-label={t(
        lang,
        "Restaurant navigation",
        "Navegación del restaurante"
      )}
      className="flex-1 overflow-y-auto px-3 py-3"
    >
      <ul className="space-y-0.5">
        {PRIMARY_NAV_ITEMS.filter((item) => item.group === "main").map(
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
    </nav>
  );
}

function SidebarBrand({
  locations,
  currentLocationId,
  pathname,
  lang,
}: {
  locations: RestaurantShellLocation[];
  currentLocationId: string | null;
  pathname: string;
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
    });
    router.push(href);
  }

  return (
    <div className="px-4 pt-4 pb-3 border-b border-border space-y-2.5">
      <Link
        href={withShellParams("/dashboard/restaurant", {
          locationId: currentLocationId,
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

const PREFETCHED_SECTIONS: ReadonlySet<string> = new Set([
  "cockpit",
  "sales",
  "menu",
  "costs",
]);

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
  };
  lang: PreferredLanguage;
}) {
  const Icon = NAV_ICONS[item.id];
  const active = isPrimaryNavActive(item, pathname);
  const label = primaryNavLabel(item.id, lang);
  // R1-14: the four daily sections are prefetched in full once the page is
  // up, and their link carries the save epoch so a copy never outlives a save.
  const { epoch, warm } = useSectionWarmth();
  const fullPrefetch = PREFETCHED_SECTIONS.has(item.id);
  return (
    <li>
      <Link
        href={withSaveEpoch(
          withShellParams(item.href, shellParams),
          fullPrefetch ? epoch : 0
        )}
        prefetch={fullPrefetch && warm ? true : undefined}
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

/** ⚙ Configuración and "Fede · Cerrar sesión", pinned at the bottom. */
function SidebarFooter({
  pathname,
  shellParams,
  lang,
}: {
  pathname: string;
  shellParams: { locationId: string | null };
  lang: PreferredLanguage;
}) {
  const { userName } = useRestaurantShellChrome();
  const settings = PRIMARY_NAV_ITEMS.find(
    (item) => item.group === "data_settings"
  );
  return (
    <div className="px-3 pb-3 pt-2 space-y-1 border-t border-border">
      {settings ? (
        <ul>
          <SidebarLink
            item={settings}
            pathname={pathname}
            shellParams={shellParams}
            lang={lang}
          />
        </ul>
      ) : null}
      <div className="flex items-center gap-1 px-2.5 text-sm text-muted-foreground">
        {userName ? <span className="truncate">{userName} ·</span> : null}
        <LogoutButton lang={lang} variant="link" />
      </div>
    </div>
  );
}
