import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useStrings } from "../i18n";
import { newClientRef } from "../lib/ids";
import { sentToastText, showToast } from "../lib/toast";
import { enqueue } from "../send/outbox";
import { space } from "../theme";
import { Button, Field, Muted } from "./ui";

export function TextFlow({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const s = useStrings();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = value.trim();

  async function send() {
    if (!clean || busy) return;
    setBusy(true);
    await enqueue({
      id: newClientRef(),
      kind: "text",
      text: clean.slice(0, 2000),
    });
    showToast(sentToastText(s.status.sent, { kind: "text", text: clean }));
    onDone();
  }

  return (
    <View style={st.wrap}>
      <Field
        label={s.send.messageLabel}
        value={value}
        onChangeText={setValue}
        multiline
        autoFocus
        maxLength={2000}
        placeholder={s.send.messagePlaceholder}
        style={st.area}
      />
      {clean ? null : <Muted>{s.send.messageHint}</Muted>}
      <Button
        label={s.send.sendBtn}
        onPress={send}
        disabled={!clean}
        busy={busy}
      />
      <Button label={s.send.cancel} variant="secondary" onPress={onCancel} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: space.m },
  area: { minHeight: 140, paddingTop: space.m, textAlignVertical: "top" },
});
