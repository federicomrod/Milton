// The auto-hiding «Enviado · pan» pill, above the tab bar. Ink on white text
// (brand colours only); announced to screen readers when it appears.

import React, { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { currentToast, subscribeToast } from "../lib/toast";
import { colors, fonts, radius, space } from "../theme";

export function ToastHost() {
  const message = useSyncExternalStore(
    subscribeToast,
    currentToast,
    currentToast
  );
  const insets = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View
      pointerEvents="none"
      style={[st.wrap, { bottom: insets.bottom + 84 }]}
      accessibilityLiveRegion="polite"
    >
      <View style={st.pill} accessibilityRole="alert">
        <Text style={st.text} numberOfLines={1}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: space.l,
    right: space.l,
    alignItems: "center",
  },
  pill: {
    maxWidth: "100%",
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    paddingVertical: 12,
  },
  text: { color: colors.white, fontSize: 16, fontFamily: fonts.semibold },
});
