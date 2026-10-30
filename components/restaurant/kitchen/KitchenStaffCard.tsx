"use client";

// components/restaurant/kitchen/KitchenStaffCard.tsx
//
// Active cooks (name, location, joined date), read through the RLS-backed
// browser client (kitchen_staff has a member SELECT policy). Owners and
// Milton admins can remove a cook via DELETE /api/restaurant/kitchen/staff/[id].

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";
import { t } from "@/lib/restaurant/language";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Cook {
  id: string;
  display_name: string;
  location_id: string;
  joined_at: string;
}

export function KitchenStaffCard({
  canManage,
  locations,
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
}) {
  const { lang, locale } = useT();
  const [cooks, setCooks] = useState<Cook[]>([]);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(locations.map((l) => [l.id, l.name]));

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: loadError } = await createClient()
        .from("kitchen_staff")
        .select("id, display_name, location_id, joined_at")
        .eq("is_active", true)
        .order("joined_at", { ascending: false });
      if (cancelled) return;
      if (loadError) {
        setError(
          t(
            lang,
            "Could not load the cooks.",
            "No se pudieron cargar los cocineros.",
            "Die Köche konnten nicht geladen werden."
          )
        );
        return;
      }
      setCooks((data ?? []) as Cook[]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const remove = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/restaurant/kitchen/staff/${id}`, {
      method: "DELETE",
    });
    if (!res.ok)
      setError(
        t(
          lang,
          "Could not remove the cook.",
          "No se pudo quitar al cocinero.",
          "Der Koch konnte nicht entfernt werden."
        )
      );
    setReloadKey((k) => k + 1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(lang, "Cooks", "Cocineros", "Köche")}</CardTitle>
        <CardDescription>
          {t(
            lang,
            "Kitchen staff who joined by scanning a QR.",
            "Personal de cocina que se unió escaneando un QR.",
            "Küchenpersonal, das per QR-Code beigetreten ist."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {cooks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t(
              lang,
              "There are no cooks yet.",
              "Aún no hay cocineros.",
              "Es gibt noch keine Köche."
            )}
          </p>
        )}
        {cooks.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-2 border-b py-2 text-sm"
          >
            <div>
              <div className="font-medium">{c.display_name}</div>
              <div className="text-xs text-muted-foreground">
                {names.get(c.location_id) ??
                  t(
                    lang,
                    "Unknown location",
                    "Ubicación desconocida",
                    "Unbekannter Standort"
                  )}{" "}
                · {t(lang, "joined", "se unió", "beigetreten am")}{" "}
                {new Date(c.joined_at).toLocaleDateString(locale)}
              </div>
            </div>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => remove(c.id)}>
                {t(lang, "Remove", "Quitar", "Entfernen")}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
