// Notificaciones: permission, what to receive and when. Permission is asked
// only from «Activar». Quiet hours may wrap midnight. Saved on the server for
// this phone; the daily summary and alerts are sent by the server.

import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Redirect, useRouter } from "expo-router";
import { Button, Icon, Muted } from "../components/ui";
import { fmt } from "../i18n/strings";
import { useG } from "../gestion/hooks";
import { hourLabel, stepHour } from "../gestion/notifications/push-core";
import { usePush } from "../gestion/notifications/usePush";
import { PUSH_ENABLED } from "../config/flags";
import { colors, fonts, space, tint } from "../theme";

function HourStepper({
  label,
  hour,
  onChange,
  less,
  more,
}: {
  label: string;
  hour: number;
  onChange: (h: number) => void;
  less: string;
  more: string;
}) {
  return (
    <View style={st.row}>
      <Text style={st.rowText}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={less}
        onPress={() => onChange(stepHour(hour, -1))}
        style={st.step}
      >
        <Icon name="remove" size={20} />
      </Pressable>
      <Text style={st.hour}>{hourLabel(hour)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={more}
        onPress={() => onChange(stepHour(hour, 1))}
        style={st.step}
      >
        <Icon name="add" size={20} />
      </Pressable>
    </View>
  );
}

function NotificacionesScreen() {
  const g = useG();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = usePush();
  const canEdit = p.permission === "on" && p.registered && !p.unavailable;

  return (
    <SafeAreaView edges={["left", "right"]} style={st.screen}>
      <View style={[st.top, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={g.notif.close}
          onPress={() => router.back()}
          style={st.back}
        >
          <Icon name="chevron-back" size={26} />
        </Pressable>
        <Text style={st.title} accessibilityRole="header">
          {g.notif.title}
        </Text>
      </View>
      <ScrollView contentContainerStyle={st.content}>
        <Muted>{g.notif.intro}</Muted>

        {p.unavailable ? (
          <View style={st.alert}>
            <Text style={st.alertText}>
              {p.unavailable === "simulator"
                ? g.notif.simulator
                : g.notif.noProject}
            </Text>
          </View>
        ) : p.permission === "denied" ? (
          <>
            <View style={st.alert}>
              <Text style={st.alertText}>{g.notif.denied}</Text>
            </View>
            <Button
              label={g.notif.openSettings}
              variant="secondary"
              onPress={p.openSettings}
            />
          </>
        ) : p.permission === "ask" || !p.registered ? (
          <Button
            label={g.notif.enable}
            onPress={() => void p.enable()}
            busy={p.busy}
          />
        ) : (
          <View style={st.on}>
            <Icon name="checkmark" size={16} color={colors.ink} />
            <Text style={st.onText}>{g.notif.on}</Text>
          </View>
        )}

        <View
          style={[st.group, !canEdit && { opacity: 0.45 }]}
          pointerEvents={canEdit ? "auto" : "none"}
        >
          <View style={st.row}>
            <View style={{ flex: 1 }}>
              <Text style={st.rowText}>{g.notif.daily}</Text>
              <Muted>{g.notif.dailyHint}</Muted>
            </View>
            <Switch
              value={p.choices.dailyEnabled}
              onValueChange={(v) => void p.change({ dailyEnabled: v })}
              trackColor={{ true: colors.blue, false: colors.border }}
            />
          </View>
          {p.choices.dailyEnabled ? (
            <HourStepper
              label={g.notif.dailyTime}
              hour={p.choices.dailyHour}
              onChange={(h) => void p.change({ dailyHour: h })}
              less={g.notif.earlier}
              more={g.notif.later}
            />
          ) : null}
          <View style={[st.row, st.border]}>
            <View style={{ flex: 1 }}>
              <Text style={st.rowText}>{g.notif.critical}</Text>
              <Muted>{g.notif.criticalHint}</Muted>
            </View>
            <Switch
              value={p.choices.criticalEnabled}
              onValueChange={(v) => void p.change({ criticalEnabled: v })}
              trackColor={{ true: colors.blue, false: colors.border }}
            />
          </View>
        </View>

        <View
          style={[st.group, !canEdit && { opacity: 0.45 }]}
          pointerEvents={canEdit ? "auto" : "none"}
        >
          <Text style={st.groupTitle}>{g.notif.quiet}</Text>
          <HourStepper
            label={g.notif.from}
            hour={p.choices.quietStart}
            onChange={(h) => void p.change({ quietStart: h })}
            less={g.notif.earlier}
            more={g.notif.later}
          />
          <HourStepper
            label={g.notif.to}
            hour={p.choices.quietEnd}
            onChange={(h) => void p.change({ quietEnd: h })}
            less={g.notif.earlier}
            more={g.notif.later}
          />
          <Muted>
            {fmt(g.notif.quietHint, {
              start: hourLabel(p.choices.quietStart),
              end: hourLabel(p.choices.quietEnd),
            })}
          </Muted>
        </View>

        {p.status === "saved" ? <Muted>{g.notif.saved}</Muted> : null}
        {p.status === "failed" ? <Muted>{g.notif.failed}</Muted> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.m,
    paddingBottom: 10,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 24, fontFamily: fonts.extrabold, color: colors.ink },
  content: { padding: space.l, gap: 16, paddingBottom: space.xl },
  alert: { backgroundColor: colors.amarillo, borderRadius: 12, padding: 12 },
  alertText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.ink },
  on: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.mint,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  onText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.ink },
  group: {
    gap: 4,
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupTitle: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.ink,
    marginBottom: 4,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
  border: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 6,
    paddingTop: 6,
  },
  rowText: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  step: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tint.ink06,
  },
  hour: {
    width: 56,
    textAlign: "center",
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.ink,
  },
});

// Push is off in this build: nobody should land here (the Perfil row is hidden
// too), so a deep link just goes back to Perfil.
export default function Notificaciones() {
  if (!PUSH_ENABLED) return <Redirect href="/perfil" />;
  return <NotificacionesScreen />;
}
