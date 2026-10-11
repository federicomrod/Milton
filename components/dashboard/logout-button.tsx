"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

export function LogoutButton({
  lang = "en",
}: {
  lang?: PreferredLanguage;
} = {}) {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

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
