import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { OutboxRow } from "../../components/OutboxList";
import { PhotoFlow } from "../../components/PhotoFlow";
import { TextFlow } from "../../components/TextFlow";
import { VoiceFlow } from "../../components/VoiceFlow";
import { Banner, Button, Muted, Screen, text } from "../../components/ui";
import { useOutbox } from "../../send/outbox";
import { useSession } from "../../session/SessionProvider";
import { space } from "../../theme";

function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={text.big}>{children}</Text>;
}

type Mode = "menu" | "photo" | "voice" | "text";

export default function Enviar() {
  const { profile } = useSession();
  const { items, offline } = useOutbox();
  const [mode, setMode] = useState<Mode>("menu");
  const back = () => setMode("menu");
  const greeting = profile
    ? `Hola, ${profile.name}${profile.location ? ` · ${profile.location}` : ""}`
    : "Hola";

  return (
    <Screen>
      {offline ? <Banner text="Sin conexión" /> : null}
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        <Muted>{greeting}</Muted>
        {mode === "menu" ? (
          <>
            <Heading>¿Qué quieres enviar?</Heading>
            <View style={s.buttons}>
              <Button label="Foto" onPress={() => setMode("photo")} big />
              <Button
                label="Nota de voz"
                onPress={() => setMode("voice")}
                big
              />
              <Button label="Texto" onPress={() => setMode("text")} big />
            </View>
            {items.length > 0 ? (
              <View>
                <Heading>Recientes</Heading>
                {items.slice(0, 10).map((item) => (
                  <OutboxRow key={item.id} item={item} />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        {mode === "photo" ? <PhotoFlow onDone={back} onCancel={back} /> : null}
        {mode === "voice" ? <VoiceFlow onDone={back} onCancel={back} /> : null}
        {mode === "text" ? <TextFlow onDone={back} onCancel={back} /> : null}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { padding: space.l, gap: space.l },
  buttons: { gap: space.m },
});
