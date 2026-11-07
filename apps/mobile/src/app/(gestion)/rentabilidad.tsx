// Rentabilidad (mockup 05): month pill, estimated profit and margin, the
// break-even bar and «De cada $100 que vendes». One restaurant, one month; the
// numbers are the web's. An estimate is labelled and never presented as real.

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon, Muted, Screen } from "../../components/ui";
import { useLanguage } from "../../i18n";
import { fmt } from "../../i18n/strings";
import {
  formatFraction,
  formatMoney,
  monthLabel,
  shiftMonth,
} from "../../gestion/format";
import { useG, useLoad } from "../../gestion/hooks";
import { useManager } from "../../gestion/ManagerProvider";
import {
  Async,
  GestionHeader,
  Panel,
  PickerPill,
  StackBar,
  gst,
} from "../../gestion/ui";
import { colors, fonts, space, tint } from "../../theme";

// «De cada $100»: the server's parts, grouped the way the mockup reads
// (rent + utilities, taxes + other). Brand colours and tints only.
const GROUPS: { key: string; parts: string[]; color: string }[] = [
  { key: "comida", parts: ["comida"], color: colors.blue },
  { key: "planilla", parts: ["planilla"], color: colors.ink },
  { key: "alquiler", parts: ["alquiler", "servicios"], color: tint.ink45 },
  { key: "impuestos", parts: ["impuestos", "otros"], color: tint.ink20 },
  { key: "merma", parts: ["merma"], color: colors.rosa },
  { key: "ganancia", parts: ["ganancia"], color: colors.mint },
];

const MONTHS_BACK = 12;

