import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStrings } from "../../i18n";
import { colors, fonts, tint } from "../../theme";

export default function TabsLayout() {
  const s = useStrings();
  return (
    <Tabs
      screenOptions={{
        // Each screen draws its own white header (greeting, avatar).
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: tint.ink45,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 84,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 13, fontFamily: fonts.semibold },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: s.tabs.send,
          tabBarIcon: ({ color }) => (
            <Ionicons name="mic-outline" size={26} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="historial"
        options={{
          title: s.tabs.history,
          tabBarIcon: ({ color }) => (
            <Ionicons name="time-outline" size={26} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}
