// The big blue mic with soft light-blue rings. Hold it to talk, let go to stop.

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useStrings } from "../i18n";
import type { VoiceNote } from "../send/useVoiceNote";
import { colors, tint } from "../theme";
import { Icon } from "./ui";

export function MicHero({ voice }: { voice: VoiceNote }) {
  const s = useStrings();
  const recording = voice.phase === "recording";
  return (
    <View style={st.outer}>
      <View style={st.mid}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.send.hold}
          onPressIn={voice.start}
          onPressOut={voice.finish}
          style={({ pressed }) => [
            st.inner,
            (pressed || recording) && st.active,
          ]}
        >
          <Icon name="mic" size={68} color={colors.white} />
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  outer: {
    width: 264,
    height: 264,
    borderRadius: 132,
    backgroundColor: tint.blue08,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  mid: {
    width: 212,
    height: 212,
    borderRadius: 106,
    backgroundColor: tint.blue14,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  active: { transform: [{ scale: 1.06 }] },
});
