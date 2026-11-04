// «Ya tengo cuenta · Entrar con PIN»: a cook who lost the session signs back in
// with the kitchen code, their name and their PIN (no invite link). The answer
// never says which part was wrong. Face ID / fingerprint, when turned on, fills
// the PIN stored on this phone.

import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { friendlyMessage } from "../api/client";
import { useStrings } from "../i18n";
import { fmt } from "../i18n/strings";
import { useManager } from "../gestion/ManagerProvider";
import { useSession } from "../session/SessionProvider";
import { biometricAvailable, unlockStoredPin } from "../lib/biometric";
import {
  loadFlags,
  nativeBiometric,
  secureVault,
} from "../lib/biometric-device";
import { deviceLabel } from "../lib/device";
import {
  digitsOnly,
  isPinFormat,
  normalizeKitchenCode,
  pinLoginOutcome,
} from "../lib/pin";
import { getLastStaff } from "../storage/last-staff";
import { colors, space } from "../theme";
import { Button, Field, Muted, text } from "../components/ui";

export default function PinLogin() {
  const s = useStrings();
  const router = useRouter();
  const { api, signIn } = useSession();
  const manager = useManager();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askBoss, setAskBoss] = useState(false);
  const [bio, setBio] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      const last = await getLastStaff();
      if (!off && last) {
        setCode((c) => c || last.kitchenCode || "");
        setName((n) => n || last.name);
      }
      const flags = await loadFlags();
      const ready =
        flags.enabled && (await biometricAvailable(nativeBiometric));
      if (!off) setBio(ready);
    })();
    return () => {
      off = true;
    };
  }, []);

  async function submit(pinValue: string) {
    if (busy) return;
    const kitchenCode = normalizeKitchenCode(code);
    if (!kitchenCode || !name.trim() || !isPinFormat(pinValue)) {
      setError(s.login.missing);
      setAskBoss(false);
      return;
    }
    setBusy(true);
    setError(null);
    setAskBoss(false);
    try {
      const res = await api.pinLogin({
        code: kitchenCode,
        name: name.trim(),
        pin: pinValue,
        platform: Platform.OS,
        deviceLabel: deviceLabel(),
      });
      manager.setMode("kitchen");
      // A temporary PIN (mustChange) lands on the change-PIN screen by itself.
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
          kitchenCode: res.kitchenCode ?? kitchenCode,
        }
      );
    } catch (err) {
      const outcome = pinLoginOutcome(
        err as { status?: number; reason?: string; retryAfterSeconds?: number }
      );
      if (outcome.kind === "failed") {
        setError(s.login.failed);
        setAskBoss(true);
      } else if (outcome.kind === "locked") {
        setError(fmt(s.login.locked, { minutes: outcome.minutes }));
      } else {
        setError(friendlyMessage(err, s.errors));
      }
      setBusy(false);
    }
  }

  async function withFace() {
    const res = await unlockStoredPin(nativeBiometric, secureVault, {
      promptMessage: s.login.biometricPrompt,
      cancelLabel: s.login.cancel,
    });
    // Cancelled or unavailable: the PIN field is right there.
    if (res.kind === "pin") {
      setPin(res.pin);
      void submit(res.pin);
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
            <Text style={text.title}>{s.login.title}</Text>
            <Muted>{s.login.intro}</Muted>
          </View>
          {bio ? (
            <Button
              label={s.login.biometric}
              icon="finger-print-outline"
              onPress={withFace}
              busy={busy}
            />
          ) : null}
          <Field
            label={s.login.codeLabel}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={s.login.codePlaceholder}
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
            label={s.login.pinLabel}
            value={pin}
            onChangeText={(v) => setPin(digitsOnly(v))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            autoComplete="off"
            textContentType="none"
          />
          {error ? <Muted>{error}</Muted> : null}
          {askBoss ? <Muted>{s.login.askBoss}</Muted> : null}
          <Button
            label={s.login.enter}
            variant={bio ? "secondary" : "primary"}
            onPress={() => void submit(pin)}
            busy={busy}
          />
          <Button
            label={s.login.useInvite}
            variant="secondary"
            onPress={() => router.replace("/join")}
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
