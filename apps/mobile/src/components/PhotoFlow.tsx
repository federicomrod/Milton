import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useStrings } from "../i18n";
import { newClientRef } from "../lib/ids";
import { sentToastText, showToast } from "../lib/toast";
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
  const s = useStrings();
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
            ? s.send.cameraPermission
            : s.send.photosPermission
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
      setError(s.send.photoOpenFailed);
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
      showToast(sentToastText(s.status.sent, { kind: "photo" }));
      onDone();
    } catch {
      setError(s.send.photoPrepareFailed);
      setBusy(false);
    }
  }

  return (
    <View style={st.wrap}>
      {picked ? (
        <>
          <Image
            source={{ uri: picked.uri }}
            style={st.preview}
            resizeMode="cover"
            accessibilityLabel={s.send.photoChosen}
          />
          <Field
            label={s.send.captionLabel}
            value={caption}
            onChangeText={setCaption}
            maxLength={500}
            placeholder={s.send.captionPlaceholder}
          />
          <Button label={s.send.sendBtn} onPress={send} busy={busy} />
          <Button
            label={s.send.chooseAnother}
            variant="secondary"
            onPress={() => setPicked(null)}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <Button
            label={s.send.takePhoto}
            icon="camera-outline"
            onPress={() => pick("camera")}
          />
          <Button
            label={s.send.pickGallery}
            icon="images-outline"
            variant="secondary"
            onPress={() => pick("library")}
          />
        </>
      )}
      {error ? <Muted>{error}</Muted> : null}
      <Button
        label={s.send.cancel}
        variant="secondary"
        onPress={onCancel}
        disabled={busy}
      />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: space.m },
  preview: {
    width: "100%",
    height: 260,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
