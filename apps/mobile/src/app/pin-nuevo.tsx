// «Crea tu PIN» / «Cambia tu PIN». Forced (no way around it) when the cook has
// no PIN yet or a manager set a temporary one; also opened from Cuenta to
// change it on purpose (then the current PIN is asked).

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
import { useRouter } from "expo-router";
import { ApiError, friendlyMessage } from "../api/client";
import { useStrings } from "../i18n";
import { fmt } from "../i18n/strings";
import { useSession } from "../session/SessionProvider";
import { biometricAvailable } from "../lib/biometric";
import {
  loadFlags,
  nativeBiometric,
  secureVault,
} from "../lib/biometric-device";
import { digitsOnly, lockMinutes, pinProblem } from "../lib/pin";
import { colors, space } from "../theme";
import { Button, Field, Muted, text } from "../components/ui";

export default function PinNuevo() {
  const s = useStrings();
  const router = useRouter();
  const { api, gate, setPin: setPinState, setWelcome, signOut } = useSession();
  // No gate = the cook came here from Cuenta to change a PIN they have.
  const voluntary = gate === "none";
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = gate === "create" ? s.pin.createTitle : s.pin.changeTitle;
  const intro =
    gate === "create"
      ? s.pin.createIntro
      : gate === "change"
        ? s.pin.tempIntro
        : s.pin.hint;

  async function save() {
    if (busy) return;
    if (voluntary && !current) {
      setError(s.pin.wrong);
      return;
    }
    const problem = pinProblem(pin, again);
    if (problem) {
      setError(s.pin[problem]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setPin({ pin, currentPin: voluntary ? current : undefined });
      setPinState({ set: true, mustChange: false });
      const flags = await loadFlags();
      if (flags.enabled) {
        // The PIN stored for Face ID must follow the new one.
        await secureVault.set(pin).catch(() => undefined);
      }
      if (voluntary) {
        router.back();
        return;
      }
      if (!flags.enabled && (await biometricAvailable(nativeBiometric))) {
        setWelcome({ pin });
        router.replace("/bienvenida");
        return;
      }
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.reason === "wrong_pin") {
        setError(s.pin.wrong);
      } else if (
        err instanceof ApiError &&
        (err.reason === "locked" || err.status === 429)
      ) {
        setError(
          fmt(s.pin.locked, { minutes: lockMinutes(err.retryAfterSeconds) })
        );
      } else {
        setError(friendlyMessage(err, s.errors));
      }
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
            <Text style={text.title}>{title}</Text>
            <Muted>{intro}</Muted>
          </View>
          {voluntary ? (
            <Field
              label={s.pin.currentLabel}
              value={current}
              onChangeText={(v) => setCurrent(digitsOnly(v))}
              {...pinInput}
            />
          ) : null}
          <Field
            label={s.pin.newLabel}
            value={pin}
            onChangeText={(v) => setPin(digitsOnly(v))}
            {...pinInput}
          />
          <Field
            label={s.pin.confirmLabel}
            value={again}
            onChangeText={(v) => setAgain(digitsOnly(v))}
            {...pinInput}
          />
          <Muted>{s.pin.hint}</Muted>
          {error ? <Muted>{error}</Muted> : null}
          <Button label={s.pin.save} onPress={save} busy={busy} />
          {!voluntary ? (
            // Never a dead end: a cook who cannot continue can leave.
            <Button
              label={s.account.logout}
              variant="secondary"
              onPress={() => void signOut()}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const pinInput = {
  keyboardType: "number-pad" as const,
  secureTextEntry: true,
  maxLength: 6,
  autoComplete: "off" as const,
  textContentType: "none" as const,
};

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
