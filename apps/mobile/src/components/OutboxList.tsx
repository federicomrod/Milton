import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dismiss, retryNow } from "../send/outbox";
import type { OutboxItem } from "../send/outbox-core";
import { MIN_TOUCH, colors, font, radius, space } from "../theme";
import { Button, Chip, Muted } from "./ui";

export const KIND_LABEL: Record<string, string> = {
  photo: "Foto",
  voice: "Nota de voz",
  document: "Documento",
  text: "Texto",
};

export function previewOf(item: Pick<OutboxItem, "kind" | "text">): string {
  const t = (item.text ?? "").trim();
  if (t) return t.length > 90 ? `${t.slice(0, 90)}…` : t;
  return item.kind === "photo"
    ? "Foto"
    : item.kind === "voice"
      ? "Nota de voz"
      : "";
}

/** One outbox item: what it is, and its status as a visible chip / button. */
export function OutboxRow({ item }: { item: OutboxItem }) {
  return (
    <View style={s.row}>
      <View style={s.head}>
        <Text style={s.kind}>{KIND_LABEL[item.kind]}</Text>
        {item.state === "sent" ? <Chip tone="mint" label="Enviado" /> : null}
        {item.state === "sending" ? (
          <Chip tone="plain" label="Enviando…" />
        ) : null}
        {item.state === "pending" ? (
          <Chip tone="plain" label="Por enviar" />
        ) : null}
      </View>
      {item.text ? <Text style={s.preview}>{previewOf(item)}</Text> : null}
      {item.state === "failed" ? (
        <View style={s.failed}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="No se envió. Reintentar"
            onPress={() => retryNow(item.id)}
            style={s.retry}
          >
            <Text style={s.retryText}>No se envió · Reintentar</Text>
          </Pressable>
          {item.permanent ? (
            <View>
              <Muted>Este archivo no se puede enviar.</Muted>
              <Button
                label="Quitar"
                variant="secondary"
                onPress={() => dismiss(item.id)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    paddingVertical: space.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: space.s,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s,
  },
  kind: { fontSize: font.small, fontWeight: "700", color: colors.ink },
  preview: { fontSize: font.body, color: colors.ink },
  failed: { gap: space.s },
  retry: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.pill,
    backgroundColor: colors.rosa,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.m,
  },
  retryText: { fontSize: font.body, fontWeight: "700", color: colors.ink },
});
