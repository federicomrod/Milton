// «Ver todos» of Ventas: every plato sold in the chosen period, best first.

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Icon, Muted } from "../components/ui";
import { useLanguage } from "../i18n";
import { fmt } from "../i18n/strings";
import { formatMoney, formatNumber } from "../gestion/format";
import { useG, useLoad } from "../gestion/hooks";
import { useManager } from "../gestion/ManagerProvider";
import type { VentasPeriod } from "../gestion/types";
import { Async, DishRow, Panel, gst } from "../gestion/ui";
import { colors, fonts, space } from "../theme";

const PERIODS: VentasPeriod[] = ["day", "week", "month", "year"];

export default function Platos() {
  const g = useG();
  const lang = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ period?: string }>();
  const period = (PERIODS as string[]).includes(params.period ?? "")
    ? (params.period as VentasPeriod)
    : "week";
  const { api, locationId } = useManager();
  const state = useLoad(`platos:${period}:${locationId ?? "all"}`, () =>
    api.ventas(period, locationId)
  );

  return (
    <SafeAreaView edges={["left", "right"]} style={st.screen}>
      <View style={[st.top, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={g.sales.back}
          onPress={() => router.back()}
          style={st.back}
        >
          <Icon name="chevron-back" size={26} />
        </Pressable>
        <Text style={st.title} accessibilityRole="header">
          {g.sales.allDishes}
        </Text>
      </View>
      <Async state={state}>
        {(v) => {
          const dishes = v.dishes ?? [];
          const best = dishes[0]?.net ?? 0;
          return (
            <ScrollView contentContainerStyle={gst.content}>
              {v.dishes === null ? (
                <Muted>{g.sales.dishesUnavailable}</Muted>
              ) : dishes.length === 0 ? (
                <Muted>{g.sales.noDishes}</Muted>
              ) : (
                <Panel style={{ gap: 14 }}>
                  {dishes.map((d, i) => (
                    <DishRow
                      key={`${d.name}-${i}`}
                      rank={i + 1}
                      name={d.name}
                      amount={formatMoney(d.net, v.currency, lang)}
                      sold={fmt(g.sales.sold, {
                        n: formatNumber(d.units, lang, 0),
                      })}
                      ratio={best > 0 ? d.net / best : 0}
                    />
                  ))}
                </Panel>
              )}
            </ScrollView>
          );
        }}
      </Async>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
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
});
