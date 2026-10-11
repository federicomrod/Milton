"use client";

// components/restaurant/kitchen/KitchenStaffCard.tsx
//
// Active cooks (name, location, joined date), read through the RLS-backed
// browser client (kitchen_staff has a member SELECT policy). Owners and
// Milton admins can remove a cook via DELETE /api/restaurant/kitchen/staff/[id].

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
        setError("No se pudieron cargar los cocineros.");
        return;
      }
      setCooks((data ?? []) as Cook[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const remove = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/restaurant/kitchen/staff/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) setError("No se pudo quitar al cocinero.");
    setReloadKey((k) => k + 1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cocineros</CardTitle>
        <CardDescription>
          Personal de cocina que se unió escaneando un QR.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {cooks.length === 0 && (
          <p className="text-sm text-muted-foreground">Aún no hay cocineros.</p>
        )}
        {cooks.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-2 border-b py-2 text-sm"
          >
            <div>
              <div className="font-medium">{c.display_name}</div>
              <div className="text-xs text-muted-foreground">
                {names.get(c.location_id) ?? "Ubicación desconocida"} · se unió{" "}
                {new Date(c.joined_at).toLocaleDateString("es-MX")}
              </div>
            </div>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => remove(c.id)}>
                Quitar
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
