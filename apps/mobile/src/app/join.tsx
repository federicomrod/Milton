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
import { deviceLabel } from "../lib/device";
import { extractInviteSecret } from "../lib/invite";
import { digitsOnly, pinProblem } from "../lib/pin";
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
  const [pin, setPin] = useState("");
  const [pinAgain, setPinAgain] = useState("");
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
    const problem = pinProblem(pin, pinAgain);
    if (problem) {
      setError(s.pin[problem]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.redeem({
        secret,
        name: name.trim(),
        platform: Platform.OS,
        deviceLabel: deviceLabel(),
        pin,
      });
      // A manager adding Cocina to this phone lands in Cocina.
      manager.setMode("kitchen");
      await signIn(
        res.deviceToken,
        {
          name: res.staff.name,
          location: res.location.name,
          company: null,
          language: res.language,
        },
        {
          staffId: res.staff.id,
          pin: res.pin,
          kitchenCode: res.kitchenCode,
          // The welcome screen shows the kitchen code once (and the Face ID offer).
          welcome: { pin },
        }
      );
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
          <Field
            label={s.join.pinLabel}
            value={pin}
            onChangeText={(v) => setPin(digitsOnly(v))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            autoComplete="off"
            textContentType="none"
          />
          <Field
            label={s.join.pinConfirmLabel}
            value={pinAgain}
            onChangeText={(v) => setPinAgain(digitsOnly(v))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            autoComplete="off"
            textContentType="none"
          />
          <Muted>{s.join.pinHint}</Muted>
          {error ? <Muted>{error}</Muted> : null}
          <Button label={s.join.enter} onPress={enter} busy={busy} />
          <Button
            label={s.join.haveAccount}
            variant="secondary"
            onPress={() => router.push("/pin")}
          />
          <Button
            label={g.login.back}
            variant="secondary"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/entrada")
            }
          />
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
