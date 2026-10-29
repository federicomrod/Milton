import React from "react";
import { Pressable, Text } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { MIN_TOUCH, colors, font, space } from "../../theme";

function AccountButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cuenta"
      onPress={() => router.push("/cuenta")}
      style={{
        minHeight: MIN_TOUCH,
        minWidth: MIN_TOUCH,
        justifyContent: "center",
        paddingHorizontal: space.m,
      }}
    >
      <Text
        style={{ fontSize: font.body, fontWeight: "700", color: colors.blue }}
      >
        Cuenta
      </Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { fontWeight: "700", color: colors.ink },
        headerShadowVisible: false,
        headerRight: () => <AccountButton />,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.ink,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          height: 72,
        },
        tabBarLabelStyle: { fontSize: 18, fontWeight: "800" },
        tabBarIconStyle: { display: "none" },
        tabBarItemStyle: { justifyContent: "center" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Enviar" }} />
      <Tabs.Screen name="historial" options={{ title: "Historial" }} />
    </Tabs>
  );
}
