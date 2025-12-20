"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  getOnboardingStatus,
  type OnboardingStatus,
} from "@/lib/onboarding-status";
import { DataStatusProvider } from "@/lib/context/DataStatusContext";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isChecking, setIsChecking] = useState(true);

  // Data status refresh function for the provider
  const refreshDataStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/data/status");
      if (res.ok) {
        const json = await res.json();
        // Dispatch event for components that listen to it
        document.dispatchEvent(
          new CustomEvent("data-status:refresh", { detail: json })
        );
      }
    } catch (error) {
      console.error("Failed to refresh data status:", error);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const checkStatus = async () => {
      try {
        const status = await getOnboardingStatus();

        if (!mounted) return;

        // If onboarding is complete, redirect to dashboard
        if (status === "completed") {
          router.replace("/dashboard");
          return;
        }

        // For chat page, allow it to handle its own status - don't block it
        if (pathname === "/onboarding/chat") {
          setIsChecking(false);
          return;
        }

        // Define the flow order
        const flowOrder: OnboardingStatus[] = [
          "not_started",
          "chat",
          "kpi_selection",
          "upload",
          "model",
        ];

        // Map paths to statuses
        const pathToStatus: Record<string, OnboardingStatus> = {
          "/onboarding": "chat",
          "/onboarding/chat": "chat",
          "/onboarding/kpi-selection": "kpi_selection",
          "/onboarding/upload": "upload",
          "/onboarding/model": "model",
        };

        const currentPathStatus = pathToStatus[pathname] || null;
        const statusIndex = flowOrder.indexOf(status);

        // Redirect map for status-based routing
        const redirectMap: Record<OnboardingStatus, string> = {
          not_started: "/onboarding/chat",
          chat: "/onboarding/chat",
          kpi_selection: "/onboarding/kpi-selection",
          upload: "/onboarding/upload",
          model: "/onboarding/model",
          completed: "/dashboard",
        };

        // Only redirect if user is trying to skip ahead to a future step
        if (currentPathStatus && statusIndex >= 0) {
          const currentIndex = flowOrder.indexOf(currentPathStatus);
          // Only redirect if trying to skip ahead (not if on same or previous step)
          if (currentIndex > statusIndex) {
            router.replace(redirectMap[status]);
            return;
          }
        }

        setIsChecking(false);
      } catch (error) {
        console.error("Error checking onboarding status:", error);
        if (mounted) {
          setIsChecking(false);
        }
      }
    };

    checkStatus();

    return () => {
      mounted = false;
    };
  }, [pathname, router]);

  if (isChecking) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <DataStatusProvider value={{ refreshDataStatus }}>
      {children}
    </DataStatusProvider>
  );
}
