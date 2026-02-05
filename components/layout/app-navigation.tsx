"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/dashboard/logout-button";
import {
  LayoutDashboard,
  BarChart,
  FileText,
  User,
  Settings,
  Database,
  Network,
  Shield,
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

  // Don't show navigation on auth pages, onboarding-required page, or while loading
  if (
    loading ||
    pathname?.startsWith("/auth/") ||
    pathname === "/onboarding-required"
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

  return (
    <header className="bg-background shadow-sm border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-6">
            <Link href={isAuthenticated ? "/dashboard" : "/"}>
              <h1 className="text-xl font-semibold text-foreground cursor-pointer hover:text-primary transition-colors">
                Milton
              </h1>
            </Link>

            {/* Main Navigation - only show if authenticated and not on root or management pages */}
            {isAuthenticated &&
              pathname !== "/" &&
              !pathname.startsWith("/management") && (
                <nav className="hidden md:flex items-center gap-1">
                  <Link href="/dashboard">
                    <Button
                      variant={
                        isActive("/dashboard") && pathname === "/dashboard"
                          ? "default"
                          : "ghost"
                      }
                      size="sm"
                      className="gap-2"
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      Dashboard
                    </Button>
                  </Link>
                  <Link href="/dashboard/analytics">
                    <Button
                      variant={
                        isActive("/dashboard/analytics") ? "default" : "ghost"
                      }
                      size="sm"
                      className="gap-2"
                    >
                      <BarChart className="h-4 w-4" />
                      Analytics
                    </Button>
                  </Link>
                  <Link href="/dashboard/reporting">
                    <Button
                      variant={
                        isActive("/dashboard/reporting") ? "default" : "ghost"
                      }
                      size="sm"
                      className="gap-2"
                    >
                      <FileText className="h-4 w-4" />
                      Reporting
                    </Button>
                  </Link>
                  <Link href="/dashboard/data">
                    <Button
                      variant={
                        isActive("/dashboard/data") ||
                        isActive("/dashboard/upload")
                          ? "default"
                          : "ghost"
                      }
                      size="sm"
                      className="gap-2"
                    >
                      <Database className="h-4 w-4" />
                      Data
                    </Button>
                  </Link>
                  <Link href="/dashboard/model">
                    <Button
                      variant={
                        isActive("/dashboard/model") ? "default" : "ghost"
                      }
                      size="sm"
                      className="gap-2"
                    >
                      <Network className="h-4 w-4" />
                      Model
                    </Button>
                  </Link>

                  {/* Management button for admin users */}
                  {isAdmin && (
                    <Link href="/management/dashboard">
                      <Button
                        variant={isActive("/management") ? "default" : "ghost"}
                        size="sm"
                        className="gap-2"
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
                  <Link href="/dashboard/settings">
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
