// Building blocks of the Gestión screens. Brand colours only (src/theme.ts):
// mint = positive, rosa = negative, amarillo = alert, grey = neutral / borders.

import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card, Icon, Muted, type IconName } from "../components/ui";
import { useLanguage } from "../i18n";
import { fmt } from "../i18n/strings";
import { colors, fonts, radius, space, tint } from "../theme";
import { deltaOf, initials, barRatio, type Delta } from "./format";
import { errorText, useG, type Loaded } from "./hooks";
import { useManager } from "./ManagerProvider";

const inExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** One option of a picker pill. */
export interface PickOption {
  id: string | null;
  label: string;
}

/** A grey pill (restaurant, month) that opens a small menu under it. */
export function PickerPill({
  icon,
  label,
  options,
  selected,
  onSelect,
  align = "left",
}: {
  icon?: IconName;
  label: string;
  options: PickOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={st.pickerWrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={st.pill}
      >
        {icon ? <Icon name={icon} size={15} /> : null}
        <Text style={st.pillText} numberOfLines={1}>
          {label}
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
      </Pressable>
      {open ? (
        <Card style={[st.menu, align === "right" ? { right: 0 } : { left: 0 }]}>
          {options.map((o) => (
            <Pressable
              key={o.id ?? "all"}
              accessibilityRole="button"
              accessibilityState={{ selected: o.id === selected }}
              onPress={() => {
                onSelect(o.id);
                setOpen(false);
              }}
              style={st.menuRow}
            >
              <Text
                style={[
                  st.menuText,
                  o.id === selected && { fontFamily: fonts.bold },
                ]}
              >
                {o.label}
              </Text>
              {o.id === selected ? (
                <Icon name="checkmark" size={18} color={colors.blue} />
              ) : null}
            </Pressable>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

/** The restaurant picker pill, driven by the manager session. */
export function LocationPill({ align }: { align?: "left" | "right" }) {
  const g = useG();
  const { locations, locationId, setLocationId } = useManager();
  if (locations.length === 0) return null;
  const current = locations.find((l) => l.id === locationId);
  return (
    <PickerPill
      icon="restaurant-outline"
      label={current?.name ?? g.header.all}
      options={[
        { id: null, label: g.header.all },
        ...locations.map((l) => ({ id: l.id, label: l.name })),
      ]}
      selected={locationId}
      onSelect={setLocationId}
      align={align}
    />
  );
}

/** Screen header: a big title on the left, a picker pill (or anything) on the right. */
export function GestionHeader({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.header, { paddingTop: insets.top + 12 }]}>
      <View style={st.headerRow}>
        <Text style={st.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {right === undefined ? <LocationPill align="right" /> : right}
      </View>
    </View>
  );
}

/** Inicio header: restaurant pill on the left, the profile avatar on the right. */
export function HomeHeader() {
  const g = useG();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useManager();
  return (
    <View style={[st.header, { paddingTop: insets.top + 8 }]}>
      <View style={st.headerRow}>
        <LocationPill />
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
    </View>
  );
}

/** A «+12 % vs. last week» chip: mint up, rosa down, grey flat. Nothing when there is no comparison. */
export function DeltaChip({
  value,
  suffix,
}: {
  value: number | null | undefined;
  suffix?: string | null;
}) {
  const lang = useLanguage();
  const g = useG();
  const d: Delta = deltaOf(value, lang);
  if (d.text === null) return null;
  const tone = d.tone === "up" ? "mint" : d.tone === "down" ? "rosa" : "grey";
  return (
    <View
      style={[
        st.deltaChip,
        {
          backgroundColor:
            tone === "mint"
              ? colors.mint
              : tone === "rosa"
                ? colors.rosa
                : colors.border,
        },
      ]}
    >
      {d.tone !== "flat" ? (
        <Icon
          name={d.tone === "up" ? "trending-up" : "trending-down"}
          size={13}
        />
      ) : null}
      <Text style={st.deltaText} numberOfLines={1}>
        {suffix
          ? fmt(g.home.vsLabel, { delta: d.text, label: suffix })
          : d.text}
      </Text>
    </View>
  );
}

/** The 4-way period switch: grey track, white thumb on the active one. */
export function PeriodSwitch<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={st.switchTrack}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[st.switchItem, active && st.switchActive]}
          >
            <Text style={st.switchText}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A rounded card, 20 px corners (the Gestión look). */
export function Panel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[st.panel, style]}>{children}</View>;
}

/** One horizontal bar made of several parts (channels, «De cada $100»). */
export function StackBar({
  parts,
  height = 12,
}: {
  parts: { key: string; weight: number; color: string }[];
  height?: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        height,
        borderRadius: height / 2,
        overflow: "hidden",
        gap: 2,
      }}
    >
      {parts
        .filter((p) => p.weight > 0)
        .map((p) => (
          <View
            key={p.key}
            style={{ flex: p.weight, backgroundColor: p.color }}
          />
        ))}
    </View>
  );
}

/** Small bars of the last days (real daily sales), for the Inicio card. */
export function Sparkbars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <View style={st.spark} accessibilityElementsHidden>
      {values.map((v, i) => (
        <View
          key={i}
          style={{
            width: 5,
            height: Math.max(3, Math.round((Math.max(0, v) / max) * 26)),
            borderRadius: 2,
            backgroundColor:
              i === values.length - 1 ? colors.white : tint.white70,
          }}
        />
      ))}
    </View>
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
    paddingBottom: 10,
    zIndex: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    flexShrink: 1,
    fontSize: 28,
    lineHeight: 34,
    fontFamily: fonts.extrabold,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  pickerWrap: { position: "relative", zIndex: 30 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: tint.ink06,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 240,
  },
  pillText: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tint.blue14,
  },
  avatarText: { fontSize: 14, fontFamily: fonts.bold, color: colors.blue },
  menu: {
    position: "absolute",
    top: 42,
    minWidth: 220,
    padding: 4,
    zIndex: 50,
  },
  menuRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: radius.s,
  },
  menuText: { fontSize: 15, fontFamily: fonts.regular, color: colors.ink },
  deltaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  deltaText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.ink },
  switchTrack: {
    flexDirection: "row",
    backgroundColor: tint.ink06,
    borderRadius: radius.m,
    padding: 3,
  },
  switchItem: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  switchActive: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.ink },
  panel: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
  },
  spark: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 28 },
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

/** A ranked dish: name, amount, units sold and a bar against the best seller. */
export function DishRow({
  rank,
  name,
  amount,
  sold,
  ratio,
}: {
  rank?: number;
  name: string;
  amount: string;
  sold: string;
  ratio: number;
}) {
  return (
    <View style={dst.row}>
      {rank !== undefined ? <Text style={dst.rank}>{rank}</Text> : null}
      <View style={{ flex: 1, gap: 6 }}>
        <View style={dst.line}>
          <Text style={dst.name} numberOfLines={2}>
            {name}
          </Text>
          <Text style={dst.amount}>{amount}</Text>
        </View>
        <View style={dst.line}>
          <View style={dst.track}>
            <View
              style={[
                dst.fill,
                { width: `${Math.round(barRatio(ratio, 1) * 100)}%` },
              ]}
            />
          </View>
          <Text style={dst.sold}>{sold}</Text>
        </View>
      </View>
    </View>
  );
}

const dst = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rank: {
    width: 14,
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.ink,
    opacity: 0.62,
  },
  line: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  amount: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: tint.ink06,
    overflow: "hidden",
  },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.blue },
  sold: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
});
