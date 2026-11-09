// Preguntar a Milton (Gestión): a chat over the same engine as the web's Ask
// Milton. The answer types in as it arrives; when several restaurants are open
// and none is chosen Milton asks which one (once); a spoken question is turned
// into text first and shown, so it can be corrected before it is sent. Nothing
// is stored on the phone or the server. The only AI colour here is lavender.

import React from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useRouter } from "expo-router";
import { Icon, Muted } from "../components/ui";
import { useG } from "../gestion/hooks";
import { micStepAfterAsking, micStepFor } from "../gestion/mic-core";
import { isTooShort, usableTranscript } from "../gestion/voice-core";
import { useManager } from "../gestion/ManagerProvider";
import {
  trimConversation,
  type AskEvent,
  type AskOption,
  type ChatTurn,
} from "../gestion/ask-core";
import { colors, fonts, space, tint } from "../theme";

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  facts?: { label: string; value: string }[];
  followups?: string[];
  note?: string;
  clarify?: { question: string; options: AskOption[]; pending: string };
  error?: boolean;
  pendingText?: string;
}

const MAX_RECORD_MS = 60_000;
let nextId = 1;

export default function Preguntar() {
  const g = useG();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { api, locationId, locations } = useManager();
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState<null | "thinking" | "transcribing">(
    null
  );
  const [recording, setRecording] = React.useState(false);
  const [micError, setMicError] = React.useState<string | null>(null);
  // Only a real denial or restriction: it gets its own message and Settings.
  const [micDenied, setMicDenied] = React.useState(false);
  // The restaurant for this chat: the one in view, or what the person picked.
  const [scope, setScope] = React.useState<{ id: string | null; all: boolean }>(
    {
      id: locationId,
      all: false,
    }
  );
  const scroll = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const stopTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = React.useRef(0);
  const abort = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abort.current?.abort(), []);

  const update = (id: number, patch: (m: Msg) => Msg) =>
    setMsgs((all) => all.map((m) => (m.id === id ? patch(m) : m)));

  async function ask(
    question: string,
    s: { id: string | null; all: boolean },
    base: Msg[]
  ) {
    const reply: Msg = { id: nextId++, role: "assistant", text: "" };
    const user: Msg = { id: nextId++, role: "user", text: question };
    const history: ChatTurn[] = trimConversation(
      base
        .filter((m) => !m.clarify && !m.error && m.text)
        .map((m) => ({ role: m.role, content: m.text }))
    );
    setMsgs([...base, user, reply]);
    setBusy("thinking");
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const onEvent = (e: AskEvent) => {
      if (e.type === "delta") {
        update(reply.id, (m) => ({ ...m, text: m.text + e.text }));
      } else if (e.type === "clarify") {
        update(reply.id, (m) => ({
          ...m,
          text: "",
          clarify: {
            question: e.question,
            options: e.options,
            pending: question,
          },
        }));
      } else if (e.type === "final") {
        update(reply.id, (m) => ({
          ...m,
          text: e.answer,
          facts: e.facts,
          followups: e.followups,
          note: e.aiUnavailable ? g.ask.aiUnavailable : undefined,
        }));
      } else {
        update(reply.id, (m) => ({
          ...m,
          text: e.error,
          error: true,
          pendingText: question,
        }));
      }
    };
    try {
      await api.ask({
        message: question,
        conversation: history,
        location: s.id,
        all: s.all,
        signal: controller.signal,
        onEvent,
      });
    } catch {
      if (!controller.signal.aborted) {
        update(reply.id, (m) => ({
          ...m,
          text: g.ask.failed,
          error: true,
          pendingText: question,
        }));
      }
    } finally {
      setBusy(null);
    }
  }

  function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    void ask(q, scope, msgs);
  }

  function choose(m: Msg, o: AskOption) {
    if (!m.clarify || busy) return;
    const next = { id: o.id, all: o.id === null };
    setScope(next);
    // The thread without the question that was held back and Milton's question:
    // ask() adds the question again, now with the restaurant chosen.
    const at = msgs.findIndex((x) => x.id === m.id);
    void ask(m.clarify.pending, next, msgs.slice(0, Math.max(0, at - 1)));
  }

  async function toggleMic() {
    if (busy === "transcribing") return;
    setMicError(null);
    setMicDenied(false);
    if (recording) {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      setRecording(false);
      try {
        await recorder.stop();
      } catch {
        return;
      }
      const uri = recorder.uri;
      if (!uri) return;
      // An accidental tap records nothing worth sending: say so, don't upload.
      if (isTooShort(Date.now() - startedAt.current)) {
        setMicError(g.ask.voiceFailed);
        return;
      }
      setBusy("transcribing");
      try {
        const blob = await (await fetch(uri)).blob();
        const text = usableTranscript(await api.transcribe(blob));
        if (text === null) {
          setMicError(g.ask.voiceFailed);
        } else {
          setInput(text);
        }
      } catch {
        setMicError(g.ask.voiceFailed);
      } finally {
        setBusy(null);
      }
      return;
    }
    try {
      // Ask the system first, so only a real denial reads as one.
      let step = micStepFor(await getRecordingPermissionsAsync());
      if (step === "ask") {
        step = micStepAfterAsking(await requestRecordingPermissionsAsync());
      }
      if (step === "settings") {
        setMicDenied(true);
        return;
      }
      setMicDenied(false);
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setRecording(true);
      stopTimer.current = setTimeout(() => void toggleMic(), MAX_RECORD_MS);
    } catch {
      setMicError(g.ask.voiceFailed);
    }
  }

  const where =
    scope.id !== null
      ? (locations.find((l) => l.id === scope.id)?.name ?? "")
      : "";

  return (
    <SafeAreaView edges={["left", "right"]} style={st.screen}>
      <View style={[st.top, { paddingTop: insets.top + 8 }]}>
        <View style={st.badge}>
          <Icon name="sparkles-outline" size={18} color={colors.ink} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.title} accessibilityRole="header">
            {g.ask.title}
          </Text>
          <Muted>
            {where ? `${g.ask.subtitle} · ${where}` : g.ask.subtitle}
          </Muted>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={g.ask.close}
          onPress={() => router.back()}
          style={st.close}
        >
          <Icon name="close" />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scroll}
          contentContainerStyle={st.thread}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            scroll.current?.scrollToEnd({ animated: true })
          }
        >
          {msgs.length === 0 ? (
            <View style={{ gap: 10 }}>
              <Muted>{g.ask.empty}</Muted>
              {g.ask.suggestions.map((q) => (
                <Pressable
                  key={q}
                  accessibilityRole="button"
                  onPress={() => send(q)}
                  style={st.chip}
                >
                  <Text style={st.chipText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {msgs.map((m) =>
            m.role === "user" ? (
              <View key={m.id} style={st.userBubble}>
                <Text style={st.userText}>{m.text}</Text>
              </View>
            ) : (
              <View key={m.id} style={st.reply}>
                {m.clarify ? (
                  <>
                    <Text style={st.answer}>{m.clarify.question}</Text>
                    <View style={st.options}>
                      {m.clarify.options.map((o) => (
                        <Pressable
                          key={o.id ?? "all"}
                          accessibilityRole="button"
                          onPress={() => choose(m, o)}
                          style={st.chip}
                        >
                          <Text style={st.chipText}>{o.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : (
                  <>
                    {m.text ? (
                      <Text style={st.answer}>{m.text}</Text>
                    ) : (
                      <Muted>{g.ask.thinking}</Muted>
                    )}
                    {m.error && m.pendingText ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => send(m.pendingText as string)}
                        style={st.chip}
                      >
                        <Text style={st.chipText}>{g.ask.retry}</Text>
                      </Pressable>
                    ) : null}
                    {m.facts && m.facts.length > 0 ? (
                      <View style={st.facts}>
                        <Text style={st.factsTitle}>{g.ask.facts}</Text>
                        {m.facts.map((f, i) => (
                          <View key={i} style={st.fact}>
                            <Text style={st.factLabel}>{f.label}</Text>
                            <Text style={st.factValue}>{f.value}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {m.note ? <Muted>{m.note}</Muted> : null}
                    {m.followups && m.followups.length > 0 ? (
                      <View style={{ gap: 8 }}>
                        <Text style={st.factsTitle}>{g.ask.followups}</Text>
                        {m.followups.map((q) => (
                          <Pressable
                            key={q}
                            accessibilityRole="button"
                            onPress={() => send(q)}
                            style={st.chip}
                          >
                            <Text style={st.chipText}>{q}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            )
          )}
        </ScrollView>
        {micDenied ? (
          <View style={st.micError}>
            <Muted>{g.ask.micDenied}</Muted>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openSettings()}
              style={st.chip}
            >
              <Text style={st.chipText}>{g.ask.openSettings}</Text>
            </Pressable>
          </View>
        ) : null}
        {micError ? <Muted style={st.micError}>{micError}</Muted> : null}
        {recording || busy === "transcribing" ? (
          <Muted style={st.micError}>
            {recording ? g.ask.listening : g.ask.transcribing}
          </Muted>
        ) : null}
        <View style={[st.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            style={st.input}
            value={input}
            onChangeText={setInput}
            placeholder={g.ask.placeholder}
            placeholderTextColor={tint.ink45}
            multiline
            maxLength={2000}
            onSubmitEditing={() => send(input)}
            accessibilityLabel={g.ask.placeholder}
          />
          {input.trim() ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={g.ask.send}
              disabled={busy !== null}
              onPress={() => send(input)}
              style={[st.round, busy !== null && { opacity: 0.45 }]}
            >
              <Icon name="arrow-up" size={20} color={colors.white} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recording ? g.ask.micStop : g.ask.mic}
              disabled={busy !== null}
              onPress={() => void toggleMic()}
              style={[
                st.round,
                recording && st.roundOn,
                busy !== null && { opacity: 0.45 },
              ]}
            >
              <Icon
                name={recording ? "stop" : "mic"}
                size={20}
                color={colors.white}
              />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: space.l,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.lavender,
  },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.ink },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  thread: { padding: space.l, gap: 14, flexGrow: 1 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    backgroundColor: colors.blue,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fonts.regular,
    color: colors.white,
  },
  reply: { gap: 10, maxWidth: "95%" },
  answer: {
    fontSize: 16,
    lineHeight: 23,
    fontFamily: fonts.regular,
    color: colors.ink,
  },
  options: { gap: 8 },
  chip: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.ink },
  facts: {
    gap: 6,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  factsTitle: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.ink,
    opacity: 0.62,
  },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  factLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.ink,
  },
  factValue: { fontSize: 14, fontFamily: fonts.bold, color: colors.ink },
  micError: { paddingHorizontal: space.l, paddingBottom: 6, gap: 8 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: space.m,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderWidth: 1.5,
    borderColor: colors.lavender,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  round: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blue,
  },
  roundOn: { backgroundColor: colors.ink },
});
