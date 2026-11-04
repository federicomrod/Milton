// Optional app lock (Cuenta > Seguridad). When on, opening the app and coming
// back after more than 60 s in the background asks for Face ID / fingerprint,
// with the PIN typed on the phone as the way out (checked against the PIN kept
// in the secure store, never sent anywhere). Any failure ends on the PIN field,
// and a phone with no stored PIN is never locked out.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStrings } from "../i18n";
import { useSession } from "../session/SessionProvider";
import { localPinMatches, shouldLock, unlockStoredPin } from "../lib/biometric";
import {
  loadFlags,
  nativeBiometric,
  saveFlags,
  secureVault,
  subscribeFlags,
  type BiometricFlags,
} from "../lib/biometric-device";
import { digitsOnly } from "../lib/pin";
import { colors, space } from "../theme";
import { Button, Field, Muted, text } from "./ui";

export function AppLock({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [flags, setFlags] = useState<BiometricFlags | null>(null);
  // false = must unlock: true after each unlock, false again after 60 s away.
  const [unlocked, setUnlocked] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  // A fresh sign-in (signed out -> in) is not a cold open: no lock right after.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "signedIn" && prevStatus === "signedOut") {
      setUnlocked(true);
    }
  }

  useEffect(() => {
    let off = false;
    let first = true;
    const read = () =>
      void loadFlags().then((f) => {
        if (off) return;
        setFlags(f);
        // Turning the lock on from Cuenta must not lock the app right then.
        if (!first && f.appLock) {
          setUnlocked(true);
        }
        first = false;
      });
    read();
    const unsub = subscribeFlags(read);
    return () => {
      off = true;
      unsub();
    };
  }, []);

  const active = flags?.appLock === true && status === "signedIn";

  // Back from the background after 60 s or more.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        backgroundedAt.current = Date.now();
      } else if (
        next === "active" &&
        shouldLock({
          enabled: active,
          unlockedOnce: true,
          backgroundedAt: backgroundedAt.current,
          now: Date.now(),
        })
      ) {
        setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, [active]);

  const open = useCallback(() => {
    backgroundedAt.current = null;
    setUnlocked(true);
  }, []);

  // Until the switches are read, cover the app so nothing flashes. A cold open
  // with the lock on starts locked (nothing was unlocked yet).
  const cover = flags === null || (active && !unlocked);
  return (
    <View style={{ flex: 1 }}>
      {children}
      {cover ? (
        <SafeAreaView style={st.cover}>
          {flags === null ? null : <LockBox onOpen={open} />}
        </SafeAreaView>
      ) : null}
    </View>
  );
}

function LockBox({ onOpen }: { onOpen: () => void }) {
  const s = useStrings();
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);

  const tryFace = useCallback(async () => {
    const res = await unlockStoredPin(nativeBiometric, secureVault, {
      promptMessage: s.lock.prompt,
      cancelLabel: s.lock.cancel,
    });
    if (res.kind === "pin") onOpen();
    else if (res.reason === "no_pin") {
      // Nothing to type against: never lock someone out. Turn the lock off.
      await saveFlags({ enabled: false, appLock: false });
      onOpen();
    }
    // Otherwise stay on the PIN field below.
  }, [onOpen, s]);

  const ask = useRef(tryFace);
  useEffect(() => {
    void ask.current();
  }, []);

  async function submit() {
    let stored: string | null = null;
    try {
      stored = await secureVault.get();
    } catch {
      stored = null;
    }
    if (stored === null) {
      await saveFlags({ enabled: false, appLock: false });
      onOpen();
      return;
    }
    if (localPinMatches(pin, stored)) onOpen();
    else {
      setWrong(true);
      setPin("");
    }
  }

  return (
    <View style={st.box}>
      <Text style={text.title}>{s.lock.title}</Text>
      <Button
        label={s.lock.biometric}
        icon="finger-print-outline"
        onPress={() => void tryFace()}
      />
      <Field
        label={s.lock.pinLabel}
        value={pin}
        onChangeText={(v) => {
          setPin(digitsOnly(v));
          setWrong(false);
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        autoComplete="off"
        textContentType="none"
      />
      {wrong ? <Muted>{s.lock.wrong}</Muted> : null}
      <Button
        label={s.lock.unlock}
        variant="secondary"
        onPress={() => void submit()}
        disabled={pin.length < 4}
      />
    </View>
  );
}

const st = StyleSheet.create({
  cover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    justifyContent: "flex-start",
    paddingTop: space.xl * 2,
  },
  box: { padding: space.l, gap: space.l },
});
