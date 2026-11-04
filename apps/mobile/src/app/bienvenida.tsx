// Shown once after joining (or after the first PIN): the kitchen code, and the
// offer to use Face ID / fingerprint. Nothing about money.

import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useStrings } from "../i18n";
import { useSession } from "../session/SessionProvider";
import { biometricAvailable, confirmAndStorePin } from "../lib/biometric";
import {
  loadFlags,
  nativeBiometric,
  saveFlags,
  secureVault,
} from "../lib/biometric-device";
import { colors, fonts, space, tint } from "../theme";
import { Button, Card, Muted, text } from "../components/ui";

export default function Bienvenida() {
  const s = useStrings();
  const router = useRouter();
  const { kitchenCode, welcome, setWelcome } = useSession();
  const [offer, setOffer] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      const flags = await loadFlags();
      const ok =
        !!welcome &&
        !flags.enabled &&
        (await biometricAvailable(nativeBiometric));
      if (!off) setOffer(ok);
    })();
    return () => {
      off = true;
    };
  }, [welcome]);

  function done() {
    setWelcome(null);
    router.replace("/");
  }

  // Nothing to show (no code, no Face ID): do not hold the cook here.
  useEffect(() => {
    if (offer === false && !kitchenCode) done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer, kitchenCode]);

  async function useFace() {
    if (!welcome || busy) return;
    setBusy(true);
    const ok = await confirmAndStorePin(
      nativeBiometric,
      secureVault,
      welcome.pin,
      { promptMessage: s.login.biometricPrompt, cancelLabel: s.login.cancel }
    );
    if (ok) await saveFlags({ enabled: true, appLock: false });
    setBusy(false);
    done();
  }

  if (offer === null) return <SafeAreaView style={st.screen} />;
  return (
    <SafeAreaView style={st.screen}>
      <ScrollView contentContainerStyle={st.content}>
        <Text style={text.title}>{s.welcome.title}</Text>
        {kitchenCode ? (
          <Card style={st.codeCard}>
            <Muted>{s.welcome.codeTitle}</Muted>
            <Text selectable style={st.code}>
              {kitchenCode}
            </Text>
            <Muted>{s.welcome.codeHelp}</Muted>
          </Card>
        ) : null}
        {offer ? (
          <View style={st.offer}>
            <Muted>{s.welcome.biometricHelp}</Muted>
            <Button
              label={s.welcome.useBiometric}
              icon="finger-print-outline"
              onPress={useFace}
              busy={busy}
            />
          </View>
        ) : null}
        <Button
          label={s.welcome.continue}
          variant={offer ? "secondary" : "primary"}
          onPress={done}
          disabled={busy}
        />
      </ScrollView>
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
  codeCard: { gap: space.s, backgroundColor: tint.blue08 },
  code: {
    fontSize: 36,
    letterSpacing: 4,
    fontFamily: fonts.extrabold,
    color: colors.blue,
  },
  offer: { gap: space.s },
});
