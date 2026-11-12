// Costos: costo de ventas and the month's cost KPIs first, then «Facturas por
// revisar» as compact rows (supplier, date, total, how many lines have no
// price). A row opens the invoice (app/factura.tsx) with its lines and
// Aprobar / Rechazar. A missing price says «Sin precio», never $0.

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
import {
  fixedCostView,
  foodCostView,
  qualityRows,
} from "../../gestion/costs-core";
import { Async, GestionHeader, Panel, gst } from "../../gestion/ui";
import { colors, fonts } from "../../theme";

export default function Costos() {
  const g = useG();
  const lang = useLanguage();
  const router = useRouter();
  const { api, locationId, locations } = useManager();
  const { fontScale } = useWindowDimensions();
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
          const foodView = c.kpis
            ? foodCostView({
                pct: c.kpis.foodCostPct,
                reasons: c.kpis.reasons,
                month: c.kpis.month,
                g,
                lang,
              })
            : null;
          const fixedView = c.kpis
            ? fixedCostView({
                total: c.kpis.fixedTotal,
                reasons: c.kpis.reasons,
                month: c.kpis.month,
                g,
                lang,
              })
            : null;
          const quality = c.kpis
            ? qualityRows({
                reasons: c.kpis.reasons,
                pendingInvoices: c.pendingCount,
                month: c.kpis.month,
                g,
                lang,
              })
            : null;
          // Side by side only when both are short numbers and the text is not
          // large: a reason needs the full width.
          const stack =
            foodView?.value === null ||
            fixedView?.value === null ||
            fontScale > 1.3;
          return (
            <ScrollView contentContainerStyle={gst.content}>
              {c.kpis === null ? (
                <Muted>{g.costs.kpisNeedRestaurant}</Muted>
              ) : (
                <>
                  <View style={stack ? st.kpisStack : st.kpis}>
                    <View style={[st.kpi, stack && st.kpiFull, st.kpiBlue]}>
                      <Text style={st.kpiLabelOnBlue}>
                        {g.costs.costOfSales}
                      </Text>
                      {foodView!.value !== null ? (
                        <Text style={st.kpiBig}>
                          {formatFraction(foodView!.value / 100, lang)}
                        </Text>
                      ) : (
                        <>
                          <Text style={st.reasonOnBlue}>
                            {foodView!.reason}
                          </Text>
                          {foodView!.next ? (
                            <Text style={st.nextOnBlue}>{foodView!.next}</Text>
                          ) : null}
                        </>
                      )}
                      {foodView!.note ? (
                        <Text style={st.noteOnBlue}>{foodView!.note}</Text>
                      ) : null}
                      {c.kpis.basis === "estimada" &&
                      foodView!.value !== null ? (
                        <View style={st.amarillo}>
                          <Text style={st.chipText}>{g.costs.estimated}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={[st.kpi, stack && st.kpiFull, st.kpiLine]}>
                      <Text style={st.kpiLabel}>{g.costs.fixedMonth}</Text>
                      {fixedView!.value !== null ? (
                        <Text style={[st.kpiBig, st.ink]}>
                          {money0(fixedView!.value)}
                        </Text>
                      ) : (
                        <>
                          <Text style={st.reason}>{fixedView!.reason}</Text>
                          {fixedView!.next ? (
                            <Text style={st.next}>{fixedView!.next}</Text>
                          ) : null}
                        </>
                      )}
                    </View>
                  </View>
                  {c.kpis.sales !== null ? (
                    <Muted>
                      {`${fmt(g.costs.salesOf, { month: monthLabel(c.kpis.month, lang) })} · ${money0(c.kpis.sales)}`}
                    </Muted>
                  ) : null}
                  {quality ? (
                    <Panel style={st.quality}>
                      <Text style={st.qualityTitle}>{g.costs.quality}</Text>
                      {quality.rows.map((row) => (
                        <View key={row.key} style={st.qrow}>
                          <Icon
                            name={
                              row.tone === "ok"
                                ? "checkmark-circle"
                                : "alert-circle"
                            }
                            size={20}
                            color={row.tone === "ok" ? colors.blue : colors.ink}
                          />
                          <View style={{ flex: 1, gap: 6 }}>
                            <View style={st.qline}>
                              <Text style={st.qlabel}>{row.label}</Text>
                              <Text style={st.qvalue}>{row.value}</Text>
                            </View>
                            {row.ratio !== undefined ? (
                              <View style={st.qtrack}>
                                <View
                                  style={[
                                    st.qfill,
                                    {
                                      width: `${Math.round(Math.min(1, Math.max(0, row.ratio)) * 100)}%`,
                                    },
                                  ]}
                                />
                              </View>
                            ) : null}
                          </View>
                        </View>
                      ))}
                      {quality.note ? <Muted>{quality.note}</Muted> : null}
                    </Panel>
                  ) : null}
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
  kpisStack: { gap: 10 },
  kpi: { flex: 1, borderRadius: 20, padding: 14, gap: 6, minHeight: 104 },
  kpiFull: { flex: 0, alignSelf: "stretch" },
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
  reasonOnBlue: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fonts.semibold,
    color: colors.white,
  },
  nextOnBlue: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.bold,
    color: colors.white,
  },
  noteOnBlue: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.white,
    opacity: 0.85,
  },
  reason: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  next: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.bold,
    color: colors.blue,
  },
  quality: { gap: 14 },
  qualityTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.ink },
  qrow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  qline: { gap: 2 },
  qlabel: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
  qvalue: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.ink,
  },
  qtrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  qfill: { height: 8, borderRadius: 4, backgroundColor: colors.mint },
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
