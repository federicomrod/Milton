"use client";

import {
  canGrantRole,
  canManageMemberRole,
  DEFAULT_TEAM_ROLE,
  TEAM_ROLES,
  type Role,
} from "@/lib/auth/capabilities";

// components/restaurant/config/team/TeamPanel.tsx
//
// Configuración › Equipo y acceso. Two read-only lists on load (Gestión: web
// members + pending invites; Cocina: active cooks). The owner and admin (canManage) also
// gets Invitar / Cambiar rol / Quitar / Revocar / Reenviar, each inline: no modals, no confirm().

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n";
import { useConfig } from "../ConfigProvider";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  resendInvite,
  revokeInvite,
  type TeamActionError,
} from "@/app/dashboard/restaurant/data/team-actions";
import type { TeamCook, TeamInvite, TeamMember } from "./types";

const BTN =
  "inline-flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] disabled:opacity-50";
const BADGE =
  "inline-flex items-center rounded-full bg-[#E7EDFD] px-2 py-0.5 text-xs font-semibold text-[#1B40C8]";
const BTN_PRIMARY =
  "inline-flex h-9 items-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const CHIP =
  "inline-flex items-center rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-0.5 text-xs font-medium text-[#0F172A]";

export function TeamPanel({
  members,
  invites,
  cooks,
  canManage,
  actorRole = null,
  actorIsStaff = false,
}: {
  members: TeamMember[];
  invites: TeamInvite[];
  cooks: TeamCook[];
  canManage: boolean;
  /** The signed-in person's company role: which roles they may hand out. */
  actorRole?: string | null;
  actorIsStaff?: boolean;
}) {
  const { d, locale } = useT();
  const s = d.config.shared;
  const tm = d.config.team;
  const { notify } = useConfig();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [gone, setGone] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<TeamInvite[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(DEFAULT_TEAM_ROLE);
  const [created, setCreated] = useState<{
    link: string;
    email: string;
    emailSent: boolean;
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});

  const actor = { role: actorRole, isMiltonStaff: actorIsStaff };
  // Only the roles this person may hand out; Gerente is the default.
  const grantable = TEAM_ROLES.filter((r) => canGrantRole(actor, r));
  const defaultRole = grantable.includes(DEFAULT_TEAM_ROLE)
    ? DEFAULT_TEAM_ROLE
    : (grantable[grantable.length - 1] ?? DEFAULT_TEAM_ROLE);

  const errText = (e: TeamActionError) =>
    e === "email"
      ? tm.errInvalidEmail
      : e === "self"
        ? tm.errSelf
        : e === "last_owner"
          ? tm.errLastOwner
          : e === "forbidden"
            ? tm.errForbidden
            : e === "role_limit"
              ? tm.errRoleLimit
              : e === "role"
                ? tm.errInvalidRole
                : tm.errGeneric;

  const refresh = () => startTransition(() => router.refresh());

  const roleLabel = (r: Role) =>
    r === "owner"
      ? tm.roleOwner
      : r === "admin"
        ? tm.roleAdmin
        : r === "manager"
          ? tm.roleManager
          : r === "analyst"
            ? tm.roleAnalyst
            : r === "viewer"
              ? tm.roleReadOnly
              : tm.roleManagement;

  const visibleMembers = members.filter((m) => !gone.has(m.id));
  const visibleInvites = [
    ...added,
    ...invites.filter((i) => !added.some((a) => a.id === i.id)),
  ].filter((i) => !gone.has(i.id));

  async function doRemove(m: TeamMember) {
    setBusy(true);
    setError(null);
    const res = await removeMember(m.id);
    setBusy(false);
    if (!res.ok) {
      const text = errText(res.error);
      setError(text);
      notify(text, "error");
      return;
    }
    setGone((g) => new Set(g).add(m.id));
    setConfirm(null);
    notify(tm.removed);
    refresh();
  }

  async function doChangeRole(m: TeamMember, next: Role) {
    setBusy(true);
    setError(null);
    const res = await changeMemberRole(m.id, next);
    setBusy(false);
    if (!res.ok) {
      const text = errText(res.error);
      setError(text);
      notify(text, "error");
      return;
    }
    setRoles((r) => ({ ...r, [m.id]: next }));
    setEditing(null);
    notify(tm.roleChanged);
    refresh();
  }

  function shown(res: {
    inviteId: string;
    email: string;
    role: Role;
    expiresAt: string;
    link: string;
    emailSent: boolean;
  }) {
    setAdded((a) => [
      {
        id: res.inviteId,
        email: res.email,
        role: res.role,
        expiresAt: res.expiresAt,
      },
      ...a.filter((x) => x.email !== res.email),
    ]);
    setCreated({ link: res.link, email: res.email, emailSent: res.emailSent });
  }

  async function doResend(i: TeamInvite) {
    setBusy(true);
    setError(null);
    const res = await resendInvite(i.id);
    setBusy(false);
    if (!res.ok) {
      const text = errText(res.error);
      setError(text);
      notify(text, "error");
      return;
    }
    // The old row is revoked; the new one takes its place.
    setGone((g) => new Set(g).add(i.id));
    shown(res);
    notify(tm.resent);
    refresh();
  }

  async function doRevoke(i: TeamInvite) {
    setBusy(true);
    setError(null);
    const res = await revokeInvite(i.id);
    setBusy(false);
    if (!res.ok) {
      const text = errText(res.error);
      setError(text);
      notify(text, "error");
      return;
    }
    setGone((g) => new Set(g).add(i.id));
    setConfirm(null);
    notify(tm.revoked);
    refresh();
  }

  async function doInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await inviteMember(email, role);
    setBusy(false);
    if (!res.ok) {
      setError(errText(res.error));
      return;
    }
    shown(res);
    setEmail("");
    setInviting(false);
    notify(s.saved);
    refresh();
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      notify(tm.copied);
    } catch {
      notify(tm.errGeneric, "error");
    }
  }

  const dateText = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{tm.gestion}</h3>
          {canManage && !inviting ? (
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => {
                setInviting(true);
                setRole(defaultRole);
                setCreated(null);
                setError(null);
              }}
            >
              {tm.invite}
            </button>
          ) : null}
        </div>
        <p className="mb-2 text-[13px] text-[#64748B]">{tm.gestionHint}</p>

        {error ? (
          <p
            role="alert"
            className="mb-2 rounded-lg border border-[#0F172A] px-3 py-2 text-sm"
          >
            ⚑ {error}
          </p>
        ) : null}

        {canManage && inviting ? (
          <form
            onSubmit={doInvite}
            className="mb-3 space-y-2 rounded-lg border border-[#E5E7EB] p-3"
          >
            <p className="text-sm font-medium">{tm.inviteTitle}</p>
            <label className="block text-[13px] text-[#64748B]">
              {tm.email}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={tm.emailPlaceholder}
                className="mt-1 block h-9 w-full min-w-0 rounded-lg border border-[#E5E7EB] px-3 text-sm text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
              />
            </label>
            <label className="block text-[13px] text-[#64748B]">
              {tm.role}
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1 block h-9 w-full min-w-0 rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
              >
                {grantable.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <p
              data-testid="team-role-hint"
              className="-mt-1 text-[13px] text-[#64748B]"
            >
              {tm.roleHint}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={busy || email.trim() === ""}
                className={BTN_PRIMARY}
              >
                {busy ? tm.sending : tm.send}
              </button>
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  setInviting(false);
                  setError(null);
                }}
              >
                {tm.cancel}
              </button>
            </div>
          </form>
        ) : null}

        {canManage && created ? (
          <div
            data-testid="team-invite-link"
            className="mb-3 space-y-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3"
          >
            {!created.emailSent ? (
              <p
                role="alert"
                data-testid="team-email-failed"
                className="rounded-lg border border-[#0F172A] bg-white px-3 py-2 text-sm font-medium"
              >
                ⚑ {tm.emailNotSent}
              </p>
            ) : null}
            <p className="text-sm font-medium">{tm.linkTitle}</p>
            <p className="text-[13px] text-[#64748B]">
              {created.emailSent
                ? `${fmt(tm.emailSent, { email: created.email })} `
                : ""}
              {tm.linkNote}
            </p>
            <input
              readOnly
              value={created.link}
              onFocus={(e) => e.currentTarget.select()}
              className="block h-9 w-full min-w-0 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => copy(created.link)}
              >
                {tm.copy}
              </button>
              <button
                type="button"
                className={BTN}
                onClick={() => setCreated(null)}
              >
                {tm.cancel}
              </button>
            </div>
          </div>
        ) : null}

        {visibleMembers.length === 0 ? (
          <p className="text-sm text-[#64748B]">{tm.noMembers}</p>
        ) : (
          <ul className="divide-y divide-[#E5E7EB]">
            {visibleMembers.map((m) => {
              const label = m.isSupport
                ? d.support.team.label
                : m.name || m.email || tm.noName;
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <div className="break-words text-sm font-medium">
                      {label}
                      {m.isSelf ? (
                        <span className="ml-2 text-xs font-normal text-[#64748B]">
                          {tm.you}
                        </span>
                      ) : null}
                    </div>
                    {m.isSupport ? (
                      <div className="text-[13px] text-[#64748B]">
                        {d.support.team.note}
                      </div>
                    ) : null}
                    {!m.isSupport && m.name && m.email ? (
                      <div className="break-all text-[13px] text-[#64748B]">
                        {m.email}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={BADGE} data-testid="team-role-badge">
                      {roleLabel(roles[m.id] ?? m.role)}
                    </span>
                    {canManage &&
                    !m.isSelf &&
                    !m.isSupport &&
                    canManageMemberRole(actor, roles[m.id] ?? m.role) ? (
                      editing === m.id ? (
                        <select
                          aria-label={tm.changeRole}
                          value={roles[m.id] ?? m.role}
                          disabled={busy}
                          onChange={(e) =>
                            doChangeRole(m, e.target.value as Role)
                          }
                          className="h-9 rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
                        >
                          {grantable.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          className={BTN}
                          onClick={() => setEditing(m.id)}
                        >
                          {tm.changeRole}
                        </button>
                      )
                    ) : null}
                    {canManage &&
                    !m.isSelf &&
                    canManageMemberRole(actor, roles[m.id] ?? m.role) ? (
                      confirm === m.id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm">
                            {fmt(tm.removeAsk, { name: label })}
                          </span>
                          <button
                            type="button"
                            className={BTN_PRIMARY}
                            disabled={busy}
                            onClick={() => doRemove(m)}
                          >
                            {tm.yes}
                          </button>
                          <button
                            type="button"
                            className={BTN}
                            onClick={() => setConfirm(null)}
                          >
                            {tm.no}
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={BTN}
                          onClick={() => setConfirm(m.id)}
                        >
                          {tm.remove}
                        </button>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {visibleInvites.length > 0 ? (
          <div className="mt-3">
            <h4 className="mb-1 text-[13px] font-semibold text-[#64748B]">
              {tm.pending}
            </h4>
            {canManage ? (
              <p className="mb-1 text-[13px] text-[#64748B]">{tm.resendNote}</p>
            ) : null}
            <ul className="divide-y divide-[#E5E7EB]">
              {visibleInvites.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <div className="break-all text-sm font-medium">
                      {i.email}
                    </div>
                    <div className="text-[13px] text-[#64748B]">
                      {fmt(tm.expires, { date: dateText(i.expiresAt) })}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={BADGE} data-testid="team-role-badge">
                      {roleLabel(i.role)}
                    </span>
                    {canManage && canManageMemberRole(actor, i.role) ? (
                      confirm === i.id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm">
                            {fmt(tm.revokeAsk, { email: i.email })}
                          </span>
                          <button
                            type="button"
                            className={BTN_PRIMARY}
                            disabled={busy}
                            onClick={() => doRevoke(i)}
                          >
                            {tm.yes}
                          </button>
                          <button
                            type="button"
                            className={BTN}
                            onClick={() => setConfirm(null)}
                          >
                            {tm.no}
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={BTN}
                            disabled={busy}
                            onClick={() => doResend(i)}
                          >
                            {tm.resend}
                          </button>
                          <button
                            type="button"
                            className={BTN}
                            onClick={() => setConfirm(i.id)}
                          >
                            {tm.revoke}
                          </button>
                        </>
                      )
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!canManage ? (
          <p className="mt-2 text-[13px] text-[#64748B]">{s.readOnly}</p>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold">{tm.cocina}</h3>
        <p className="mb-2 text-[13px] text-[#64748B]">{tm.cocinaHint}</p>
        {cooks.length === 0 ? (
          <p className="text-sm text-[#64748B]">{tm.noCooks}</p>
        ) : (
          <ul className="divide-y divide-[#E5E7EB]">
            {cooks.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium">
                    {c.name}
                  </div>
                  <div className="break-words text-[13px] text-[#64748B]">
                    {c.location ?? tm.unknownSite}
                  </div>
                </div>
                <span className={CHIP}>
                  {c.via === "app" ? tm.viaApp : tm.viaTelegram}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
