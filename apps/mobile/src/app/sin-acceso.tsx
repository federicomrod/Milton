// A signed-in user whose role has no access to Gestión: a clear message.

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Muted, text } from "../components/ui";
import { useG } from "../gestion/hooks";
import { useManager } from "../gestion/ManagerProvider";
import { colors, space } from "../theme";

export default function SinAcceso() {
  const g = useG();
  const { signOut } = useManager();
  return (
    <SafeAreaView style={st.screen}>
      <View style={st.content}>
        <Text style={text.title}>{g.noAccess.title}</Text>
        <Muted>{g.noAccess.text}</Muted>
        <Button
          label={g.noAccess.signOut}
          variant="secondary"
          onPress={() => void signOut()}
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
});
