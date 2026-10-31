"use client";

// «Clientes»: every company with «Abrir cuenta» and the last support opens.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { openClientAccountAction } from "@/app/dashboard/restaurant/support-actions";
import type { SupportOpenRow } from "@/lib/support/support-access";

export function ClientsList({
  companies,
  loadFailed,
  opens,
  activeCompanyId,
}: {
  companies: Array<{ id: string; name: string }>;
  loadFailed: boolean;
  opens: SupportOpenRow[];
  activeCompanyId: string | null;
}) {
  const { d, locale } = useT();
  const c = d.support.clients;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await openClientAccountAction(id);
      if (res.ok) {
        window.location.assign("/dashboard/restaurant");
        return;
      }
      setError(c.errors[res.error]);
    } catch {
      setError(c.errors.failed);
    }
    setBusyId(null);
  };

  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-8" data-testid="support-clients">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{c.intro}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border px-3 py-2 text-sm">
          ⚑ {error}
        </p>
      ) : null}

      <section className="rounded-xl border bg-card">
        {loadFailed ? (
          <p className="p-4 text-sm">{c.loadFailed}</p>
        ) : companies.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{c.none}</p>
        ) : (
          <ul className="divide-y">
            {companies.map((co) => (
              <li
                key={co.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <span className="min-w-0 break-words text-sm font-medium">
                  {co.name}
                </span>
                {co.id === activeCompanyId ? (
                  <span className="text-xs text-muted-foreground">
                    {c.current}
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void open(co.id)}
                    className="bg-[#1B40C8] text-white hover:bg-[#1533A3]"
                  >
                    {busyId === co.id ? c.opening : c.open}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{c.recentTitle}</h2>
        {opens.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.recentNone}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{c.colWho}</th>
                  <th className="px-4 py-2 font-medium">{c.colCompany}</th>
                  <th className="px-4 py-2 font-medium">{c.colWhen}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {opens.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2">{o.userEmail ?? "—"}</td>
                    <td className="px-4 py-2">{o.companyName}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {when(o.openedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
