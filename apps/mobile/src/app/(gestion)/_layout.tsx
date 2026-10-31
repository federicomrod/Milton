import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useG } from "../../gestion/hooks";
import { colors, fonts, tint } from "../../theme";

export default function GestionTabs() {
  const g = useG();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: tint.ink45,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 86,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontFamily: fonts.semibold },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: g.tabs.home,
          tabBarIcon: ({ color }) => (
            <Ionicons name="home-outline" size={24} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="ventas"
        options={{
          title: g.tabs.sales,
          tabBarIcon: ({ color }) => (
            <Ionicons
              name="bar-chart-outline"
              size={24}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="rentabilidad"
        options={{
          title: g.tabs.profit,
          tabBarIcon: ({ color }) => (
            <Ionicons
              name="trending-up-outline"
              size={24}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="costos"
        options={{
          title: g.tabs.costs,
          tabBarIcon: ({ color }) => (
            <Ionicons
              name="receipt-outline"
              size={24}
              color={color as string}
            />
          ),
        }}
      />
    </Tabs>
  );
}
