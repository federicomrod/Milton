// The first screen when nobody is signed in (a valid saved session never gets
// here). Two entrances: Gestión (owners and managers, email + password) and
// Cocina (the kitchen team: the manager's invitation the first time, then a
// personal PIN). The router opens the first open screen, so this one sorts
// before «join».

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Icon, Muted, text, type IconName } from "../components/ui";
import { useG } from "../gestion/hooks";
import { cocinaEntryRoute } from "../lib/entry";
import { getLastStaff } from "../storage/last-staff";
import { colors, fonts, space, tint } from "../theme";

function Entrance({
  icon,
  title,
  hint,
  onPress,
}: {
  icon: IconName;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [st.card, pressed && { opacity: 0.8 }]}
    >
      <View style={st.badge}>
        <Icon name={icon} size={24} color={colors.blue} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={st.cardTitle}>{title}</Text>
        <Muted>{hint}</Muted>
      </View>
      <Icon name="chevron-forward" size={20} />
    </Pressable>
  );
}

export default function Entrada() {
  const g = useG();
  const router = useRouter();

  async function cocina() {
    // A cook this phone remembers goes to their PIN, never back to the invitation.
    router.push(cocinaEntryRoute(await getLastStaff()));
  }

  return (
    <SafeAreaView style={st.screen}>
      <View style={st.content}>
        <View style={st.head}>
          <Text style={text.title}>{g.welcome.title}</Text>
          <Muted>{g.welcome.subtitle}</Muted>
        </View>
        <Entrance
          icon="stats-chart-outline"
          title={g.welcome.manager}
          hint={g.welcome.managerHint}
          onPress={() => router.push("/login")}
        />
        <Entrance
          icon="mic-outline"
          title={g.welcome.kitchen}
          hint={g.welcome.kitchenHint}
          onPress={() => void cocina()}
        />
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  content: {
    flex: 1,
    padding: space.l,
    gap: space.m,
    justifyContent: "center",
  },
  head: { gap: space.s, marginBottom: space.l },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 88,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tint.blue08,
  },
  cardTitle: { fontSize: 20, fontFamily: fonts.bold, color: colors.ink },
});
