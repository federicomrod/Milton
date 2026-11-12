// Inicio, the "index" of Gestión so that "/" opens here for a manager (mockup
// 03): restaurant pill + avatar, greeting and date, «Ventas de ayer» and
// «Ganancia del mes» side by side, «Lo que destaca» and the pending invoices as
// one compact card. Every number comes from the server (the web's own libs).

import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Icon, Muted, Screen, type IconName } from "../../components/ui";
import { useLanguage } from "../../i18n";
import { fmt } from "../../i18n/strings";
import { formatDateLong, formatDay, formatMoney } from "../../gestion/format";
import { useG, useLoad } from "../../gestion/hooks";
import {
  foodCard,
  profitCard,
  salesCard,
  staffCard,
  yesterdayChip,
  type CardView,
} from "../../gestion/home-core";
import { useManager } from "../../gestion/ManagerProvider";
import {
  Async,
  DeltaChip,
  HomeHeader,
  LocationPill,
  Panel,
  Sparkbars,
  gst,
} from "../../gestion/ui";
import { colors, fonts, space } from "../../theme";

// The bubble of a highlight follows its kind: rosa = a cost went up, mint =
// good news / a pattern, amarillo = something to complete.
const KIND: Record<string, { icon: IconName; bg: string }> = {
  cost_share_change: { icon: "trending-up", bg: colors.rosa },
  days_below: { icon: "time-outline", bg: colors.mint },
  projection: { icon: "stats-chart-outline", bg: colors.mint },
  coverage: { icon: "alert-circle-outline", bg: colors.amarillo },
};

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MAX_HIGHLIGHTS = 3;

