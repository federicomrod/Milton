import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { formatElapsed } from "../lib/format";
import { newClientRef } from "../lib/ids";
import { enqueue } from "../send/outbox";
import { MIN_TOUCH, colors, font, radius, space } from "../theme";
import { Button, Muted } from "./ui";

const MAX_MS = 5 * 60_000;
const MIN_MS = 1_000;

type Phase = "idle" | "recording" | "recorded";

export function VoiceFlow({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ uri: string; ms: number } | null>(null);
  const holding = useRef(false);
  const active = useRef(false);
  const startedAt = useRef(0);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearLimit() {
    if (limit.current) clearTimeout(limit.current);
    limit.current = null;
  }

  async function discard() {
    clearLimit();
    active.current = false;
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // Nothing was recording.
    }
    setSaved(null);
    setPhase("idle");
  }

  async function start() {
    holding.current = true;
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError(
          "Activa el micrófono para Milton en los Ajustes del teléfono."
        );
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      if (!holding.current) return; // let go before it was ready
      recorder.record();
      startedAt.current = Date.now();
      active.current = true;
      limit.current = setTimeout(() => void finish(), MAX_MS);
      setPhase("recording");
    } catch {
      setError("No pude grabar. Inténtalo otra vez.");
    }
  }

  async function finish() {
    holding.current = false;
    clearLimit();
    if (!active.current) return;
    active.current = false;
    const ms = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } catch {
      setPhase("idle");
      return;
    }
    if (ms < MIN_MS || !recorder.uri) {
      setError("Mantén presionado para grabar.");
      setPhase("idle");
      return;
    }
    setSaved({ uri: recorder.uri, ms });
    setPhase("recorded");
  }

  // Stop a recording left running if the screen goes away.
  useEffect(() => clearLimit, []);

  async function send() {
    if (!saved || busy) return;
    setBusy(true);
    await enqueue({
      id: newClientRef(),
      kind: "voice",
      fileUri: saved.uri,
      ext: "m4a",
      mime: "audio/mp4",
      durationS: Math.round(saved.ms / 1000),
    });
    onDone();
  }

  return (
    <View style={s.wrap}>
      {phase === "recorded" && saved ? (
        <>
          <Text style={s.time}>Nota lista · {formatElapsed(saved.ms)}</Text>
          <Button label="Enviar" onPress={send} busy={busy} />
          <Button
            label="Grabar de nuevo"
            variant="secondary"
            onPress={discard}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <Text style={s.time}>
            {phase === "recording"
              ? `Grabando… ${formatElapsed(state.durationMillis)}`
              : "Mantén presionado para grabar"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mantén presionado para grabar"
            onPressIn={start}
            onPressOut={finish}
            style={[s.hold, phase === "recording" && s.holdActive]}
          >
            <Text
              style={[
                s.holdText,
                phase === "recording" && { color: colors.white },
              ]}
            >
              {phase === "recording" ? "Suelta para terminar" : "Grabar"}
            </Text>
          </Pressable>
          {phase === "recording" ? (
            <Button
              label="Cancelar grabación"
              variant="secondary"
              onPress={discard}
            />
          ) : null}
          <Muted>Máximo 5 minutos.</Muted>
        </>
      )}
      {error ? <Muted>{error}</Muted> : null}
      {phase !== "recording" ? (
        <Button
          label="Cancelar"
          variant="secondary"
          onPress={() => void discard().then(onCancel)}
          disabled={busy}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.m },
  time: {
    fontSize: font.big,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
  },
  hold: {
    minHeight: 160,
    borderRadius: radius.m,
    borderWidth: 2,
    borderColor: colors.blue,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    minWidth: MIN_TOUCH,
  },
  holdActive: { backgroundColor: colors.blue },
  holdText: { fontSize: 28, fontWeight: "800", color: colors.blue },
});
