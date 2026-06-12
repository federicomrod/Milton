"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/dashboard/logout-button";
import {
  LayoutDashboard,
  User,
  Settings,
  Shield,
  Flame,
  Upload,
  Target,
  BookOpen,
  Carrot,
  Receipt,
  Sparkles,
  ChevronDown,
  Archive,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function AppNavigation() {
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setIsAuthenticated(!!user);

        // Check if user is admin
        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("user_id", user.id)
            .single();
          setIsAdmin(profile?.role === "admin");
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        // If Supabase is not configured (e.g., in tests or CI without env vars),
        // treat user as not authenticated
        console.warn("Auth check failed, assuming not authenticated:", error);
        setIsAuthenticated(false);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [pathname]);

  // Don't show navigation on auth pages, onboarding-required page, root page, or while loading.
  // Also suppress on the restaurant cockpit and all of its sub-routes — those use the
  // dedicated left-sidebar shell (components/restaurant/RestaurantShell.tsx) and would
  // otherwise stack a redundant top nav above it.
  if (
    loading ||
    pathname?.startsWith("/auth/") ||
    pathname === "/onboarding-required" ||
    pathname === "/" ||
    pathname?.startsWith("/dashboard/restaurant")
  ) {
    return null;
  }

  // Show navigation even if not authenticated (but with limited options)
  // Or redirect to login if needed
  const isActive = (path: string) => {
    if (path === "/dashboard" && pathname === "/dashboard") return true;
    if (path === "/management" && pathname?.startsWith("/management"))
      return true;
    if (
      path !== "/dashboard" &&
      path !== "/management" &&
      pathname?.startsWith(path)
    )
      return true;
    return false;
  };

  // ---- Nav structure --------------------------------------------------
  //
  // Milton is now a restaurant cockpit; the primary nav is restaurant-first.
  // Legacy CFO-style routes (Analytics / Reporting / Data Uploads / Model /
  // Scenarios) are still reachable but moved behind a "Legacy" dropdown so
  // they don't dominate the visual hierarchy. We do NOT delete those routes
  // — they still serve existing data and old links — they just stop being
  // primary navigation.
  const primaryNav: {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    /** Hash to scroll to inside /dashboard/restaurant — only used for the
     *  Sales Analytics / Targets shortcuts. */
    sectionHash?: string;
  }[] = [
    { href: "/dashboard/restaurant", label: "Cockpit", icon: LayoutDashboard },
    {
      href: "/dashboard/restaurant/upload",
      label: "Import POS Sales",
      icon: Upload,
    },
    {
      href: "/dashboard/restaurant",
      label: "Sales Analytics",
      icon: Flame,
      sectionHash: "channels",
    },
    {
      href: "/dashboard/restaurant",
      label: "Targets",
      icon: Target,
      sectionHash: "targets",
    },
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
      href: "/dashboard/restaurant/invoices",
      label: "Supplier Invoices",
      icon: Receipt,
    },
    { href: "/dashboard/restaurant/agents", label: "Agents", icon: Sparkles },
  ];

  const legacyNav: { href: string; label: string }[] = [
    { href: "/dashboard", label: "Legacy Dashboard" },
    { href: "/dashboard/analytics", label: "Analytics" },
    { href: "/dashboard/reporting", label: "Reporting" },
    { href: "/dashboard/data", label: "Data Uploads" },
    { href: "/dashboard/model", label: "Model (Paused)" },
    { href: "/dashboard/scenarios", label: "Scenarios" },
  ];

  // Highlight rule: section-shortcut links (those that share a base href
  // with another primary item) should ONLY light up when the URL hash
  // matches their sectionHash. The plain Cockpit link lights up for any
  // /dashboard/restaurant URL without a sectionHash already claiming it.
  const isPrimaryActive = (item: (typeof primaryNav)[number]): boolean => {
    if (item.sectionHash) return false; // hash routes don't show server-side active state
    if (item.href === "/dashboard/restaurant") {
      // "Cockpit" — active on exactly /dashboard/restaurant (not sub-routes)
      return pathname === "/dashboard/restaurant";
    }
    return (
      pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false)
    );
  };

  return (
    <header className="bg-background shadow-sm border-b border-border sticky top-0 z-50">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-10">
        <div className="flex justify-between items-center h-16 gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <Link href={isAuthenticated ? "/dashboard/restaurant" : "/"}>
              <div className="flex items-center gap-2 cursor-pointer">
                <Image
                  src="/Milton_Logo.png"
                  alt="Milton"
                  width={28}
                  height={28}
                />
                <span className="text-xl font-bold text-foreground">
                  milton.
                </span>
              </div>
            </Link>

            {/* Main Navigation - restaurant-first; legacy items live in
                a dropdown so the primary row stays readable. */}
            {isAuthenticated &&
              pathname !== "/" &&
              !pathname.startsWith("/management") && (
                <nav className="hidden lg:flex items-center gap-1 overflow-x-auto">
                  {primaryNav.map((item) => {
                    const Icon = item.icon;
                    const active = isPrimaryActive(item);
                    const href = item.sectionHash
                      ? `${item.href}#${item.sectionHash}`
                      : item.href;
                    return (
                      <Link key={item.label} href={href}>
                        <Button
                          variant={active ? "default" : "ghost"}
                          size="sm"
                          className="gap-2 whitespace-nowrap"
                        >
                          <Icon className="h-4 w-4" />
                          {item.label}
                        </Button>
                      </Link>
                    );
                  })}

                  {/* Legacy dropdown — hover-based on desktop, focus on
                      keyboard. Renders inline via the `group` pattern so
                      we don't need a portal/popover dependency. */}
                  <div className="relative group">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 whitespace-nowrap text-muted-foreground"
                    >
                      <Archive className="h-4 w-4" />
                      Legacy
                      <ChevronDown className="h-3 w-3 opacity-70" />
                    </Button>
                    <div className="absolute right-0 top-full mt-1 hidden group-hover:block group-focus-within:block bg-background border border-border rounded-md shadow-md min-w-[200px] py-1 z-50">
                      {legacyNav.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={
                            "block px-3 py-2 text-sm hover:bg-muted " +
                            (pathname === item.href
                              ? "text-foreground font-medium"
                              : "text-muted-foreground")
                          }
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </div>

                  {/* Management button for admin users */}
                  {isAdmin && (
                    <Link href="/management/dashboard">
                      <Button
                        variant={isActive("/management") ? "default" : "ghost"}
                        size="sm"
                        className="gap-2 whitespace-nowrap"
                      >
                        <Shield className="h-4 w-4" />
                        Management
                      </Button>
                    </Link>
                  )}
                </nav>
              )}
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              pathname === "/" ? (
                // On root page, show only "Go to App" button
                <Link href="/dashboard">
                  <Button size="sm" variant="default" className="gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    Go to App
                  </Button>
                </Link>
              ) : (
                // On other pages, show Account, Settings, Logout
                <>
                  <Link href="/dashboard/account">
                    <Button
                      variant={
                        isActive("/dashboard/account") ? "default" : "ghost"
                      }
                      size="sm"
                      className="gap-2"
                    >
                      <User className="h-4 w-4" />
                      Account
                    </Button>
                  </Link>
                  <Link href="/dashboard/settings" prefetch={false}>
                    <Button
                      variant={
                        isActive("/dashboard/settings") ? "default" : "ghost"
                      }
                      size="sm"
                      className="gap-2"
                    >
                      <Settings className="h-4 w-4" />
                      Settings
                    </Button>
                  </Link>
                  <LogoutButton />
                </>
              )
            ) : (
              <>
                <Link href="/auth/login">
                  <Button size="sm" variant="ghost">
                    Sign in
                  </Button>
                </Link>
                <Link href="/auth/signup">
                  <Button size="sm" variant="default">
                    Get started
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
