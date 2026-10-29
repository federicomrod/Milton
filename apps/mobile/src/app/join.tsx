import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { redeemMessage } from "../api/client";
import { extractInviteSecret } from "../lib/invite";
import { useSession } from "../session/SessionProvider";
import { colors, space } from "../theme";
import { Button, Field, Muted, text } from "../components/ui";

export default function Join() {
  const params = useLocalSearchParams<{ secret?: string }>();
  const { api, signIn } = useSession();
  const [code, setCode] = useState(
    typeof params.secret === "string" ? params.secret : ""
  );
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    if (busy) return;
    const secret = extractInviteSecret(code);
    if (!secret) {
      setError("No reconozco ese código. Pega el código o el enlace completo.");
      return;
    }
    if (!name.trim()) {
      setError("Escribe tu nombre.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.redeem({
        secret,
        name: name.trim(),
        platform: Platform.OS,
        deviceLabel:
          Platform.OS === "ios" ? "iPhone · Expo Go" : "Android · Expo Go",
      });
      await signIn(res.deviceToken, {
        name: res.staff.name,
        location: res.location.name,
        company: null,
      });
    } catch (err) {
      setError(redeemMessage(err));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.head}>
            <Text style={text.title}>Milton Cocina</Text>
            <Muted>Entra con la invitación que te dio tu jefe.</Muted>
          </View>
          <Field
            label="Código de invitación"
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Pega el código o el enlace"
          />
          <Field
            label="Tu nombre"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            maxLength={60}
            placeholder="Por ejemplo: Luis"
          />
          {error ? <Muted>{error}</Muted> : null}
          <Button label="Entrar" onPress={enter} busy={busy} big />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  content: {
    padding: space.l,
    gap: space.l,
    flexGrow: 1,
    justifyContent: "center",
  },
  head: { gap: space.s },
});
