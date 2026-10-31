// The first screen when nobody is signed in (named so it sorts before «join»: the router opens the first open screen): cook (invite) or manager (email).

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Muted, text } from "../components/ui";
import { useG } from "../gestion/hooks";
import { colors, space } from "../theme";

export default function Entrada() {
  const g = useG();
  const router = useRouter();
  return (
    <SafeAreaView style={st.screen}>
      <View style={st.content}>
        <View style={st.head}>
          <Text style={text.title}>{g.welcome.title}</Text>
          <Muted>{g.welcome.subtitle}</Muted>
        </View>
        <Button
          label={g.welcome.manager}
          onPress={() => router.push("/login")}
        />
        <Button
          label={g.welcome.kitchen}
          variant="secondary"
          onPress={() => router.push("/join")}
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
});
