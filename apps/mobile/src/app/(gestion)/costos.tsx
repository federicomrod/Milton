// Costos: the pending Compras invoices with their lines visible, and Aprobar /
// Rechazar. A person taps; nothing is automatic. A line without a price says
// «Sin precio» and one without a quantity «Falta» (never $0). Below: the
// month's cost KPIs, read only.

import React from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Chip, Muted, Screen } from "../../components/ui";
import { ApiError } from "../../api/client";
import { useLanguage } from "../../i18n";
import { fmt } from "../../i18n/strings";
import {
  formatDay,
  formatFraction,
  formatMoney,
  formatNumber,
  monthLabel,
} from "../../gestion/format";
import { useG, useLoad } from "../../gestion/hooks";
import { useManager } from "../../gestion/ManagerProvider";
import type { InvoiceLine, PendingInvoice } from "../../gestion/types";
import { Async, GestionHeader, SectionTitle, gst } from "../../gestion/ui";
import { showToast } from "../../lib/toast";
import { colors, fonts, space } from "../../theme";

export default function Costos() {
  const g = useG();
  const lang = useLanguage();
  const { api, locationId, locations } = useManager();
  const location =
    locationId ?? (locations.length === 1 ? locations[0].id : null);
  const state = useLoad(`costos:${location ?? "all"}`, () =>
    api.costos(location)
  );
  const [busy, setBusy] = React.useState<string | null>(null);

  function confirm(message: string, onYes: () => void) {
    Alert.alert(message, undefined, [
      { text: g.costs.cancel, style: "cancel" },
      { text: g.costs.approve, onPress: onYes },
    ]);
  }

  async function approve(inv: PendingInvoice) {
    setBusy(inv.id);
    try {
      const res = await api.approveInvoice(inv.id);
      const skipped = res.skipped_lines?.length ?? 0;
      showToast(
        skipped > 0
          ? fmt(g.costs.approvedWithSkips, { n: skipped })
          : g.costs.approved,
        5000
      );
    } catch (err) {
      showToast(
        err instanceof ApiError && err.kind === "client"
          ? g.costs.cannotPost
          : g.errors.generic,
        5000
      );
    } finally {
      setBusy(null);
      state.reload();
    }
  }

  async function reject(inv: PendingInvoice) {
    setBusy(inv.id);
    try {
      await api.rejectInvoice(inv.id);
      showToast(g.costs.rejected);
    } catch {
      showToast(g.errors.generic);
    } finally {
      setBusy(null);
      state.reload();
    }
  }

  return (
    <Screen>
      <GestionHeader title={g.costs.title} />
      <Async state={state}>
        {(c) => {
          const money = (n: number | null) =>
            formatMoney(n, c.currency, lang, 2);
          const money0 = (n: number | null) => formatMoney(n, c.currency, lang);
          const lineTotal = (l: InvoiceLine) =>
            l.missing.includes("quantity") && l.unitCost !== null
              ? g.costs.missing
              : l.lineTotal !== null
                ? money(l.lineTotal)
                : g.costs.noPrice;
          // «Falta» once when both the quantity and the unit are missing.
          const lineDetail = (l: InvoiceLine) => {
            const noQty = l.missing.includes("quantity");
            const noUnit = l.missing.includes("unit");
            const qtyUnit =
              noQty && noUnit
                ? g.costs.missing
                : [
                    noQty ? g.costs.missing : formatNumber(l.quantity, lang, 2),
                    noUnit ? g.costs.missing : (l.unit ?? ""),
                  ]
                    .join(" ")
                    .trim();
            return `${qtyUnit} · ${l.unitCost !== null ? money(l.unitCost) : g.costs.noPrice}`;
          };
          const invoiceTotal = (i: PendingInvoice) =>
            i.total !== null
              ? money(i.total)
              : i.priced
                ? g.costs.missing
                : g.costs.noPrice;
          return (
            <ScrollView contentContainerStyle={gst.content}>
              <SectionTitle>{g.costs.pending}</SectionTitle>
              {c.invoices.length === 0 ? (
                <Muted>{g.costs.none}</Muted>
              ) : (
                c.invoices.map((inv) => {
                  const ready = inv.lines.some(
                    (l) => !l.incomplete && l.matched
                  );
                  return (
                    <Card key={inv.id} style={gst.card}>
                      <View style={gst.row}>
                        <View style={{ flex: 1 }}>
                          <Text style={gst.bold} numberOfLines={2}>
                            {inv.supplier ?? g.costs.noSupplier}
                          </Text>
                          <Muted>
                            {`${formatDay(inv.date, lang)} · ${g.costs.sources[inv.source as keyof typeof g.costs.sources] ?? inv.source}`}
                          </Muted>
                        </View>
                        <Text style={gst.bold}>{invoiceTotal(inv)}</Text>
                      </View>
                      {inv.lines.map((l) => (
                        <View key={l.id} style={[gst.row, st.line]}>
                          <View style={{ flex: 1 }}>
                            <Text style={gst.body} numberOfLines={2}>
                              {l.name}
                            </Text>
                            <Muted>{lineDetail(l)}</Muted>
                          </View>
                          <Text style={st.lineTotal}>{lineTotal(l)}</Text>
                        </View>
                      ))}
                      {inv.lineCount > inv.lines.length ? (
                        <Muted>
                          {fmt(g.costs.moreLines, {
                            n: inv.lineCount - inv.lines.length,
                          })}
                        </Muted>
                      ) : null}
                      {c.canApprove ? (
                        <View style={st.actions}>
                          {!ready ? (
                            <Chip
                              tone="amarillo"
                              label={g.costs.completeInWeb}
                            />
                          ) : null}
                          <Button
                            label={
                              busy === inv.id
                                ? g.costs.working
                                : g.costs.approve
                            }
                            disabled={!ready || busy !== null}
                            busy={busy === inv.id}
                            onPress={() =>
                              confirm(
                                g.costs.confirmApprove,
                                () => void approve(inv)
                              )
                            }
                          />
                          <Button
                            label={g.costs.reject}
                            variant="secondary"
                            disabled={busy !== null}
                            onPress={() =>
                              Alert.alert(g.costs.confirmReject, undefined, [
                                { text: g.costs.cancel, style: "cancel" },
                                {
                                  text: g.costs.reject,
                                  onPress: () => void reject(inv),
                                },
                              ])
                            }
                          />
                        </View>
                      ) : (
                        <Muted>{g.costs.readOnly}</Muted>
                      )}
                    </Card>
                  );
                })
              )}

              <SectionTitle>{g.costs.kpis}</SectionTitle>
              {c.kpis === null ? (
                <Muted>{g.costs.kpisNeedRestaurant}</Muted>
              ) : !c.kpis.hasData ? (
                <Muted>{g.costs.kpisNoData}</Muted>
              ) : (
                <Card style={gst.card}>
                  <View style={gst.row}>
                    <Muted>{monthLabel(c.kpis.month, lang)}</Muted>
                    {c.kpis.basis === "estimada" ? (
                      <Chip tone="amarillo" label={g.costs.estimated} />
                    ) : null}
                  </View>
                  <View style={gst.row}>
                    <Text style={gst.body}>{g.costs.sales}</Text>
                    <Text style={gst.bold}>{money0(c.kpis.sales)}</Text>
                  </View>
                  <View style={gst.row}>
                    <Text style={gst.body}>{g.costs.foodCost}</Text>
                    <Text style={gst.bold}>
                      {c.kpis.foodCostPct === null
                        ? "—"
                        : formatFraction(c.kpis.foodCostPct / 100, lang)}
                    </Text>
                  </View>
                  <View style={gst.row}>
                    <Text style={gst.body}>{g.costs.fixed}</Text>
                    <Text style={gst.bold}>{money0(c.kpis.fixedTotal)}</Text>
                  </View>
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
  line: {
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineTotal: { fontSize: 15, fontFamily: fonts.semibold, color: colors.ink },
  actions: { gap: space.s, marginTop: space.s },
});
