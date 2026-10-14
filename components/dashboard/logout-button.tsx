"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

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
        {t(lang, "Log out", "Cerrar sesión")}
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
      {t(lang, "Logout", "Cerrar sesión")}
    </Button>
  );
}
