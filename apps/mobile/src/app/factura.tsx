// One pending Compras invoice: its lines, and Aprobar / Rechazar. A person
// taps; nothing is automatic. A line without a price says «Sin precio» and one
// without a quantity «Falta» (never zero).

import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "../api/client";
import { Button, Icon, Muted } from "../components/ui";
import { useLanguage } from "../i18n";
import { fmt } from "../i18n/strings";
import { formatDay } from "../gestion/format";
import { useG, useLoad } from "../gestion/hooks";
import {
  invoiceTotalText,
  lineDetailText,
  lineTotalText,
} from "../gestion/invoice";
import { useManager } from "../gestion/ManagerProvider";
import { Async, Panel, gst } from "../gestion/ui";
import { showToast } from "../lib/toast";
import { colors, fonts, space } from "../theme";

export default function Factura() {
  const g = useG();
  const lang = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { api, locationId, locations } = useManager();
  const location =
    locationId ?? (locations.length === 1 ? locations[0].id : null);
  const state = useLoad(`factura:${id ?? ""}`, () => api.costos(location));
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null);

  function done() {
    router.back();
  }

  async function approve() {
    if (!id) return;
    setBusy("approve");
    try {
      const res = await api.approveInvoice(id);
      const skipped = res.skipped_lines?.length ?? 0;
      showToast(
        skipped > 0
          ? fmt(g.costs.approvedWithSkips, { n: skipped })
          : g.costs.approved,
        5000
      );
      done();
    } catch (err) {
      showToast(
        err instanceof ApiError && err.kind === "client"
          ? g.costs.cannotPost
          : g.errors.generic,
        5000
      );
      setBusy(null);
      state.reload();
    }
  }

  async function reject() {
    if (!id) return;
    setBusy("reject");
    try {
      await api.rejectInvoice(id);
      showToast(g.costs.rejected);
      done();
    } catch {
      showToast(g.errors.generic);
      setBusy(null);
      state.reload();
    }
  }

  return (
    <SafeAreaView edges={["left", "right"]} style={st.screen}>
      <View style={[st.top, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={g.costs.back}
          onPress={() => router.back()}
          style={st.back}
        >
          <Icon name="chevron-back" size={26} />
        </Pressable>
        <Text style={st.title} accessibilityRole="header">
          {g.costs.invoice}
        </Text>
      </View>
      <Async state={state}>
        {(c) => {
          const inv = c.invoices.find((i) => i.id === id);
          if (!inv) return <Muted style={st.pad}>{g.costs.none}</Muted>;
          const ready = inv.lines.some((l) => !l.incomplete && l.matched);
          return (
            <>
              <ScrollView contentContainerStyle={gst.content}>
                <View style={{ gap: 2 }}>
                  <Text style={st.supplier}>
                    {inv.supplier ?? g.costs.noSupplier}
                  </Text>
                  <Muted>
                    {`${formatDay(inv.date, lang)} · ${g.costs.sources[inv.source as keyof typeof g.costs.sources] ?? inv.source}`}
                  </Muted>
                  <Text style={st.total}>
                    {invoiceTotalText(inv, g, c.currency, lang)}
                  </Text>
                </View>
                <Panel style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
                  <Text style={st.lines}>{g.costs.lines}</Text>
                  {inv.lines.map((l, i) => (
                    <View key={l.id} style={[st.line, i > 0 && st.lineBorder]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={gst.body} numberOfLines={2}>
                          {l.name}
                        </Text>
                        <Muted>{lineDetailText(l, g, c.currency, lang)}</Muted>
                      </View>
                      <Text style={st.lineTotal}>
                        {lineTotalText(l, g, c.currency, lang)}
                      </Text>
                    </View>
                  ))}
                  {inv.lineCount > inv.lines.length ? (
                    <Muted style={{ paddingVertical: 10 }}>
                      {fmt(g.costs.moreLines, {
                        n: inv.lineCount - inv.lines.length,
                      })}
                    </Muted>
                  ) : null}
                </Panel>
              </ScrollView>
              <View style={[st.actions, { paddingBottom: insets.bottom + 12 }]}>
                {c.canApprove ? (
                  <>
                    {!ready ? (
                      <View style={st.alert}>
                        <Text style={st.alertText}>
                          {g.costs.completeInWeb}
                        </Text>
                      </View>
                    ) : null}
                    <Button
                      label={
                        busy === "approve" ? g.costs.working : g.costs.approve
                      }
                      disabled={!ready || busy !== null}
                      busy={busy === "approve"}
                      onPress={() =>
                        Alert.alert(g.costs.confirmApprove, undefined, [
                          { text: g.costs.cancel, style: "cancel" },
                          {
                            text: g.costs.approve,
                            onPress: () => void approve(),
                          },
                        ])
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
                            onPress: () => void reject(),
                          },
                        ])
                      }
                    />
                  </>
                ) : (
                  <Muted>{g.costs.readOnly}</Muted>
                )}
              </View>
            </>
          );
        }}
      </Async>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  pad: { padding: space.l },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.m,
    paddingBottom: 10,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 24, fontFamily: fonts.extrabold, color: colors.ink },
  supplier: { fontSize: 22, fontFamily: fonts.extrabold, color: colors.ink },
  total: {
    fontSize: 32,
    lineHeight: 38,
    fontFamily: fonts.extrabold,
    color: colors.ink,
    marginTop: 4,
  },
  lines: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.ink,
    paddingVertical: 12,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  lineBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  lineTotal: { fontSize: 15, fontFamily: fonts.semibold, color: colors.ink },
  actions: {
    gap: 8,
    paddingHorizontal: space.l,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  alert: {
    backgroundColor: colors.amarillo,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  alertText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.ink },
});
