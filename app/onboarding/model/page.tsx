"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Restaurant pivot: the old onboarding model-builder is retired. This route is
// public (the proxy's redirect doesn't cover it), so we bounce client-side to
// the restaurant cockpit. The page is kept (not deleted) to avoid breaking any
// direct links or imports.
export default function OnboardingModelPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/restaurant");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Redirecting…</p>
      </div>
    </div>
  );
}
