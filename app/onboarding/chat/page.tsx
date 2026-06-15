"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Restaurant pivot: the old generic finance onboarding chat is retired. This
// route is public (the proxy's redirect doesn't cover /onboarding/*), so we
// bounce client-side to the restaurant cockpit. Authenticated users land on
// the cockpit; unauthenticated users are then auth-gated by the proxy on
// /dashboard/restaurant and sent to /auth/login. The MiltonChat component is
// kept (not deleted) to avoid breaking imports.
export default function OnboardingChatPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/restaurant");
  }, [router]);

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Redirecting…</p>
      </div>
    </div>
  );
}
