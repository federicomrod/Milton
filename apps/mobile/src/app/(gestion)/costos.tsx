// Costos: costo de ventas and the month's cost KPIs first, then «Facturas por
// revisar» as compact rows (supplier, date, total, how many lines have no
// price). A row opens the invoice (app/factura.tsx) with its lines and
// Aprobar / Rechazar. A missing price says «Sin precio», never $0.

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon, Muted, Screen } from "../../components/ui";
import { useLanguage } from "../../i18n";
import { fmt } from "../../i18n/strings";
import {
  formatDay,
  formatFraction,
  formatMoney,
  monthLabel,
} from "../../gestion/format";
import { useG, useLoad } from "../../gestion/hooks";
import { useManager } from "../../gestion/ManagerProvider";
import { invoiceTotalText } from "../../gestion/invoice";
import { Async, GestionHeader, Panel, gst } from "../../gestion/ui";
import { colors, fonts } from "../../theme";

export default function Costos() {
  const g = useG();
  const lang = useLanguage();
  const router = useRouter();
  const { api, locationId, locations } = useManager();
  const location =
    locationId ?? (locations.length === 1 ? locations[0].id : null);
  const state = useLoad(`costos:${location ?? "all"}`, () =>
    api.costos(location)
  );

  return (
    <Screen>
      <GestionHeader title={g.costs.title} />
      <Async state={state}>
        {(c) => {
          const money0 = (n: number | null) => formatMoney(n, c.currency, lang);
          return (
            <ScrollView contentContainerStyle={gst.content}>
              {c.kpis === null ? (
                <Muted>{g.costs.kpisNeedRestaurant}</Muted>
              ) : !c.kpis.hasData ? (
                <Muted>{g.costs.kpisNoData}</Muted>
              ) : (
                <>
                  <View style={st.kpis}>
                    <View style={[st.kpi, st.kpiBlue]}>
                      <Text style={st.kpiLabelOnBlue}>
                        {g.costs.costOfSales}
                      </Text>
                      <Text style={st.kpiBig}>
                        {c.kpis.foodCostPct === null
                          ? "—"
                          : formatFraction(c.kpis.foodCostPct / 100, lang)}
                      </Text>
                      {c.kpis.basis === "estimada" ? (
                        <View style={st.amarillo}>
                          <Text style={st.chipText}>{g.costs.estimated}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={[st.kpi, st.kpiLine]}>
                      <Text style={st.kpiLabel}>{g.costs.fixedMonth}</Text>
                      <Text style={[st.kpiBig, st.ink]}>
                        {money0(c.kpis.fixedTotal)}
                      </Text>
                    </View>
                  </View>
                  <Muted>
                    {`${fmt(g.costs.salesOf, { month: monthLabel(c.kpis.month, lang) })} · ${money0(c.kpis.sales)}`}
                  </Muted>
                </>
              )}

              <View style={[gst.row, st.sectionRow]}>
                <Text style={st.section}>{g.costs.pending}</Text>
                {c.pendingCount > 0 ? (
                  <View style={st.count}>
                    <Text style={st.chipText}>{c.pendingCount}</Text>
                  </View>
                ) : null}
              </View>
              {c.invoices.length === 0 ? (
                <Muted>{g.costs.none}</Muted>
              ) : (
                <Panel style={st.list}>
                  {c.invoices.map((inv, i) => (
                    <Pressable
                      key={inv.id}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: "/factura",
                          params: { id: inv.id },
                        })
                      }
                      style={[st.row, i > 0 && st.rowBorder]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={st.supplier} numberOfLines={1}>
                          {inv.supplier ?? g.costs.noSupplier}
                        </Text>
                        <Text style={st.sub} numberOfLines={1}>
                          {`${formatDay(inv.date, lang)} · ${g.costs.sources[inv.source as keyof typeof g.costs.sources] ?? inv.source}`}
                        </Text>
                        {inv.noPriceCount > 0 ? (
                          <View style={st.amarillo}>
                            <Text style={st.chipText}>
                              {fmt(g.costs.noPriceCount, {
                                n: inv.noPriceCount,
                              })}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={st.total}>
                        {invoiceTotalText(inv, g, c.currency, lang)}
                      </Text>
                      <Icon name="chevron-forward" size={18} />
                    </Pressable>
                  ))}
                </Panel>
              )}
            </ScrollView>
          );
        }}
      </Async>
    </Screen>
  );
}

const chip = {
  alignSelf: "flex-start" as const,
  borderRadius: 999,
  paddingHorizontal: 9,
  paddingVertical: 4,
};

const st = StyleSheet.create({
  kpis: { flexDirection: "row", gap: 10 },
  kpi: { flex: 1, borderRadius: 20, padding: 14, gap: 6, minHeight: 104 },
  kpiBlue: { backgroundColor: colors.blue },
  kpiLine: { borderWidth: 1, borderColor: colors.border },
  kpiLabelOnBlue: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.white,
    opacity: 0.85,
  },
  kpiLabel: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.ink,
    opacity: 0.62,
  },
  kpiBig: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: fonts.extrabold,
    color: colors.white,
    letterSpacing: -0.6,
  },
  ink: { color: colors.ink },
  amarillo: { ...chip, backgroundColor: colors.amarillo },
  count: { ...chip, backgroundColor: colors.amarillo },
  chipText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.ink },
  sectionRow: { marginTop: 8 },
  section: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.ink,
    letterSpacing: -0.3,
  },
  list: { paddingVertical: 4, paddingHorizontal: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    minHeight: 64,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  supplier: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
  sub: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
  total: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
});
