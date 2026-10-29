import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Button, Muted, Screen, text } from "../components/ui";
import { useSession } from "../session/SessionProvider";
import { space } from "../theme";

function Value({ children }: { children: React.ReactNode }) {
  return <Text style={text.big}>{children}</Text>;
}

export default function Cuenta() {
  const { profile, api, signOut } = useSession();
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    try {
      await api.logout(); // revokes this phone on the server
    } catch {
      // Offline or already revoked: signing out here is enough.
    }
    await signOut();
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.block}>
          <Muted>Nombre</Muted>
          <Value>{profile?.name ?? "—"}</Value>
        </View>
        <View style={s.block}>
          <Muted>Local</Muted>
          <Value>{profile?.location || "—"}</Value>
        </View>
        {profile?.company ? (
          <View style={s.block}>
            <Muted>Empresa</Muted>
            <Value>{profile.company}</Value>
          </View>
        ) : null}
        <Button
          label="Cerrar sesión"
          variant="secondary"
          onPress={leave}
          busy={busy}
        />
        <Muted>Milton Cocina {Constants.expoConfig?.version ?? ""}</Muted>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.l },
  block: { gap: space.xs },
});
