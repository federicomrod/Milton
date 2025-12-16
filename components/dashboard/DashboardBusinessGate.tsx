"use client";

import React from "react";
import { useBusinessContext } from "@/lib/business-context";
import { BusinessTypeSelector } from "./BusinessTypeSelector";

type DashboardBusinessGateProps = {
  children: React.ReactNode;
};

export function DashboardBusinessGate({
  children,
}: DashboardBusinessGateProps) {
  const { businessType, isLoading } = useBusinessContext();

  // Show loading state while checking localStorage
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40">
        <div className="space-y-2 text-center">
          <div className="animate-pulse space-y-4">
            <div className="h-4 w-48 bg-muted rounded mx-auto" />
            <div className="h-3 w-32 bg-muted rounded mx-auto" />
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            Preparing your workspace…
          </p>
        </div>
      </div>
    );
  }

  // Show business type selector if not selected
  if (!businessType) {
    return <BusinessTypeSelector />;
  }

  // Business type is selected, render the dashboard
  return <>{children}</>;
}
