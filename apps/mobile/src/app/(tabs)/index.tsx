import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppHeader } from "../../components/AppHeader";
import { ServerRow, WaitingRow } from "../../components/ItemRows";
import { MicHero } from "../../components/MicHero";
import { PhotoFlow } from "../../components/PhotoFlow";
import { TextFlow } from "../../components/TextFlow";
import {
  Banner,
  Button,
  Muted,
  Screen,
  TileButton,
  text,
} from "../../components/ui";
import { useStrings } from "../../i18n";
import { fmt } from "../../i18n/strings";
import { formatElapsed } from "../../lib/format";
import { offlineText } from "../../lib/result";
import { useOutbox } from "../../send/outbox";
import { useHistoryFeed } from "../../send/useHistoryFeed";
import { useVoiceNote } from "../../send/useVoiceNote";
import { colors, fonts, space } from "../../theme";

type Mode = "menu" | "photo" | "text";

export default function Enviar() {
  const s = useStrings();
  const { items: outbox, offline } = useOutbox();
  const feed = useHistoryFeed();
  const voice = useVoiceNote(s);
  const [mode, setMode] = useState<Mode>("menu");
  const back = () => setMode("menu");

  useFocusEffect(
    // Show what Milton did with the last sends when the tab comes to the front.
    React.useCallback(() => {
      feed.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const waiting = outbox.filter((i) => i.state !== "sent");
  const recording = voice.phase === "recording";
  const recorded = voice.phase === "recorded";

  return (
    <Screen>
      <AppHeader />
      {offline ? <Banner text={offlineText(waiting.length, s)} /> : null}
      <ScrollView
        contentContainerStyle={st.content}
        keyboardShouldPersistTaps="handled"
      >
        {mode === "menu" ? (
          <>
            <View style={st.intro}>
              <Text style={st.question}>{s.send.question}</Text>
              <Text style={st.subtitle}>{s.send.subtitle}</Text>
            </View>

            <MicHero voice={voice} />

            {recorded ? (
              <View style={st.stack}>
                <Text style={st.status}>
                  {fmt(s.send.noteReady, {
                    time: formatElapsed(voice.savedMs),
                  })}
                </Text>
                <Button
                  label={s.send.sendBtn}
                  onPress={() => void voice.send(() => undefined)}
                  busy={voice.busy}
                />
                <Button
                  label={s.send.recordAgain}
                  variant="secondary"
                  onPress={() => void voice.discard()}
                  disabled={voice.busy}
                />
              </View>
            ) : recording ? (
              <View style={st.stack}>
                <Text style={st.status}>
                  {fmt(s.send.recording, {
                    time: formatElapsed(voice.elapsedMs),
                  })}
                </Text>
                <Muted style={st.center}>{s.send.release}</Muted>
                <Button
                  label={s.send.cancelRecording}
                  variant="secondary"
                  onPress={() => void voice.discard()}
                />
              </View>
            ) : (
              <View style={st.stack}>
                <Text style={st.hold}>{s.send.hold}</Text>
                <Muted
                  style={st.center}
                >{`«${s.send.example1}» · «${s.send.example2}»`}</Muted>
                {voice.error ? (
                  <Muted style={st.center}>{voice.error}</Muted>
                ) : null}
                <View style={st.tiles}>
                  <TileButton
                    label={s.send.photo}
                    icon="camera-outline"
                    onPress={() => setMode("photo")}
                  />
                  <TileButton
                    label={s.send.write}
                    icon="create-outline"
                    onPress={() => setMode("text")}
                  />
                </View>
                <Muted style={st.center}>{s.send.hint}</Muted>
              </View>
            )}

            {waiting.length + feed.items.length > 0 ? (
              <View>
                <Text style={text.big}>{s.send.recent}</Text>
                {waiting.map((i) => (
                  <WaitingRow key={i.id} item={i} />
                ))}
                {feed.items.slice(0, 4).map((i) => (
                  <ServerRow key={i.id} item={i} />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        {mode === "photo" ? <PhotoFlow onDone={back} onCancel={back} /> : null}
        {mode === "text" ? <TextFlow onDone={back} onCancel={back} /> : null}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: {
    paddingHorizontal: space.l,
    paddingBottom: space.xl,
    gap: space.l,
  },
  intro: { gap: 8, alignItems: "center", paddingTop: space.s },
  question: {
    fontSize: 28,
    fontFamily: fonts.extrabold,
    color: colors.ink,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
    textAlign: "center",
  },
  stack: { gap: space.m },
  hold: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.ink,
    textAlign: "center",
  },
  status: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.ink,
    textAlign: "center",
  },
  center: { textAlign: "center" },
  tiles: { flexDirection: "row", gap: space.m },
});
