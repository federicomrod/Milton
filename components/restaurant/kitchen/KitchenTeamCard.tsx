"use client";

// components/restaurant/kitchen/KitchenTeamCard.tsx
//
// Kitchen team tools for owner, admin and manager (Configuración › Equipo):
// per cook, «Restablecer PIN» (a temporary PIN they must change, or no PIN),
// «Enviar nuevo enlace» (the same cook, history kept) and «Cerrar sesión en
// este teléfono». A temporary PIN and a link are shown once, in state only.
// Confirmation is inline, no pop-ups.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRestaurantShellChrome } from "@/components/restaurant/shell/shell-chrome-context";
import { inviteLang } from "@/lib/restaurant/kitchen/app-invite-copy";
import { kitchenTeamCopy } from "@/lib/restaurant/kitchen/team-copy";
import type { TeamMember } from "@/lib/restaurant/kitchen/team-admin";
import {
  listKitchenTeamAction,
  resetKitchenPinAction,
  sendNewKitchenLinkAction,
  signOutKitchenPhoneAction,
} from "@/app/dashboard/restaurant/kitchen/team-actions";

type Pending =
  | { kind: "clear" | "temporary" | "link" | "all"; staffId: string }
  | { kind: "phone"; staffId: string; deviceId: string };

interface Shown {
  staffId: string;
  kind: "pin" | "link";
  value: string;
}

const LINK_BTN =
  "inline-flex min-h-[40px] items-center rounded-md border border-[#1B40C8] px-3 text-sm font-semibold text-[#1B40C8] hover:bg-[#E7EDFD] disabled:opacity-60";

export function KitchenTeamCard({
  locations,
}: {
  locations: { id: string; name: string }[];
}) {
  const lang = inviteLang(useRestaurantShellChrome().lang);
  const c = kitchenTeamCopy(lang);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [kitchenCode, setKitchenCode] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listKitchenTeamAction();
    if (res.ok) {
      setTeam(res.team);
      setKitchenCode(res.kitchenCode);
    } else setError(c.errors[res.error]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const locationName = (id: string) =>
    locations.find((l) => l.id === id)?.name ?? "";

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    setShown(null);
    setCopied(false);
    try {
      if (pending.kind === "temporary" || pending.kind === "clear") {
        const res = await resetKitchenPinAction(pending.staffId, pending.kind);
        if (!res.ok) setError(c.errors[res.error]);
        else if (res.temporaryPin)
          setShown({
            staffId: pending.staffId,
            kind: "pin",
            value: res.temporaryPin,
          });
      } else if (pending.kind === "link") {
        const res = await sendNewKitchenLinkAction(pending.staffId);
        if (!res.ok) setError(c.errors[res.error]);
        else
          setShown({
            staffId: pending.staffId,
            kind: "link",
            value: `${window.location.origin}/k/${res.code}`,
          });
      } else {
        const res = await signOutKitchenPhoneAction(
          pending.staffId,
          pending.kind === "phone" ? pending.deviceId : null
        );
        if (!res.ok) setError(c.errors[res.error]);
      }
      setPending(null);
      await reload();
    } catch {
      setError(c.errors.error);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const confirmRow = (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => void run()}
        className="bg-[#1B40C8] text-white hover:bg-[#1533A3]"
      >
        {c.confirm}
      </Button>
      <button
        type="button"
        className={LINK_BTN}
        onClick={() => setPending(null)}
      >
        {c.cancel}
      </button>
    </div>
  );

  return (
    <Card data-testid="kitchen-team-card">
      <CardHeader>
        <CardTitle>{c.title}</CardTitle>
        <CardDescription>{c.intro}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p
            role="status"
            className="rounded-md border border-border px-3 py-2 text-sm text-[#0F172A]"
          >
            {error}
          </p>
        ) : null}
        {kitchenCode ? (
          <div className="text-sm text-[#0F172A]">
            <span className="font-medium">{c.kitchenCode}: </span>
            <span
              data-testid="kitchen-code"
              className="font-mono font-semibold tracking-widest"
            >
              {kitchenCode}
            </span>
            <p className="text-xs text-muted-foreground">{c.kitchenCodeHint}</p>
          </div>
        ) : null}
        {team.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.none}</p>
        ) : null}
        {team.map((m) => (
          <div
            key={m.id}
            data-testid={`team-member-${m.id}`}
            className="space-y-2 border-b border-[#E5E7EB] pb-3"
          >
            <div>
              <p className="text-sm font-medium text-[#0F172A]">
                {m.name}{" "}
                <span className="font-normal text-muted-foreground">
                  · {locationName(m.locationId)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {m.hasPin ? c.hasPin : c.noPin}
                {m.pinMustChange ? ` · ${c.mustChange}` : ""}
                {" · "}
                {m.devices.length === 0
                  ? c.noPhones
                  : `${c.phones}: ${m.devices.length}`}
              </p>
            </div>

            {m.devices.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              >
                <span>
                  {d.label ?? d.platform ?? "—"} · {c.lastSeen}{" "}
                  {d.lastSeenAt
                    ? new Date(d.lastSeenAt).toLocaleDateString()
                    : c.never}
                </span>
                <button
                  type="button"
                  className={LINK_BTN}
                  onClick={() =>
                    setPending({ kind: "phone", staffId: m.id, deviceId: d.id })
                  }
                >
                  {c.signOutPhone}
                </button>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => setPending({ kind: "temporary", staffId: m.id })}
              >
                {c.resetPin} · {c.temporaryPin}
              </button>
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => setPending({ kind: "clear", staffId: m.id })}
              >
                {c.clearPin}
              </button>
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => setPending({ kind: "link", staffId: m.id })}
              >
                {c.newLink}
              </button>
              {m.devices.length > 1 ? (
                <button
                  type="button"
                  className={LINK_BTN}
                  onClick={() => setPending({ kind: "all", staffId: m.id })}
                >
                  {c.signOutAll}
                </button>
              ) : null}
            </div>

            {pending && pending.staffId === m.id ? confirmRow : null}

            {shown && shown.staffId === m.id ? (
              <div
                data-testid={`team-shown-${shown.kind}`}
                className="space-y-1 rounded-md border border-[#1B40C8] bg-[#E7EDFD] px-3 py-3 text-[#0F172A]"
              >
                <p className="text-xs font-semibold">
                  {shown.kind === "pin" ? c.pinShownOnce : c.linkShownOnce}
                </p>
                <p className="break-all font-mono text-sm font-semibold">
                  {shown.value}
                </p>
                <p className="text-xs">
                  {shown.kind === "pin" ? c.pinMustChangeNote : c.linkNote}
                </p>
                <button
                  type="button"
                  className={LINK_BTN}
                  onClick={() => void copy(shown.value)}
                >
                  {copied ? c.copied : c.copy}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
