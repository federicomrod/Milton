import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { ApiError, friendlyMessage } from "../api/client";
import { Button, Card, Field, Muted, Screen, text } from "../components/ui";
import { useStrings } from "../i18n";
import { fmt } from "../i18n/strings";
import { useSession } from "../session/SessionProvider";
import {
  biometricAvailable,
  confirmAndStorePin,
  disableBiometric,
} from "../lib/biometric";
import {
  loadFlags,
  nativeBiometric,
  saveFlags,
  secureVault,
  subscribeFlags,
  type BiometricFlags,
} from "../lib/biometric-device";
import { digitsOnly, isPinFormat, lockMinutes } from "../lib/pin";
import { colors, fonts, space } from "../theme";

function Value({ children }: { children: React.ReactNode }) {
  return <Text style={text.big}>{children}</Text>;
}

export default function Cuenta() {
  const s = useStrings();
  const { profile, api, signOut, kitchenCode } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [flags, setFlags] = useState<BiometricFlags>({
    enabled: false,
    appLock: false,
  });
  const [available, setAvailable] = useState(false);
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState("");
  const [bioError, setBioError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    const read = () =>
      void loadFlags().then((f) => {
        if (!off) setFlags(f);
      });
    read();
    void biometricAvailable(nativeBiometric).then((ok) => {
      if (!off) setAvailable(ok);
    });
    const unsub = subscribeFlags(read);
    return () => {
      off = true;
      unsub();
    };
  }, []);

  async function turnOffFace() {
    await disableBiometric(secureVault);
    await saveFlags({ enabled: false, appLock: false });
    setAsking(false);
    setPin("");
  }

  /** The PIN is checked on the server (it re-saves the same PIN), then kept on this phone. */
  async function turnOnFace() {
    if (busy) return;
    if (!isPinFormat(pin)) {
      setBioError(s.pin.format);
      return;
    }
    setBusy(true);
    setBioError(null);
    try {
      await api.setPin({ pin, currentPin: pin });
      const ok = await confirmAndStorePin(nativeBiometric, secureVault, pin, {
        promptMessage: s.login.biometricPrompt,
        cancelLabel: s.login.cancel,
      });
      if (ok) {
        await saveFlags({ enabled: true, appLock: false });
        setAsking(false);
        setPin("");
      }
    } catch (err) {
      if (err instanceof ApiError && err.reason === "wrong_pin") {
        setBioError(s.account.biometricWrongPin);
      } else if (err instanceof ApiError && err.reason === "locked") {
        setBioError(
          fmt(s.pin.locked, { minutes: lockMinutes(err.retryAfterSeconds) })
        );
      } else {
        setBioError(friendlyMessage(err, s.errors));
      }
    } finally {
      setBusy(false);
    }
  }

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
          {kitchenCode ? (
            <View style={st.block}>
              <Muted>{s.account.kitchenCode}</Muted>
              <Text selectable style={st.code}>
                {kitchenCode}
              </Text>
            </View>
          ) : null}
        </Card>
        {profile?.selfDevice ? null : (
          <Card style={st.card}>
            <Muted>{s.account.security}</Muted>
            <Button
              label={s.account.changePin}
              variant="secondary"
              icon="keypad-outline"
              onPress={() => router.push("/pin-nuevo")}
            />
            {available ? (
              <>
                <View style={st.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={text.body}>{s.account.biometric}</Text>
                    <Muted>{s.account.biometricHint}</Muted>
                  </View>
                  <Switch
                    accessibilityLabel={s.account.biometric}
                    value={flags.enabled || asking}
                    onValueChange={(on) => {
                      if (on) setAsking(true);
                      else void turnOffFace();
                    }}
                    trackColor={{ true: colors.blue, false: colors.border }}
                    thumbColor={colors.white}
                  />
                </View>
                {asking && !flags.enabled ? (
                  <View style={st.block}>
                    <Field
                      label={s.account.biometricPin}
                      value={pin}
                      onChangeText={(v) => setPin(digitsOnly(v))}
                      keyboardType="number-pad"
                      secureTextEntry
                      maxLength={6}
                      autoComplete="off"
                      textContentType="none"
                    />
                    {bioError ? <Muted>{bioError}</Muted> : null}
                    <Button
                      label={s.account.biometricSave}
                      onPress={() => void turnOnFace()}
                      busy={busy}
                    />
                  </View>
                ) : null}
                {flags.enabled ? (
                  <View style={st.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={text.body}>{s.account.appLock}</Text>
                      <Muted>{s.account.appLockHint}</Muted>
                    </View>
                    <Switch
                      accessibilityLabel={s.account.appLock}
                      value={flags.appLock}
                      onValueChange={(on) =>
                        void saveFlags({ ...flags, appLock: on })
                      }
                      trackColor={{ true: colors.blue, false: colors.border }}
                      thumbColor={colors.white}
                    />
                  </View>
                ) : null}
              </>
            ) : null}
          </Card>
        )}
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
  code: { fontSize: 20, fontFamily: fonts.extrabold, color: colors.blue },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.m },
});
