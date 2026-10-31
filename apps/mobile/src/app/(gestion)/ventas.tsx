// Ventas (mockup 04): period switch, total and change vs the previous period,
// tickets and average ticket, bars per day (this vs the previous period), a bar
// per channel and ALL the best-selling dishes inline (no «Ver todos» screen).

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, Muted, Screen, Segments } from "../../components/ui";
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
  BarRow,
  DayBars,
  DeltaChip,
  GestionHeader,
  SectionTitle,
  gst,
} from "../../gestion/ui";
import { colors, fonts, space } from "../../theme";

export default function Ventas() {
  const g = useG();
  const lang = useLanguage();
  const { api, locationId } = useManager();
  const [period, setPeriod] = React.useState<VentasPeriod>("day");
  const state = useLoad(`ventas:${period}:${locationId ?? "all"}`, () =>
    api.ventas(period, locationId)
  );

  return (
    <Screen>
      <GestionHeader title={g.sales.title} />
      <View style={st.switch}>
        <Segments<VentasPeriod>
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
          return (
            <ScrollView contentContainerStyle={gst.content}>
              {v.empty || v.total.value === null ? (
                <Muted>{g.sales.noData}</Muted>
              ) : (
                <>
                  <Card style={gst.card}>
                    <Text style={gst.label}>{g.sales.total}</Text>
                    <View style={gst.bigRow}>
                      <Text style={gst.big}>{money(v.total.value)}</Text>
                      <DeltaChip value={v.total.delta} />
                    </View>
                    {v.compareLabel ? (
                      <Muted>
                        {fmt(g.sales.vsPrevious, { label: v.compareLabel })}
                      </Muted>
                    ) : null}
                    {v.range ? (
                      <Muted>
                        {v.range.from === v.range.to
                          ? formatDay(v.range.to, lang)
                          : `${formatDay(v.range.from, lang)} – ${formatDay(v.range.to, lang)}`}
                      </Muted>
                    ) : null}
                    {v.clipped && v.range ? (
                      <Muted>
                        {fmt(g.sales.clipped, {
                          date: formatDay(v.range.from, lang),
                        })}
                      </Muted>
                    ) : null}
                  </Card>

                  <View style={st.two}>
                    <Card style={[gst.card, st.half]}>
                      <Text style={gst.label}>{g.sales.tickets}</Text>
                      <Text style={st.mid}>
                        {formatNumber(v.tickets.value, lang, 0)}
                      </Text>
                      <DeltaChip value={v.tickets.delta} />
                    </Card>
                    <Card style={[gst.card, st.half]}>
                      <Text style={gst.label}>{g.sales.avgTicket}</Text>
                      <Text style={st.mid}>
                        {formatMoney(v.avgTicket.value, v.currency, lang, 2)}
                      </Text>
                      <DeltaChip value={v.avgTicket.delta} />
                    </Card>
                  </View>

                  <SectionTitle>
                    {v.period === "year" ? g.sales.byMonth : g.sales.byDay}
                  </SectionTitle>
                  <Card style={gst.card}>
                    <DayBars
                      bars={v.daily.map((d) => ({
                        key: d.date,
                        value: d.net,
                        previous: d.previousNet,
                        label: money(d.net),
                      }))}
                      label={barLabel}
                    />
                    {v.period !== "year" ? (
                      <View style={st.legend}>
                        <View
                          style={[st.dot, { backgroundColor: colors.blue }]}
                        />
                        <Muted>{g.sales.thisPeriod}</Muted>
                        <View
                          style={[st.dot, { backgroundColor: colors.border }]}
                        />
                        <Muted>{g.sales.previous}</Muted>
                      </View>
                    ) : null}
                  </Card>

                  <SectionTitle>{g.sales.byChannel}</SectionTitle>
                  <Card style={gst.card}>
                    {v.channels.map((c) => (
                      <BarRow
                        key={c.label}
                        label={c.label}
                        value={`${money(c.net)} · ${formatPercent(c.share, lang)}`}
                        ratio={c.share / 100}
                      />
                    ))}
                  </Card>
                </>
              )}

              <SectionTitle>{g.sales.topDishes}</SectionTitle>
              {v.dishes === null ? (
                <Muted>{g.sales.dishesUnavailable}</Muted>
              ) : v.dishes.length === 0 ? (
                <Muted>{g.sales.noDishes}</Muted>
              ) : (
                <Card style={gst.card}>
                  {v.dishes.map((d, i) => (
                    <View key={`${d.name}-${i}`} style={[gst.row, st.dish]}>
                      <View style={{ flex: 1 }}>
                        <Text style={gst.bold} numberOfLines={2}>
                          {d.name}
                        </Text>
                        <Muted>
                          {fmt(g.sales.units, {
                            n: formatNumber(d.units, lang, 0),
                          })}
                        </Muted>
                      </View>
                      <Text style={gst.bold}>{money(d.net)}</Text>
                    </View>
                  ))}
                </Card>
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
  two: { flexDirection: "row", gap: space.m },
  half: { flex: 1 },
  mid: { fontSize: 22, fontFamily: fonts.extrabold, color: colors.ink },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dish: { paddingVertical: 6 },
});
