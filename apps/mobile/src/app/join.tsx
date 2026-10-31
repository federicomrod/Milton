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
import { useLocalSearchParams, useRouter } from "expo-router";
import { redeemMessage } from "../api/client";
import { useStrings } from "../i18n";
import { extractInviteSecret } from "../lib/invite";
import { useG } from "../gestion/hooks";
import { useManager } from "../gestion/ManagerProvider";
import { useSession } from "../session/SessionProvider";
import { colors, space } from "../theme";
import { Button, Field, Muted, text } from "../components/ui";

export default function Join() {
  const s = useStrings();
  const g = useG();
  const router = useRouter();
  const params = useLocalSearchParams<{ secret?: string }>();
  const { api, signIn } = useSession();
  const manager = useManager();
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
      setError(s.join.codeUnknown);
      return;
    }
    if (!name.trim()) {
      setError(s.join.nameMissing);
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
      // A manager adding Cocina to this phone lands in Cocina.
      manager.setMode("kitchen");
      await signIn(res.deviceToken, {
        name: res.staff.name,
        location: res.location.name,
        company: null,
        language: res.language,
      });
    } catch (err) {
      setError(redeemMessage(err, s.errors));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={st.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={st.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={st.head}>
            <Text style={text.title}>{s.appName}</Text>
            <Muted>{s.join.intro}</Muted>
          </View>
          <Field
            label={s.join.codeLabel}
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={s.join.codePlaceholder}
          />
          <Field
            label={s.join.nameLabel}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            maxLength={60}
            placeholder={s.join.namePlaceholder}
          />
          {error ? <Muted>{error}</Muted> : null}
          <Button label={s.join.enter} onPress={enter} busy={busy} />
          {manager.status === "signedOut" ? (
            <Button
              label={g.welcome.managerLink}
              variant="secondary"
              onPress={() => router.push("/login")}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  content: {
    padding: space.l,
    gap: space.l,
    flexGrow: 1,
    justifyContent: "center",
  },
  head: { gap: space.s },
});
