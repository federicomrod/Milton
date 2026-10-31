// Building blocks of the Gestión screens. Brand colours only (src/theme.ts):
// mint = positive, rosa = negative, amarillo = alert, grey = neutral / borders.

import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card, Chip, Icon, Muted } from "../components/ui";
import { useLanguage } from "../i18n";
import { fmt } from "../i18n/strings";
import { colors, fonts, radius, space, tint } from "../theme";
import { deltaOf, initials, barRatio, type Delta } from "./format";
import { errorText, useG, type Loaded } from "./hooks";
import { useManager } from "./ManagerProvider";

const inExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** White header: restaurant picker on the left, the profile avatar on the right. */
export function GestionHeader({ title }: { title?: string }) {
  const g = useG();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, locations, locationId, setLocationId } = useManager();
  const [open, setOpen] = useState(false);
  const current = locations.find((l) => l.id === locationId);
  const name = user?.name?.trim().split(/\s+/)[0];

  return (
    <View style={[st.header, { paddingTop: insets.top + 14 }]}>
      <View style={st.headerRow}>
        <View style={st.headerLeft}>
          {title ? (
            <Text style={st.title} accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <Text style={st.title} accessibilityRole="header">
              {name ? fmt(g.header.hello, { name }) : g.header.helloPlain}
            </Text>
          )}
          {locations.length > 0 ? (
            <Pressable
              onPress={() => setOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              style={st.picker}
            >
              <Icon name="restaurant-outline" size={15} />
              <Text style={st.pickerText} numberOfLines={1}>
                {current?.name ?? g.header.all}
              </Text>
              <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.push("/perfil")}
          accessibilityRole="button"
          accessibilityLabel={g.header.profile}
          style={[st.avatar, inExpoGo && { marginTop: 34 }]}
        >
          <Text style={st.avatarText}>
            {initials(user?.name ?? user?.email)}
          </Text>
        </Pressable>
      </View>
      {open ? (
        <Card style={st.menu}>
          {[{ id: null, name: g.header.all }, ...locations].map((l) => (
            <Pressable
              key={l.id ?? "all"}
              accessibilityRole="button"
              accessibilityState={{ selected: l.id === locationId }}
              onPress={() => {
                setLocationId(l.id);
                setOpen(false);
              }}
              style={st.menuRow}
            >
              <Text
                style={[
                  st.menuText,
                  l.id === locationId && { fontFamily: fonts.bold },
                ]}
              >
                {l.name}
              </Text>
              {l.id === locationId ? (
                <Icon name="checkmark" size={18} color={colors.blue} />
              ) : null}
            </Pressable>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

/** A «+12 %» chip: mint up, rosa down, grey flat. Nothing when there is no comparison. */
export function DeltaChip({ value }: { value: number | null | undefined }) {
  const lang = useLanguage();
  const d: Delta = deltaOf(value, lang);
  if (d.text === null) return null;
  return (
    <Chip
      label={d.text}
      tone={d.tone === "up" ? "mint" : d.tone === "down" ? "rosa" : "grey"}
    />
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={st.section}>{children}</Text>;
}

/** Loading / error / empty wrapper for a screen's first read. */
export function Async<T>({
  state,
  children,
}: {
  state: Loaded<T>;
  children: (data: T) => React.ReactNode;
}) {
  const g = useG();
  if (state.loading && !state.data) {
    return (
      <View style={st.center}>
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  }
  if (state.error || !state.data) {
    return (
      <View style={st.center}>
        <Muted style={{ textAlign: "center" }}>
          {errorText(state.error, g)}
        </Muted>
        <Button
          label={g.errors.retry}
          variant="secondary"
          onPress={state.reload}
        />
      </View>
    );
  }
  return <>{children(state.data)}</>;
}

/** A label, a bar and a value (channels, break-even). */
export function BarRow({
  label,
  value,
  ratio,
  tone = colors.blue,
}: {
  label: string;
  value: string;
  ratio: number;
  tone?: string;
}) {
  return (
    <View style={st.barRow}>
      <View style={st.barHead}>
        <Text style={st.barLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={st.barValue}>{value}</Text>
      </View>
      <View style={st.track}>
        <View
          style={[
            st.fill,
            {
              width: `${Math.round(barRatio(ratio, 1) * 100)}%`,
              backgroundColor: tone,
            },
          ]}
        />
      </View>
    </View>
  );
}

/** Vertical bars: this period (blue) beside the previous one (grey). */
export function DayBars({
  bars,
  label,
}: {
  bars: {
    key: string;
    value: number;
    previous: number | null;
    label: string;
  }[];
  label: (key: string) => string;
}) {
  const max = Math.max(
    1,
    ...bars.map((b) => Math.max(b.value, b.previous ?? 0))
  );
  return (
    <View
      style={st.bars}
      accessibilityRole="image"
      accessibilityLabel={bars
        .map((b) => `${label(b.key)} ${b.label}`)
        .join(", ")}
    >
      {bars.map((b) => (
        <View key={b.key} style={st.barCol}>
          <View style={st.barPair}>
            {b.previous !== null ? (
              <View
                style={[
                  st.vbar,
                  {
                    height: `${Math.max(2, barRatio(b.previous, max) * 100)}%`,
                    backgroundColor: colors.border,
                  },
                ]}
              />
            ) : null}
            <View
              style={[
                st.vbar,
                {
                  height: `${Math.max(2, barRatio(b.value, max) * 100)}%`,
                  backgroundColor: colors.blue,
                },
              ]}
            />
          </View>
          <Text style={st.barCaption} numberOfLines={1}>
            {label(b.key)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export const gst = StyleSheet.create({
  content: {
    paddingHorizontal: space.l,
    paddingBottom: space.xl,
    gap: space.m,
  },
  big: { fontSize: 34, fontFamily: fonts.extrabold, color: colors.ink },
  bigRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    flexWrap: "wrap",
  },
  label: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.ink,
    opacity: 0.62,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.m,
  },
  body: { fontSize: 16, fontFamily: fonts.regular, color: colors.ink },
  bold: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
  card: { gap: space.s },
});

const st = StyleSheet.create({
  header: {
    backgroundColor: colors.white,
    paddingHorizontal: space.l,
    paddingBottom: 12,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerLeft: { flex: 1, gap: 4 },
  title: { fontSize: 28, fontFamily: fonts.extrabold, color: colors.ink },
  picker: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  pickerText: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tint.blue14,
  },
  avatarText: { fontSize: 16, fontFamily: fonts.bold, color: colors.blue },
  menu: { padding: 4 },
  menuRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderRadius: radius.s,
  },
  menuText: { fontSize: 16, fontFamily: fonts.regular, color: colors.ink },
  section: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.ink,
    marginTop: space.s,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.m,
    padding: space.l,
  },
  barRow: { gap: 6 },
  barHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.s,
  },
  barLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.ink,
  },
  barValue: { fontSize: 15, fontFamily: fonts.semibold, color: colors.ink },
  track: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: { height: 10, borderRadius: 5 },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 150, gap: 4 },
  barCol: {
    flex: 1,
    height: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 4,
  },
  barPair: {
    flex: 1,
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 2,
  },
  vbar: { flex: 1, borderRadius: 3, maxWidth: 14 },
  barCaption: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
});
