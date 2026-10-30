import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Button, Card, Muted, Screen, text } from "../components/ui";
import { useStrings } from "../i18n";
import { fmt } from "../i18n/strings";
import { useSession } from "../session/SessionProvider";
import { space } from "../theme";

function Value({ children }: { children: React.ReactNode }) {
  return <Text style={text.big}>{children}</Text>;
}

export default function Cuenta() {
  const s = useStrings();
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
      <ScrollView contentContainerStyle={st.content}>
        <Card style={st.card}>
          <View style={st.block}>
            <Muted>{s.account.name}</Muted>
            <Value>{profile?.name ?? "—"}</Value>
          </View>
          <View style={st.block}>
            <Muted>{s.account.location}</Muted>
            <Value>{profile?.location || "—"}</Value>
          </View>
          {profile?.company ? (
            <View style={st.block}>
              <Muted>{s.account.company}</Muted>
              <Value>{profile.company}</Value>
            </View>
          ) : null}
        </Card>
        <Button
          label={s.account.logout}
          variant="secondary"
          icon="log-out-outline"
          onPress={leave}
          busy={busy}
        />
        <Muted>
          {fmt(s.account.version, {
            version: Constants.expoConfig?.version ?? "",
          })}
        </Muted>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: space.l, gap: space.l },
  card: { gap: space.m },
  block: { gap: 2 },
});
