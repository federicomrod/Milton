import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { newClientRef } from "../lib/ids";
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
    onDone();
  }

  return (
    <View style={s.wrap}>
      <Field
        label="Mensaje"
        value={value}
        onChangeText={setValue}
        multiline
        autoFocus
        maxLength={2000}
        placeholder="Por ejemplo: se acabó el limón"
        style={s.area}
      />
      {clean ? null : <Muted>Escribe qué pasa en la cocina.</Muted>}
      <Button label="Enviar" onPress={send} disabled={!clean} busy={busy} />
      <Button label="Cancelar" variant="secondary" onPress={onCancel} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.m },
  area: { minHeight: 140, paddingTop: space.m, textAlignVertical: "top" },
});
