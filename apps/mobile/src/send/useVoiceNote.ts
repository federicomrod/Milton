// Hold-to-talk voice notes with expo-audio: hold the mic to record, let go to
// stop (max 5 minutes), then send or cancel. Used by the big mic on «Enviar».

import { useRef, useState } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import type { Strings } from "../i18n/strings";
import { newClientRef } from "../lib/ids";
import { enqueue } from "./outbox";

const MAX_MS = 5 * 60_000;
const MIN_MS = 1_000;

export type VoicePhase = "idle" | "recording" | "recorded";

export function useVoiceNote(s: Strings) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<VoicePhase>("idle");
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
    holding.current = false;
    active.current = false;
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // Nothing was recording.
    }
    setSaved(null);
    setPhase("idle");
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
      setError(s.send.holdLonger);
      setPhase("idle");
      return;
    }
    setSaved({ uri: recorder.uri, ms });
    setPhase("recorded");
  }

  async function start() {
    holding.current = true;
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError(s.send.micPermission);
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
      setError(s.send.recordFailed);
    }
  }

  async function send(onDone: () => void) {
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
    setBusy(false);
    setSaved(null);
    setPhase("idle");
    onDone();
  }

  return {
    phase,
    elapsedMs: state.durationMillis,
    savedMs: saved?.ms ?? 0,
    error,
    busy,
    start,
    finish,
    discard,
    send,
  };
}

export type VoiceNote = ReturnType<typeof useVoiceNote>;
