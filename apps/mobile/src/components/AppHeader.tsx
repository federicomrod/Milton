// The header of both tabs: white, no coloured bar. Left: «Hola, {nombre}» in
// bold Ink with the location under it (small chevron), or a large title.
// Right: a round avatar with the cook's initials; the account (settings) lives
// there. It sits below the status bar, clear of Expo Go's floating gear.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStrings } from "../i18n";
import { fmt } from "../i18n/strings";
import { initialsOf } from "../lib/format";
import { useSession } from "../session/SessionProvider";
import { colors, fonts, tint } from "../theme";
import { Icon } from "./ui";

export function AppHeader({ title }: { title?: string }) {
  const { profile } = useSession();
  const s = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const open = () => router.push("/cuenta");

  return (
    <View style={[st.bar, { paddingTop: insets.top + 14 }]}>
      <View style={st.left}>
        {title ? (
          <Text style={st.title} accessibilityRole="header">
            {title}
          </Text>
        ) : (
          <>
            <Text style={st.hello} accessibilityRole="header">
              {profile?.name
                ? fmt(s.hello, { name: profile.name })
                : s.helloPlain}
            </Text>
            {profile?.location ? (
              <Pressable
                onPress={open}
                style={st.location}
                accessibilityRole="button"
              >
                <Icon name="restaurant-outline" size={15} color={colors.ink} />
                <Text style={st.locationText} numberOfLines={1}>
                  {profile.location}
                </Text>
                <Icon name="chevron-down" size={14} color={colors.ink} />
              </Pressable>
            ) : null}
          </>
        )}
      </View>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={s.account.open}
        style={[st.avatar, inExpoGo && { marginTop: GEAR_CLEARANCE }]}
      >
        <Text style={st.avatarText}>{initialsOf(profile?.name)}</Text>
      </Pressable>
    </View>
  );
}

// Expo Go floats its own blue gear button over the top-right corner. The avatar
// sits just below it there; a real build has no gear and no extra gap.
const GEAR_CLEARANCE = 34;
const inExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const st = StyleSheet.create({
  bar: {
    backgroundColor: colors.white,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  left: { flex: 1, gap: 4 },
  hello: { fontSize: 26, fontFamily: fonts.extrabold, color: colors.ink },
  title: { fontSize: 32, fontFamily: fonts.extrabold, color: colors.ink },
  location: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
  },
  locationText: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.ink,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tint.blue14,
  },
  avatarText: { fontSize: 16, fontFamily: fonts.bold, color: colors.blue },
});