/** One KPI card: the figure, or one short line of why not + the next step. Opens its tab. */
function KpiCard({
  card,
  onOpen,
  stacked,
}: {
  card: CardView;
  onOpen: (href: CardView["link"]) => void;
  /** Large text: one card per line, so no word is broken in half. */
  stacked: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpen(card.link)}
      style={[st.kpi, st.kpiLine, !stacked && st.card2]}
    >
      <Text style={st.kpiLabel} maxFontSizeMultiplier={1.5}>
        {card.label}
      </Text>
      {card.value !== null ? (
        <>
          <Text
            style={st.cardValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {card.value}
          </Text>
          {card.chip ? (
            <View
              style={[
                st.chip,
                {
                  backgroundColor:
                    card.chip.tone === "down"
                      ? colors.amarillo
                      : card.chip.tone === "flat"
                        ? colors.border
                        : colors.mint,
                },
              ]}
            >
              <Text style={st.chipText} maxFontSizeMultiplier={1.5}>
                {card.chip.text}
              </Text>
            </View>
          ) : null}
          {card.note ? (
            <Text style={st.note} maxFontSizeMultiplier={1.5}>
              {card.note}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={st.reason} maxFontSizeMultiplier={1.5}>
            {card.reason}
          </Text>
          {card.next ? (
            <Text style={st.next} maxFontSizeMultiplier={1.5}>
              {card.next}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export default function Inicio() {
  const g = useG();
  const lang = useLanguage();
  const router = useRouter();
  const { api, user, locationId, locations, setLocations } = useManager();
  const state = useLoad(`home:${locationId ?? "all"}`, async () => {
    const data = await api.home(locationId);
    if (locations.length === 0) setLocations(data.locations);
    return data;
  });
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.3;
  const now = new Date();
  const yesterdayIso = isoDay(new Date(now.getTime() - 86_400_000));
  const first = user?.name?.trim().split(/\s+/)[0];

  return (
    <Screen>
      <HomeHeader />
      <Async state={state}>
        {(home) => {
          const asOf = home.yesterday
            ? home.yesterday.date === yesterdayIso
              ? g.home.asOfYesterday
              : fmt(g.home.asOf, { date: formatDay(home.yesterday.date, lang) })
            : null;
          const shown = home.highlights.slice(0, MAX_HIGHLIGHTS);
          const chip = home.yesterday
            ? yesterdayChip({
                delta: home.yesterday.delta,
                date: home.yesterday.date,
                lang,
                g,
              })
            : null;
          const c = home.cards;
          const cardViews: CardView[] | null = c
            ? [
                salesCard({ cards: c, currency: home.currency, lang, g }),
                profitCard({ cards: c, currency: home.currency, lang, g }),
                foodCard({ cards: c, lang, g }),
                staffCard({ cards: c, lang, g }),
              ]
            : null;
          // Card order is Ventas, Ganancia / Costo de comida, Personal.
          return (
            <>
              <ScrollView contentContainerStyle={st.content}>
                <View style={st.greetBlock}>
                  <Text
                    style={st.hello}
                    accessibilityRole="header"
                    maxFontSizeMultiplier={1.6}
                  >
                    {first
                      ? fmt(g.header.hello, { name: first })
                      : g.header.helloPlain}
                  </Text>
                  <Muted maxFontSizeMultiplier={1.4}>
                    {asOf
                      ? `${formatDateLong(isoDay(now), lang)} · ${asOf}`
                      : formatDateLong(isoDay(now), lang)}
                  </Muted>
                </View>

                <View style={[st.kpi, st.kpiBlue]}>
                  <View style={gst.row}>
                    <Text style={st.kpiLabelOnBlue}>
                      {g.home.yesterdaySales}
                    </Text>
                    {home.yesterday && home.yesterday.trend.length > 1 ? (
                      <Sparkbars values={home.yesterday.trend} />
                    ) : null}
                  </View>
                  {home.yesterday && home.yesterday.net !== null ? (
                    <>
                      <Text
                        style={st.kpiBig}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                        maxFontSizeMultiplier={1.5}
                      >
                        {formatMoney(home.yesterday.net, home.currency, lang)}
                      </Text>
                      {chip ? (
                        <DeltaChip
                          value={home.yesterday.delta}
                          text={chip.text}
                        />
                      ) : null}
                    </>
                  ) : (
                    <Text style={st.kpiLabelOnBlue}>{g.home.noSales}</Text>
                  )}
                </View>

                {cardViews ? (
                  <>
                    {home.needsRestaurant ? (
                      <>
                        <View style={[st.grid, stacked && st.gridStacked]}>
                          <KpiCard
                            card={cardViews[0]}
                            onOpen={router.push}
                            stacked={stacked}
                          />
                        </View>
                        <Panel style={st.pickPanel}>
                          <Text style={st.cardTitle}>
                            {g.home.pickRestaurant}
                          </Text>
                          <LocationPill fullWidth />
                        </Panel>
                      </>
                    ) : (
                      <>
                        <View style={[st.grid, stacked && st.gridStacked]}>
                          <KpiCard
                            card={cardViews[0]}
                            onOpen={router.push}
                            stacked={stacked}
                          />
                          <KpiCard
                            card={cardViews[1]}
                            onOpen={router.push}
                            stacked={stacked}
                          />
                        </View>
                        <View style={[st.grid, stacked && st.gridStacked]}>
                          <KpiCard
                            card={cardViews[2]}
                            onOpen={router.push}
                            stacked={stacked}
                          />
                          <KpiCard
                            card={cardViews[3]}
                            onOpen={router.push}
                            stacked={stacked}
                          />
                        </View>
                      </>
                    )}
                  </>
                ) : null}

                <View style={[gst.row, st.sectionRow]}>
                  <Text style={st.section}>{g.home.highlights}</Text>
                  {home.highlights.length > MAX_HIGHLIGHTS ? (
                    <Muted>
                      {fmt(g.home.highlightsCount, {
                        n: shown.length,
                        total: home.highlights.length,
                      })}
                    </Muted>
                  ) : null}
                </View>
                {shown.length === 0 ? (
                  <Muted>{g.home.noHighlights}</Muted>
                ) : (
                  shown.map((h) => {
                    const k = KIND[h.kind] ?? KIND.coverage;
                    return (
                      <Pressable
                        key={h.id}
                        accessibilityRole="button"
                        onPress={() => router.push("/rentabilidad")}
                      >
                        <Panel style={st.card}>
                          <View style={[st.bubble, { backgroundColor: k.bg }]}>
                            <Icon name={k.icon} size={20} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={st.cardTitle}>{h.text}</Text>
                            <View style={st.link}>
                              <Text style={st.linkText}>
                                {g.home.seeProfit}
                              </Text>
                              <Icon
                                name="chevron-forward"
                                size={14}
                                color={colors.blue}
                              />
                            </View>
                          </View>
                        </Panel>
                      </Pressable>
                    );
                  })
                )}

                {home.pending.count > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push("/costos")}
                  >
                    <Panel style={st.card}>
                      <View
                        style={[
                          st.bubble,
                          { backgroundColor: colors.amarillo },
                        ]}
                      >
                        <Icon name="receipt-outline" size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.cardTitle}>
                          {home.pending.count === 1
                            ? g.home.pendingWaitingOne
                            : fmt(g.home.pendingWaiting, {
                                count: home.pending.count,
                              })}
                        </Text>
                        {home.pending.suppliers.length > 0 ? (
                          <Muted style={{ marginTop: 3 }}>
                            {fmt(g.home.pendingFrom, {
                              suppliers: home.pending.suppliers.join(", "),
                            })}
                          </Muted>
                        ) : null}
                        <View style={st.link}>
                          <Text style={st.linkText}>{g.home.review}</Text>
                          <Icon
                            name="chevron-forward"
                            size={14}
                            color={colors.blue}
                          />
                        </View>
                      </View>
                    </Panel>
                  </Pressable>
                ) : null}
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={g.ask.title}
                onPress={() => router.push("/preguntar")}
                style={st.askBar}
              >
                <Icon name="sparkles-outline" size={18} />
                <Text
                  style={st.askText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {g.ask.bar}
                </Text>
                <View style={st.askMic}>
                  <Icon name="mic" size={18} color={colors.white} />
                </View>
              </Pressable>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

const st = StyleSheet.create({
  askBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    minHeight: 50,
    paddingLeft: 16,
    paddingRight: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.lavender,
    backgroundColor: colors.white,
  },
  askText: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
  askMic: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blue,
  },
  content: { paddingHorizontal: space.l, paddingBottom: space.xl, gap: 10 },
  greetBlock: { gap: 2, marginTop: 6, marginBottom: 6 },
  hello: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: fonts.extrabold,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  gridStacked: { flexDirection: "column" },
  grid: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  pickPanel: { padding: 14, gap: 10 },
  card2: { flex: 1 },
  cardValue: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: fonts.extrabold,
    color: colors.ink,
    letterSpacing: -0.4,
  },
  chip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.ink },
  note: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
  reason: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  next: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.regular,
    color: colors.blue,
  },
  kpi: { borderRadius: 20, padding: 14, gap: 6, minHeight: 112 },
  kpiBlue: { backgroundColor: colors.blue },
  kpiLine: { flex: 1, borderWidth: 1, borderColor: colors.border },
  kpiLabelOnBlue: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.white,
    opacity: 0.85,
    flexShrink: 1,
  },
  kpiLabel: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.ink,
    opacity: 0.62,
  },
  kpiBig: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: fonts.extrabold,
    color: colors.white,
    letterSpacing: -0.6,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  mint: {
    alignSelf: "flex-start",
    backgroundColor: colors.mint,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  amarillo: {
    alignSelf: "flex-start",
    backgroundColor: colors.amarillo,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  mintText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.ink },
  sectionRow: { marginTop: 12 },
  section: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.ink,
    letterSpacing: -0.3,
  },
  card: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    padding: 14,
  },
  bubble: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  link: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  linkText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.blue },
});
