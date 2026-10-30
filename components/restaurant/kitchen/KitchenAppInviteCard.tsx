"use client";

// components/restaurant/kitchen/KitchenAppInviteCard.tsx
//
// «App Milton Cocina»: the owner invites a cook to the app from the web.
// Per location: optional cook name + «Invitar a la app». The code and link are
// shown once (state only, never stored); the list below never has a secret.
// Revoking asks inline, no pop-ups.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRestaurantShellChrome } from "@/components/restaurant/shell/shell-chrome-context";
import {
  appInviteCopy,
  inviteLang,
  type InviteLang,
} from "@/lib/restaurant/kitchen/app-invite-copy";
import {
  createAppInvite,
  listAppInvites,
  revokeAppInvite,
  type AppInviteRow,
} from "@/app/dashboard/restaurant/kitchen/app-invite-actions";

const LOCALES: Record<InviteLang, string> = {
  es: "es-MX",
  en: "en-US",
  de: "de-DE",
};

interface Created {
  code: string;
  link: string;
  locationName: string;
}

export function KitchenAppInviteCard({
  locations,
}: {
  locations: { id: string; name: string }[];
}) {
  const lang = inviteLang(useRestaurantShellChrome().lang);
  const c = appInviteCopy(lang);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [invites, setInvites] = useState<AppInviteRow[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listAppInvites();
    if (res.ok) setInvites(res.invites);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const locationName = (id: string) =>
    locations.find((l) => l.id === id)?.name ?? "";

  const invite = async (loc: { id: string; name: string }) => {
    setBusyId(loc.id);
    setError(null);
    setCopied(null);
    try {
      const res = await createAppInvite(loc.id, names[loc.id]?.trim());
      if (!res.ok) {
        setCreated(null);
        setError(c.errors[res.error]);
        return;
      }
      setCreated({
        code: res.code,
        link: `${window.location.origin}/k/${res.code}`,
        locationName: loc.name,
      });
      setNames((n) => ({ ...n, [loc.id]: "" }));
      await reload();
    } catch {
      setError(c.errors.error);
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (kind: "code" | "link") => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(
        kind === "code" ? created.code : created.link
      );
      setCopied(kind);
    } catch {
      setCopied(null);
    }
  };

  const revoke = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await revokeAppInvite(id);
      if (!res.ok) setError(c.errors[res.error]);
      setConfirmId(null);
      await reload();
    } catch {
      setError(c.errors.error);
    } finally {
      setBusyId(null);
    }
  };

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(LOCALES[lang], {
      day: "numeric",
      month: "short",
    });

  return (
    <Card data-testid="kitchen-app-invite-card">
      <CardHeader>
        <CardTitle>{c.title}</CardTitle>
        <CardDescription>{c.intro}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p
            className="rounded-md border border-border px-3 py-2 text-sm text-[#0F172A]"
            role="status"
          >
            {error}
          </p>
        ) : null}
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.noLocations}</p>
        ) : null}
        {locations.map((loc) => (
          <div
            key={loc.id}
            className="flex flex-wrap items-center gap-2 border-b border-[#E5E7EB] pb-3"
          >
            <span className="min-w-[8rem] text-sm font-medium text-[#0F172A]">
              {loc.name}
            </span>
            <Input
              value={names[loc.id] ?? ""}
              onChange={(e) =>
                setNames((n) => ({ ...n, [loc.id]: e.target.value }))
              }
              placeholder={c.namePlaceholder}
              maxLength={128}
              aria-label={`${c.namePlaceholder} · ${loc.name}`}
              className="h-9 min-w-[10rem] flex-1"
            />
            <Button
              type="button"
              size="sm"
              disabled={busyId === loc.id}
              onClick={() => void invite(loc)}
              className="bg-[#1B40C8] text-white hover:bg-[#1533A3]"
            >
              {c.invite}
            </Button>
          </div>
        ))}

        {created ? (
          <div
            data-testid="kitchen-app-invite-created"
            className="space-y-2 rounded-md bg-[#A7F3D0] px-3 py-3 text-[#0F172A]"
          >
            <p className="text-xs font-semibold">
              {created.locationName} · {c.validity}
            </p>
            <p className="text-xs">{c.codeLabel}</p>
            <p
              data-testid="kitchen-app-invite-code"
              className="break-all font-mono text-sm font-semibold"
            >
              {created.code}
            </p>
            <p className="text-xs">{c.linkLabel}</p>
            <p className="break-all font-mono text-xs">{created.link}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                className="bg-[#1B40C8] text-white hover:bg-[#1533A3]"
                onClick={() => void copy("code")}
              >
                {copied === "code" ? c.copied : c.copyCode}
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-[#1B40C8] text-white hover:bg-[#1533A3]"
                onClick={() => void copy("link")}
              >
                {copied === "link" ? c.copied : c.copyLink}
              </Button>
              <span className="text-xs">{c.once}</span>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#0F172A]">
            {c.pendingTitle}
          </h3>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">{c.none}</p>
          ) : null}
          {invites.map((inv) => (
            <div
              key={inv.id}
              data-testid="kitchen-app-invite-row"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] py-2 text-sm"
            >
              <div>
                <div className="font-medium text-[#0F172A]">
                  {inv.inviteeName ?? c.anyCook}
                </div>
                <div className="text-xs text-muted-foreground">
                  {locationName(inv.locationId)} · {c.expires}{" "}
                  {date(inv.expiresAt)} · {c.status[inv.status]}
                </div>
              </div>
              {inv.status === "pending" ? (
                confirmId === inv.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#0F172A]">
                      {c.revokeConfirm}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === inv.id}
                      className="bg-[#1B40C8] text-white hover:bg-[#1533A3]"
                      onClick={() => void revoke(inv.id)}
                    >
                      {c.revokeYes}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmId(null)}
                    >
                      {c.revokeNo}
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmId(inv.id)}
                  >
                    {c.revoke}
                  </Button>
                )
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
