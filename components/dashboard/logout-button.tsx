"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { getDictionary } from "@/lib/i18n";

export function LogoutButton({
  lang = "en",
  variant = "button",
}: {
  lang?: PreferredLanguage;
  /** "link": plain text, for the sidebar footer ("Fede · Cerrar sesión"). */
  variant?: "button" | "link";
} = {}) {
  const router = useRouter();
  const supabase = createClient();

  const label = getDictionary(lang).shell.sidebar.logOut;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={handleLogout}
        className="py-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        {label}
      </button>
    );
  }

  return (
    <Button
      onClick={handleLogout}
      variant="ghost"
      size="sm"
      className="text-gray-600 hover:text-gray-900"
    >
      <LogOut className="h-4 w-4 mr-2" />
      {label}
    </Button>
  );
}
