// Ventas (mockup 04): period switch, the total and its trend first, bars per
// day, a bar per channel, then ONLY the 5 best-selling platos and the 3 that
// sell least; «Ver todos» opens the full list. Numbers are the web's.

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Muted, Screen } from "../../components/ui";
import { useLanguage } from "../../i18n";
import { fmt } from "../../i18n/strings";
import {
  formatDay,
  formatMoney,
  formatNumber,
  formatPercent,
  formatWeekday,
  monthShort,
} from "../../gestion/format";
import { useG, useLoad } from "../../gestion/hooks";
import { useManager } from "../../gestion/ManagerProvider";
import type { VentasPeriod } from "../../gestion/types";
import {
  Async,
  DayBars,
  DeltaChip,
  DishRow,
  GestionHeader,
  Panel,
  PeriodSwitch,
  StackBar,
  gst,
} from "../../gestion/ui";
import { colors, fonts, space, tint } from "../../theme";

const CHANNEL_TONES = [colors.blue, tint.blue60, tint.blue30, tint.ink20];
export const TOP_DISHES = 5;
export const LOW_DISHES = 3;

export default function Ventas() {
  const g = useG();
  const lang = useLanguage();
  const router = useRouter();
  const { api, locationId } = useManager();
  const [period, setPeriod] = React.useState<VentasPeriod>("day");
  const state = useLoad(`ventas:${period}:${locationId ?? "all"}`, () =>
    api.ventas(period, locationId)
  );

  return (
    <Screen>
      <GestionHeader title={g.sales.title} />
      <View style={st.switch}>
        <PeriodSwitch<VentasPeriod>
          value={period}
          onChange={setPeriod}
          options={[
            { value: "day", label: g.sales.day },
            { value: "week", label: g.sales.week },
            { value: "month", label: g.sales.month },
            { value: "year", label: g.sales.year },
          ]}
        />
      </View>
      <Async state={state}>
        {(v) => {
          const money = (n: number | null) => formatMoney(n, v.currency, lang);
          const barLabel = (key: string) => {
            if (v.period === "year") return monthShort(key, lang);
            if (v.period === "week") return formatWeekday(key, lang);
            if (v.period === "day") return formatDay(key, lang);
            return Number(key.slice(8)) % 5 === 0
              ? String(Number(key.slice(8)))
              : "";
          };
          const rangeText = v.range
            ? v.period === "day" || v.range.from === v.range.to
              ? formatDay(v.range.to, lang)
              : fmt(v.period === "week" ? g.sales.weekOf : g.sales.range, {
                  from: formatDay(v.range.from, lang),
                  to: formatDay(v.range.to, lang),
                })
            : null;
          const dishes = v.dishes ?? [];
          const top = dishes.slice(0, TOP_DISHES);
          const low =
            dishes.length > TOP_DISHES
              ? dishes
                  .slice(Math.max(TOP_DISHES, dishes.length - LOW_DISHES))
                  .reverse()
              : [];
          const best = top[0]?.net ?? 0;
          return (
            <ScrollView contentContainerStyle={gst.content}>
              {v.empty || v.total.value === null ? (
                <Muted>{g.sales.noData}</Muted>
              ) : (
                <>
                  <View style={st.head}>
                    {rangeText ? (
                      <Text style={st.range}>{rangeText}</Text>
                    ) : null}
                    <Text style={st.big}>{money(v.total.value)}</Text>
                    <View style={st.trendRow}>
                      <DeltaChip
                        value={v.total.delta}
                        suffix={v.compareLabel}
                      />
                      <Text style={st.meta}>
                        {fmt(g.sales.ticketsAvg, {
                          tickets: formatNumber(v.tickets.value, lang, 0),
                          avg: formatMoney(
                            v.avgTicket.value,
                            v.currency,
                            lang,
                            2
                          ),
                        })}
                      </Text>
                    </View>
                    {v.clipped && v.range ? (
                      <Muted>
                        {fmt(g.sales.clipped, {
                          date: formatDay(v.range.from, lang),
                        })}
                      </Muted>
                    ) : null}
                  </View>

                  <Panel style={st.panel}>
                    <View style={gst.row}>
                      <Text style={st.panelTitle}>
                        {v.period === "year" ? g.sales.byMonth : g.sales.byDay}
                      </Text>
                      {v.period !== "year" ? (
                        <View style={st.legend}>
                          <View
                            style={[st.dot, { backgroundColor: colors.blue }]}
                          />
                          <Text style={st.legendText}>
                            {g.sales.legendThis}
                          </Text>
                          <View
                            style={[st.dot, { backgroundColor: colors.border }]}
                          />
                          <Text style={st.legendText}>
                            {g.sales.legendPrev}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <DayBars
                      bars={v.daily.map((d) => ({
                        key: d.date,
                        value: d.net,
                        previous: d.previousNet,
                        label: money(d.net),
                      }))}
                      label={barLabel}
                    />
                  </Panel>

                  {v.channels.length > 0 ? (
                    <Panel style={st.panel}>
                      <Text style={st.panelTitle}>{g.sales.byChannel}</Text>
                      <StackBar
                        parts={v.channels.map((c, i) => ({
                          key: c.label,
                          weight: c.share,
                          color:
                            CHANNEL_TONES[
                              Math.min(i, CHANNEL_TONES.length - 1)
                            ],
                        }))}
                      />
                      <View style={st.channels}>
                        {v.channels.map((c, i) => (
                          <View key={c.label} style={st.channel}>
                            <View
                              style={[
                                st.dot,
                                {
                                  backgroundColor:
                                    CHANNEL_TONES[
                                      Math.min(i, CHANNEL_TONES.length - 1)
                                    ],
                                },
                              ]}
                            />
                            <Text style={st.channelText}>
                              <Text style={{ fontFamily: fonts.bold }}>
                                {formatPercent(c.share, lang)}
                              </Text>
                              {` ${c.label}`}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </Panel>
                  ) : null}
                </>
              )}

              {v.dishes === null ? (
                <Muted>{g.sales.dishesUnavailable}</Muted>
              ) : top.length === 0 ? (
                <Muted>{g.sales.noDishes}</Muted>
              ) : (
                <>
                  <Panel style={st.panel}>
                    <View style={gst.row}>
                      <Text style={st.panelTitle}>{g.sales.topDishes}</Text>
                      {dishes.length > top.length ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() =>
                            router.push({
                              pathname: "/platos",
                              params: { period },
                            })
                          }
                          style={st.seeAll}
                        >
                          <Text style={st.seeAllText}>{g.sales.seeAll}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {top.map((d, i) => (
                      <DishRow
                        key={`${d.name}-${i}`}
                        rank={i + 1}
                        name={d.name}
                        amount={money(d.net)}
                        sold={fmt(g.sales.sold, {
                          n: formatNumber(d.units, lang, 0),
                        })}
                        ratio={best > 0 ? d.net / best : 0}
                      />
                    ))}
                  </Panel>
                  {low.length > 0 ? (
                    <Panel style={st.panel}>
                      <Text style={st.panelTitle}>{g.sales.lowest}</Text>
                      {low.map((d, i) => (
                        <DishRow
                          key={`${d.name}-${i}`}
                          name={d.name}
                          amount={money(d.net)}
                          sold={fmt(g.sales.sold, {
                            n: formatNumber(d.units, lang, 0),
                          })}
                          ratio={best > 0 ? d.net / best : 0}
                        />
                      ))}
                    </Panel>
                  ) : null}
                </>
              )}
            </ScrollView>
          );
        }}
      </Async>
    </Screen>
  );
}

const st = StyleSheet.create({
  switch: { paddingHorizontal: space.l, paddingBottom: space.s },
  head: { gap: 6, marginBottom: 2 },
  range: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.ink,
    opacity: 0.62,
  },
  big: {
    fontSize: 40,
    lineHeight: 46,
    fontFamily: fonts.extrabold,
    color: colors.ink,
    letterSpacing: -1,
  },
  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  meta: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
  panel: { gap: 12 },
  panelTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.ink },
  legend: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendText: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
  dot: { width: 10, height: 10, borderRadius: 3 },
  channels: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 14,
    rowGap: 6,
  },
  channel: { flexDirection: "row", alignItems: "center", gap: 6 },
  channelText: { fontSize: 13, fontFamily: fonts.regular, color: colors.ink },
  seeAll: { minHeight: 32, justifyContent: "center" },
  seeAllText: { fontSize: 13, fontFamily: fonts.bold, color: colors.blue },
});