export default function Rentabilidad() {
  const g = useG();
  const lang = useLanguage();
  const { api, locationId, locations } = useManager();
  const [month, setMonth] = React.useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = React.useState<string | null>(null);
  const location =
    locationId ?? (locations.length === 1 ? locations[0].id : null);
  const state = useLoad(
    `rent:${month ?? "now"}:${location ?? "none"}`,
    async () => {
      if (!location) throw new Error("pick");
      const data = await api.rentabilidad(month, location);
      if (data.isCurrentMonth) setCurrentMonth(data.month);
      return data;
    }
  );
  const monthOptions = currentMonth
    ? Array.from({ length: MONTHS_BACK }, (_, i) => {
        const m = shiftMonth(currentMonth, -i);
        return { id: m, label: monthLabel(m, lang) };
      })
    : [];
  const picker = state.data ? (
    <PickerPill
      label={monthLabel(state.data.month, lang)}
      options={monthOptions}
      selected={state.data.month}
      onSelect={(m) => setMonth(m === currentMonth ? null : m)}
      align="right"
    />
  ) : null;

  return (
    <Screen>
      <GestionHeader title={g.profit.title} right={picker} />
      {location === null ? (
        <View style={st.pad}>
          <Muted>{g.profit.needRestaurant}</Muted>
        </View>
      ) : (
        <Async state={state}>
          {(r) => {
            const money = (n: number | null) =>
              formatMoney(n, r.currency, lang);
            const be = r.breakEven;
            const needs = be.monthSales;
            const have = r.sales;
            const scale = Math.max(needs ?? 0, have ?? 0);
            const reached = be.day !== null;
            const groups = r.cada100
              ? GROUPS.map((gr) => ({
                  ...gr,
                  pct: r
                    .cada100!.filter((p) => gr.parts.includes(p.key))
                    .reduce((sum, p) => sum + p.pct, 0),
                  present: r.cada100!.some((p) => gr.parts.includes(p.key)),
                })).filter((gr) => gr.present)
              : null;
            return (
              <ScrollView contentContainerStyle={gst.content}>
                {!r.hasData || r.profit === null ? (
                  <Muted>{g.profit.noData}</Muted>
                ) : (
                  <>
                    <View style={st.head}>
                      <Text style={st.range}>
                        {fmt(g.profit.estimatedIn, {
                          month: monthLabel(r.month, lang),
                        })}
                      </Text>
                      <View style={st.bigRow}>
                        <Text style={st.big}>{money(r.profit)}</Text>
                        <View style={st.mint}>
                          <Text style={st.chipText}>
                            {fmt(g.profit.marginChip, {
                              pct: formatFraction(r.profitPct, lang),
                            })}
                          </Text>
                        </View>
                      </View>
                      {r.basis === "estimada" ? (
                        <View style={st.amarillo}>
                          <Text style={st.chipText}>{g.profit.estimated}</Text>
                        </View>
                      ) : null}
                      {r.cada100Loss ? (
                        <View style={st.rosa}>
                          <Text style={st.chipText}>{g.profit.loss}</Text>
                        </View>
                      ) : null}
                    </View>

                    <Panel style={st.panel}>
                      <View style={gst.row}>
                        <Text style={st.panelTitle}>{g.profit.breakEven}</Text>
                        {needs !== null && have !== null ? (
                          <View style={reached ? st.mint : st.grey}>
                            <View style={st.chipInner}>
                              {be.day !== null ? (
                                <Icon name="checkmark" size={13} />
                              ) : null}
                              <Text style={st.chipText}>
                                {be.day !== null
                                  ? fmt(g.profit.reachedDay, { day: be.day })
                                  : g.profit.notReached}
                              </Text>
                            </View>
                          </View>
                        ) : null}
                      </View>
                      {needs === null || have === null || scale <= 0 ? (
                        <Muted>{g.profit.noBreakEven}</Muted>
                      ) : (
                        <>
                          <View style={st.track}>
                            <View
                              style={{
                                flex: Math.min(have, needs),
                                backgroundColor: colors.blue,
                              }}
                            />
                            {have > needs ? (
                              <View
                                style={{
                                  flex: have - needs,
                                  backgroundColor: colors.mint,
                                }}
                              />
                            ) : (
                              <View style={{ flex: needs - have }} />
                            )}
                            {have < needs ? (
                              <View style={[st.marker, { right: 0 }]} />
                            ) : (
                              <View
                                style={[
                                  st.marker,
                                  { left: `${(needs / scale) * 100}%` },
                                ]}
                              />
                            )}
                          </View>
                          <View style={gst.row}>
                            <Muted>
                              {fmt(g.profit.needs, { amount: money(needs) })}
                            </Muted>
                            <Muted>
                              {fmt(g.profit.have, { amount: money(have) })}
                            </Muted>
                          </View>
                        </>
                      )}
                    </Panel>

                    {groups ? (
                      <Panel style={st.panel}>
                        <Text style={st.panelTitle}>
                          {fmt(g.profit.per100, { amount: money(100) })}
                        </Text>
                        <StackBar
                          height={14}
                          parts={groups.map((gr) => ({
                            key: gr.key,
                            weight: Math.max(gr.pct, 0),
                            color: gr.color,
                          }))}
                        />
                        {groups.map((gr) => (
                          <View key={gr.key} style={gst.row}>
                            <View style={st.legendLeft}>
                              <View
                                style={[st.dot, { backgroundColor: gr.color }]}
                              />
                              <Text style={gst.body}>
                                {
                                  g.profit.groups[
                                    gr.key as keyof typeof g.profit.groups
                                  ]
                                }
                              </Text>
                            </View>
                            <Text style={gst.bold}>
                              {formatMoney(gr.pct, r.currency, lang, 0)}
                            </Text>
                          </View>
                        ))}
                      </Panel>
                    ) : null}

                    {r.findings.length > 0 ? (
                      <Panel style={st.panel}>
                        <Text style={st.panelTitle}>{g.profit.findings}</Text>
                        {r.findings.map((f, i) => (
                          <Text key={i} style={st.finding}>
                            {f}
                          </Text>
                        ))}
                      </Panel>
                    ) : null}
                  </>
                )}
              </ScrollView>
            );
          }}
        </Async>
      )}
    </Screen>
  );
}

const chip = {
  alignSelf: "flex-start" as const,
  borderRadius: 999,
  paddingHorizontal: 10,
  paddingVertical: 5,
};

const st = StyleSheet.create({
  pad: { padding: space.l },
  head: { gap: 6 },
  range: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.ink,
    opacity: 0.62,
  },
  bigRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  big: {
    fontSize: 40,
    lineHeight: 46,
    fontFamily: fonts.extrabold,
    color: colors.ink,
    letterSpacing: -1,
  },
  mint: { ...chip, backgroundColor: colors.mint },
  amarillo: { ...chip, backgroundColor: colors.amarillo },
  rosa: { ...chip, backgroundColor: colors.rosa },
  grey: { ...chip, backgroundColor: colors.border },
  chipInner: { flexDirection: "row", alignItems: "center", gap: 4 },
  chipText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.ink },
  panel: { gap: 12 },
  panelTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.ink },
  track: {
    flexDirection: "row",
    height: 14,
    borderRadius: 7,
    overflow: "hidden",
    backgroundColor: tint.ink06,
  },
  marker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.ink,
  },
  legendLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 3 },
  finding: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.ink,
  },
});
