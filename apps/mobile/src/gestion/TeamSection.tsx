// «Equipo de cocina» in Perfil (owner, admin, manager): the kitchen code, and
// per cook: Restablecer PIN, Enviar nuevo enlace, Cerrar sesión en un teléfono.
// Destructive steps ask once, inline. A temporary PIN is shown ONCE.

import React, { useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import { Button, Card, Muted } from "../components/ui";
import { fmt } from "../i18n/strings";
import { colors, fonts, space, tint } from "../theme";
import { useG, useLoad } from "./hooks";
import { useManager } from "./ManagerProvider";
import type { KitchenTeamMember } from "./types";

type Pending =
  | { kind: "clear"; staffId: string }
  | { kind: "signout"; staffId: string; deviceId: string; label: string };

export function TeamSection() {
  const g = useG();
  const t = g.profile.team;
  const m = useManager();
  const team = useLoad("kitchen-team", () => m.api.kitchenTeam());
  const [panel, setPanel] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [temp, setTemp] = useState<{ staffId: string; pin: string } | null>(
    null
  );
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      setNote(await work());
      team.reload();
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const members = team.data?.team ?? [];
  const code = team.data?.kitchenCode ?? null;
  if (team.loading || !team.data) {
    // A failed read (or a role without rights) just leaves the section out.
    return null;
  }

  function resetTemporary(member: KitchenTeamMember) {
    void run(async () => {
      const res = await m.api.resetPin(member.id, "temporary");
      if (res.temporaryPin)
        setTemp({ staffId: member.id, pin: res.temporaryPin });
      setPanel(null);
      return null;
    });
  }

  return (
    <View style={st.wrap}>
      <Text style={st.label}>{t.title}</Text>
      {code ? (
        <Card style={st.card}>
          <Muted>{t.codeLabel}</Muted>
          <Text selectable style={st.code}>
            {code}
          </Text>
          <Button
            label={t.codeShare}
            variant="secondary"
            icon="share-outline"
            onPress={() =>
              void Share.share({ message: fmt(t.codeMessage, { code }) })
            }
          />
        </Card>
      ) : null}
      {members.length === 0 ? <Muted>{t.empty}</Muted> : null}
      {members.map((member) => {
        const phones =
          member.devices.length === 0
            ? t.phonesNone
            : member.devices.length === 1
              ? t.phonesOne
              : fmt(t.phonesCount, { n: member.devices.length });
        const pinText = member.pinMustChange
          ? t.tempPin
          : member.hasPin
            ? t.hasPin
            : t.noPin;
        return (
          <Card key={member.id} style={st.card}>
            <Text style={st.name}>
              {member.name}
              {member.isSelf ? ` (${t.you})` : ""}
            </Text>
            <Muted>{`${pinText} · ${phones}`}</Muted>

            {temp?.staffId === member.id ? (
              <View style={st.temp}>
                <Muted>{fmt(t.tempTitle, { name: member.name })}</Muted>
                <Text selectable style={st.pin}>
                  {temp.pin}
                </Text>
                <Muted>{fmt(t.tempNote, { name: member.name })}</Muted>
                <Button
                  label={t.tempDone}
                  variant="secondary"
                  onPress={() => setTemp(null)}
                />
              </View>
            ) : null}

            {pending?.kind === "clear" && pending.staffId === member.id ? (
              <View style={st.temp}>
                <Muted>{fmt(t.clearAsk, { name: member.name })}</Muted>
                <Button
                  label={t.clearYes}
                  busy={busy}
                  onPress={() =>
                    void run(async () => {
                      await m.api.resetPin(member.id, "clear");
                      setPanel(null);
                      return fmt(t.cleared, { name: member.name });
                    })
                  }
                />
                <Button
                  label={t.cancel}
                  variant="secondary"
                  onPress={() => setPending(null)}
                />
              </View>
            ) : null}

            {panel === member.id && pending?.kind !== "clear" ? (
              <View style={st.temp}>
                <Button
                  label={t.resetTemp}
                  busy={busy}
                  onPress={() => resetTemporary(member)}
                />
                <Button
                  label={t.resetClear}
                  variant="secondary"
                  onPress={() =>
                    setPending({ kind: "clear", staffId: member.id })
                  }
                />
                <Button
                  label={t.cancel}
                  variant="secondary"
                  onPress={() => setPanel(null)}
                />
              </View>
            ) : (
              <Button
                label={t.resetPin}
                variant="secondary"
                icon="keypad-outline"
                onPress={() => {
                  setPanel(member.id);
                  setPending(null);
                  setTemp(null);
                }}
              />
            )}

            <Button
              label={t.newLink}
              variant="secondary"
              icon="link-outline"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const res = await m.api.newLink(member.id).catch(() => null);
                  if (!res) return t.newLinkFailed;
                  await Share.share({ message: res.inviteUrl });
                  return null;
                })
              }
            />

            {member.devices.map((d) => {
              const label = d.label || t.phone;
              const asking =
                pending?.kind === "signout" && pending.deviceId === d.id;
              return (
                <View key={d.id} style={st.device}>
                  <Muted>{label}</Muted>
                  {asking ? (
                    <View style={st.temp}>
                      <Muted>{fmt(t.signOutAsk, { label })}</Muted>
                      <Button
                        label={t.signOutYes}
                        busy={busy}
                        onPress={() =>
                          void run(async () => {
                            await m.api.signOutPhone(member.id, d.id);
                            return t.signedOut;
                          })
                        }
                      />
                      <Button
                        label={t.cancel}
                        variant="secondary"
                        onPress={() => setPending(null)}
                      />
                    </View>
                  ) : (
                    <Button
                      label={t.signOutPhone}
                      variant="secondary"
                      icon="log-out-outline"
                      onPress={() =>
                        setPending({
                          kind: "signout",
                          staffId: member.id,
                          deviceId: d.id,
                          label,
                        })
                      }
                    />
                  )}
                </View>
              );
            })}
          </Card>
        );
      })}
      {note ? <Muted>{note}</Muted> : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: 12 },
  label: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.ink,
    opacity: 0.62,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 8,
  },
  card: { gap: space.s },
  name: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink },
  code: {
    fontSize: 28,
    letterSpacing: 3,
    fontFamily: fonts.extrabold,
    color: colors.blue,
  },
  temp: {
    gap: space.s,
    padding: space.m,
    borderRadius: 12,
    backgroundColor: tint.blue08,
  },
  pin: {
    fontSize: 32,
    letterSpacing: 4,
    fontFamily: fonts.extrabold,
    color: colors.blue,
  },
  device: { gap: space.xs },
});
