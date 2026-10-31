// Rentabilidad (mockup 05): month picker, estimated profit and margin, the
// break-even bar and «De cada $100 que vendes». One restaurant, one month; the
// numbers are the web's. An estimate is labelled and never presented as real.

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, Chip, Icon, Muted, Screen } from "../../components/ui";
import { useLanguage } from "../../i18n";
import { fmt } from "../../i18n/strings";
import {
  formatFraction,
  formatMoney,
  formatNumber,
  monthLabel,
  shiftMonth,
} from "../../gestion/format";
import { useG, useLoad } from "../../gestion/hooks";
import { useManager } from "../../gestion/ManagerProvider";
import {
  Async,
  BarRow,
  GestionHeader,
  SectionTitle,
  gst,
} from "../../gestion/ui";
import { colors, radius, space, tint } from "../../theme";

const PART_TONE: Record<string, string> = {
  comida: colors.blue,
  merma: colors.amarillo,
  impuestos: colors.border,
  planilla: colors.ink,
  alquiler: tint.blue14,
  servicios: tint.ink45,
  otros: colors.border,
  ganancia: colors.mint,
};

export default function Rentabilidad() {
  const g = useG();
  const lang = useLanguage();
  const { api, locationId, locations } = useManager();
  const [month, setMonth] = React.useState<string | null>(null);
  const location =
    locationId ?? (locations.length === 1 ? locations[0].id : null);
  const state = useLoad(`rent:${month ?? "now"}:${location ?? "none"}`, () =>
    location
      ? api.rentabilidad(month, location)
      : Promise.reject(new Error("pick"))
  );

  return (
    <Screen>
      <GestionHeader title={g.profit.title} />
      {location === null ? (
        <View style={st.pad}>
          <Muted>{g.profit.needRestaurant}</Muted>
        </View>
      ) : (
        <Async state={state}>
          {(r) => {
            const money = (n: number | null) =>
              formatMoney(n, r.currency, lang);
            const current = r.isCurrentMonth;
            const per100 = formatMoney(100, r.currency, lang);
            const be = r.breakEven;
            const ratio =
              be.perDay && be.avgSalesPerDay
                ? be.avgSalesPerDay / be.perDay
                : 0;
            return (
              <ScrollView contentContainerStyle={gst.content}>
                <View style={st.monthRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={g.profit.previousMonth}
                    onPress={() => setMonth(shiftMonth(r.month, -1))}
                    style={st.monthBtn}
                  >
                    <Icon name="chevron-back" />
                  </Pressable>
                  <Text style={gst.bold}>{monthLabel(r.month, lang)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={g.profit.nextMonth}
                    disabled={current}
                    onPress={() => setMonth(shiftMonth(r.month, 1))}
                    style={[st.monthBtn, current && { opacity: 0.3 }]}
                  >
                    <Icon name="chevron-forward" />
                  </Pressable>
                </View>

                {!r.hasData || r.profit === null ? (
                  <Muted>{g.profit.noData}</Muted>
                ) : (
                  <>
                    <Card style={gst.card}>
                      <View style={gst.row}>
                        <Text style={gst.label}>
                          {g.profit.estimatedProfit}
                        </Text>
                        {r.basis === "estimada" ? (
                          <Chip tone="amarillo" label={g.profit.estimated} />
                        ) : null}
                      </View>
                      <Text style={gst.big}>{money(r.profit)}</Text>
                      <Muted>
                        {fmt(g.profit.margin, {
                          pct: formatFraction(r.profitPct, lang),
                        })}
                      </Muted>
                      {r.cada100Loss ? (
                        <Chip tone="rosa" label={g.profit.loss} />
                      ) : null}
                    </Card>

                    <SectionTitle>{g.profit.breakEven}</SectionTitle>
                    <Card style={gst.card}>
                      {be.perDay === null ? (
                        <Muted>{g.profit.noBreakEven}</Muted>
                      ) : (
                        <>
                          <BarRow
                            label={fmt(g.profit.perDay, {
                              amount: money(be.perDay),
                            })}
                            value=""
                            ratio={1}
                            tone={colors.border}
                          />
                          {be.avgSalesPerDay !== null ? (
                            <BarRow
                              label={fmt(g.profit.average, {
                                amount: money(be.avgSalesPerDay),
                              })}
                              value=""
                              ratio={Math.min(1, ratio)}
                              tone={ratio >= 1 ? colors.mint : colors.blue}
                            />
                          ) : null}
                          {be.day !== null ? (
                            <Muted>
                              {fmt(g.profit.reachedOn, {
                                day: formatNumber(be.day, lang, 0),
                              })}
                            </Muted>
                          ) : null}
                        </>
                      )}
                    </Card>

                    {r.cada100 ? (
                      <>
                        <SectionTitle>
                          {fmt(g.profit.per100, { amount: per100 })}
                        </SectionTitle>
                        <Card style={gst.card}>
                          <View style={st.stack}>
                            {r.cada100.map((p) => (
                              <View
                                key={p.key}
                                style={{
                                  flex: Math.max(p.pct, 0.5),
                                  backgroundColor:
                                    PART_TONE[p.key] ?? colors.border,
                                }}
                              />
                            ))}
                          </View>
                          {r.cada100.map((p) => (
                            <View key={p.key} style={gst.row}>
                              <View style={st.legendLeft}>
                                <View
                                  style={[
                                    st.dot,
                                    {
                                      backgroundColor:
                                        PART_TONE[p.key] ?? colors.border,
                                    },
                                  ]}
                                />
                                <Text style={gst.body}>
                                  {g.profit.parts[
                                    p.key as keyof typeof g.profit.parts
                                  ] ?? p.key}
                                </Text>
                              </View>
                              <Text style={gst.bold}>
                                {formatMoney(p.pct, r.currency, lang, 1)}
                              </Text>
                            </View>
                          ))}
                        </Card>
                      </>
                    ) : null}

                    {r.findings.length > 0 ? (
                      <>
                        <SectionTitle>{g.profit.findings}</SectionTitle>
                        {r.findings.map((f, i) => (
                          <Card key={i} style={gst.card}>
                            <Text style={gst.body}>{f}</Text>
                          </Card>
                        ))}
                      </>
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

const st = StyleSheet.create({
  pad: { padding: space.l },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthBtn: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  stack: {
    flexDirection: "row",
    height: 22,
    borderRadius: radius.s,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  legendLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
