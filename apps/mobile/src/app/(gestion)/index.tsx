// Inicio, the "index" of Gestión so that "/" opens here for a manager (mockup 03): restaurant picker, greeting and date, «Ventas de ayer»,
// «Ganancia del mes», «Lo que destaca» and the pending invoices.

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, Chip, Muted, Screen } from "../../components/ui";
import { useLanguage } from "../../i18n";
import { fmt } from "../../i18n/strings";
import {
  formatDay,
  formatFraction,
  formatMoney,
  formatNumber,
  formatWeekday,
  monthLabel,
} from "../../gestion/format";
import { useG, useLoad } from "../../gestion/hooks";
import { useManager } from "../../gestion/ManagerProvider";
import {
  Async,
  DeltaChip,
  GestionHeader,
  SectionTitle,
  gst,
} from "../../gestion/ui";
import { colors, fonts, space } from "../../theme";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Inicio() {
  const g = useG();
  const lang = useLanguage();
  const router = useRouter();
  const { api, locationId, locations, setLocations } = useManager();
  const state = useLoad(`home:${locationId ?? "all"}`, async () => {
    const data = await api.home(locationId);
    if (locations.length === 0) setLocations(data.locations);
    return data;
  });
  const today = todayIso();

  return (
    <Screen>
      <GestionHeader />
      <Muted style={st.date}>
        {fmt(g.home.date, {
          weekday: formatWeekday(today, lang),
          day: formatDay(today, lang),
        })}
      </Muted>
      <Async state={state}>
        {(home) => (
          <ScrollView contentContainerStyle={gst.content}>
            <Card style={gst.card}>
              <Text style={gst.label}>{g.home.yesterdaySales}</Text>
              {home.yesterday && home.yesterday.net !== null ? (
                <>
                  <View style={gst.bigRow}>
                    <Text style={gst.big}>
                      {formatMoney(home.yesterday.net, home.currency, lang)}
                    </Text>
                    <DeltaChip value={home.yesterday.delta} />
                  </View>
                  <Muted>
                    {`${home.yesterday.compareLabel} · ${fmt(g.home.tickets, {
                      n: formatNumber(home.yesterday.tickets, lang, 0),
                    })}`}
                  </Muted>
                </>
              ) : (
                <Muted>{g.home.noSales}</Muted>
              )}
            </Card>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/rentabilidad")}
            >
              <Card style={gst.card}>
                <View style={gst.row}>
                  <Text style={gst.label}>{g.home.monthProfit}</Text>
                  {home.month?.basis === "estimada" ? (
                    <Chip tone="amarillo" label={g.home.estimated} />
                  ) : null}
                </View>
                {home.month === null ? (
                  <Muted>{g.home.needRestaurant}</Muted>
                ) : !home.month.hasData || home.month.profit === null ? (
                  <Muted>{g.home.noMonthData}</Muted>
                ) : (
                  <>
                    <Text style={gst.big}>
                      {formatMoney(home.month.profit, home.currency, lang)}
                    </Text>
                    <Muted>
                      {`${monthLabel(home.month.month, lang)} · ${fmt(
                        g.home.margin,
                        {
                          pct: formatFraction(home.month.profitPct, lang),
                        }
                      )}`}
                    </Muted>
                  </>
                )}
              </Card>
            </Pressable>

            <SectionTitle>{g.home.highlights}</SectionTitle>
            {home.highlights.length === 0 ? (
              <Muted>{g.home.noHighlights}</Muted>
            ) : (
              home.highlights.map((h) => (
                <Pressable
                  key={h.id}
                  accessibilityRole="button"
                  onPress={() => router.push("/rentabilidad")}
                >
                  <Card style={gst.card}>
                    <Text style={st.insight}>{h.text}</Text>
                  </Card>
                </Pressable>
              ))
            )}

            <Card style={gst.card}>
              <Text style={gst.label}>{g.home.pendingTitle}</Text>
              {home.pending.count > 0 ? (
                <>
                  <Text style={gst.bold}>
                    {fmt(g.home.pendingCount, { count: home.pending.count })}
                  </Text>
                  <Button
                    label={g.home.review}
                    onPress={() => router.push("/costos")}
                  />
                </>
              ) : (
                <Muted>{g.home.pendingNone}</Muted>
              )}
            </Card>
          </ScrollView>
        )}
      </Async>
    </Screen>
  );
}

const st = StyleSheet.create({
  date: { paddingHorizontal: space.l, paddingBottom: space.s },
  insight: { fontSize: 16, fontFamily: fonts.regular, color: colors.ink },
});
