"use client";

// Configuración › Conexiones: a status card for Odoo and one for Telegram,
// plus the «Subir ventas (archivo)» row. Reconectar and the upload panel open
// inline (1 click); nothing leaves the page except the Odoo connect flow.

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { ConfigValue } from "../ConfigSection";
import { TelegramConnectionCard } from "@/components/restaurant/TelegramConnectionCard";
import { PosSalesUploadPanel } from "@/components/restaurant/settings/PosSalesUploadPanel";
import {
  type ConnectionReason,
  type ConnectionStatus,
} from "./connection-status";

const CHIP: Record<ConnectionStatus, string> = {
  connected: "bg-[#A7F3D0] text-[#0F172A]",
  review: "bg-[#FDE68A] text-[#0F172A]",
  error: "bg-[#FBCFE8] text-[#0F172A]",
  none: "bg-[#F1F5F9] text-[#64748B]",
};

const BTN =
  "inline-flex h-9 items-center rounded-lg border border-[#1B40C8] bg-white px-3 text-sm font-semibold text-[#1B40C8] hover:bg-[#EEF2FD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]";

export function StatusChip({ status }: { status: ConnectionStatus }) {
  const { d } = useT();
  return (
    <span
      data-testid={`chip-${status}`}
      className={
        "rounded-md px-2 py-0.5 text-[12px] font-semibold " + CHIP[status]
      }
    >
      {d.config.sites.connections.status[status]}
    </span>
  );
}

function Card({
  title,
  status,
  children,
  testId,
}: {
  title: string;
  status: ConnectionStatus;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="min-w-0 space-y-2 rounded-lg border border-[#E5E7EB] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <StatusChip status={status} />
      </div>
      {children}
    </div>
  );
}

export function ConnectionCards({
  odoo,
  telegram,
  isAdmin,
  uploadOpen,
  lang,
}: {
  odoo: {
    status: ConnectionStatus;
    reason: ConnectionReason;
    lastSyncAt: string | null;
  };
  telegram: { status: ConnectionStatus; connectedAt: string | null };
  isAdmin: boolean;
  uploadOpen: boolean;
  lang: Parameters<typeof PosSalesUploadPanel>[0]["lang"];
}) {
  const { d, locale } = useT();
  const c = d.config.sites.connections;
  const s = d.config.shared;
  const [tgOpen, setTgOpen] = useState(false);
  const [upOpen, setUpOpen] = useState(!!uploadOpen);
  const when = (iso: string | null) => {
    if (!iso) return null;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime())
      ? null
      : dt.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  };
  return (
    <div className="space-y-3">
      <Card title={c.odoo} status={odoo.status} testId="conn-odoo">
        <dl className="space-y-2">
          <ConfigValue
            label={c.lastSync}
            value={when(odoo.lastSyncAt) ?? c.never}
            missing={s.missing}
          />
        </dl>
        <p className="text-[13px] text-[#64748B]">{c.reason[odoo.reason]}</p>
        <Link
          href={
            isAdmin ? "/management/odoo" : "/dashboard/restaurant/connect-data"
          }
          className={BTN}
        >
          {odoo.status === "none" ? c.connect : c.reconnect}
        </Link>
      </Card>

      <Card title={c.telegram} status={telegram.status} testId="conn-telegram">
        <dl className="space-y-2">
          <ConfigValue
            label={c.since}
            value={when(telegram.connectedAt)}
            missing={s.missing}
          />
        </dl>
        <p className="text-[13px] text-[#64748B]">
          {telegram.status === "none" ? c.telegramNone : c.telegramOk}
        </p>
        <button
          type="button"
          aria-expanded={tgOpen}
          onClick={() => setTgOpen((v) => !v)}
          className={BTN}
        >
          {tgOpen
            ? c.hide
            : telegram.status === "none"
              ? c.connect
              : c.reconnect}
        </button>
        {tgOpen ? <TelegramConnectionCard /> : null}
      </Card>

      <div
        data-testid="conn-sales"
        className="min-w-0 space-y-2 rounded-lg border border-[#E5E7EB] p-3"
      >
        <span className="text-sm font-semibold">{c.sales}</span>
        <div>
          <button
            type="button"
            aria-expanded={upOpen}
            onClick={() => setUpOpen((v) => !v)}
            className={BTN}
          >
            {upOpen ? c.hide : c.open}
          </button>
        </div>
        {upOpen ? <PosSalesUploadPanel lang={lang} /> : null}
      </div>
    </div>
  );
}
