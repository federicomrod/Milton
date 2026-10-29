import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { newClientRef } from "../lib/ids";
import { enqueue } from "../send/outbox";
import { colors, radius, space } from "../theme";
import { Button, Field, Muted } from "./ui";

const MAX_SIDE = 2048;
const JPEG_QUALITY = 0.7;

interface Picked {
  uri: string;
  width: number;
  height: number;
}

export function PhotoFlow({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(source: "camera" | "library") {
    setError(null);
    try {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(
          source === "camera"
            ? "Activa la cámara para Milton en los Ajustes del teléfono."
            : "Activa las fotos para Milton en los Ajustes del teléfono."
        );
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 1,
      };
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets[0];
      if (asset)
        setPicked({ uri: asset.uri, width: asset.width, height: asset.height });
    } catch {
      setError("No pude abrir la foto. Inténtalo otra vez.");
    }
  }

  async function send() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Max 2048 px on the long side, JPEG ~0.7: a few hundred KB, not 8 MB.
      const context = ImageManipulator.manipulate(picked.uri);
      if (Math.max(picked.width, picked.height) > MAX_SIDE) {
        context.resize(
          picked.width >= picked.height
            ? { width: MAX_SIDE }
            : { height: MAX_SIDE }
        );
      }
      const image = await context.renderAsync();
      const saved = await image.saveAsync({
        format: SaveFormat.JPEG,
        compress: JPEG_QUALITY,
      });
      await enqueue({
        id: newClientRef(),
        kind: "photo",
        text: caption.trim() || null,
        fileUri: saved.uri,
        ext: "jpg",
        mime: "image/jpeg",
      });
      onDone();
    } catch {
      setError("No pude preparar la foto. Inténtalo otra vez.");
      setBusy(false);
    }
  }

  return (
    <View style={s.wrap}>
      {picked ? (
        <>
          <Image
            source={{ uri: picked.uri }}
            style={s.preview}
            resizeMode="cover"
            accessibilityLabel="Foto elegida"
          />
          <Field
            label="Texto (opcional)"
            value={caption}
            onChangeText={setCaption}
            maxLength={500}
            placeholder="Por ejemplo: merma de tomate"
          />
          <Button label="Enviar" onPress={send} busy={busy} />
          <Button
            label="Elegir otra"
            variant="secondary"
            onPress={() => setPicked(null)}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <Button label="Tomar foto" onPress={() => pick("camera")} big />
          <Button
            label="Elegir de la galería"
            variant="secondary"
            onPress={() => pick("library")}
            big
          />
        </>
      )}
      {error ? <Muted>{error}</Muted> : null}
      <Button
        label="Cancelar"
        variant="secondary"
        onPress={onCancel}
        disabled={busy}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.m },
  preview: {
    width: "100%",
    height: 260,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
