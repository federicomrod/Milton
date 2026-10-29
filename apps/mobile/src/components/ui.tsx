// The few building blocks every screen uses. Big touch targets (>= 48 pt),
// brand colours only, and every action is a visible button (no ⋯ menus).

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MIN_TOUCH,
  MUTED_OPACITY,
  PLACEHOLDER,
  colors,
  font,
  radius,
  space,
} from "../theme";

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[s.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

type ButtonVariant = "primary" | "secondary";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  big,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        big && s.buttonBig,
        primary ? s.buttonPrimary : s.buttonSecondary,
        (disabled || busy) && s.disabled,
        pressed && s.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.white : colors.blue} />
      ) : (
        <Text
          style={[
            s.buttonText,
            big && s.buttonTextBig,
            { color: primary ? colors.white : colors.blue },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export type ChipTone = "mint" | "rosa" | "amarillo" | "plain";

export function Chip({ label, tone }: { label: string; tone: ChipTone }) {
  const bg = tone === "plain" ? colors.white : colors[tone];
  return (
    <View
      style={[s.chip, { backgroundColor: bg }, tone === "plain" && s.chipPlain]}
    >
      <Text style={s.chipText}>{label}</Text>
    </View>
  );
}

export function Banner({ text }: { text: string }) {
  return (
    <View style={s.banner} accessibilityRole="alert">
      <Text style={s.bannerText}>{text}</Text>
    </View>
  );
}

export function Muted({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={PLACEHOLDER}
        accessibilityLabel={label}
        style={[s.input, style]}
        {...rest}
      />
    </View>
  );
}

export function Segments<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.segments}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[s.segment, active && s.segmentActive]}
          >
            <Text style={[s.segmentText, active && { color: colors.white }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const text = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: "700", color: colors.ink },
  body: { fontSize: font.body, color: colors.ink },
  big: { fontSize: font.big, fontWeight: "600", color: colors.ink },
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  button: {
    minHeight: MIN_TOUCH + 8,
    borderRadius: radius.m,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.l,
    borderWidth: 2,
    borderColor: colors.blue,
  },
  buttonBig: { minHeight: 88, borderRadius: radius.m },
  buttonPrimary: { backgroundColor: colors.blue },
  buttonSecondary: { backgroundColor: colors.white },
  buttonText: { fontSize: font.big, fontWeight: "700" },
  buttonTextBig: { fontSize: 24 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: space.m,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
  },
  chipPlain: { borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: font.small, fontWeight: "700", color: colors.ink },
  banner: {
    backgroundColor: colors.amarillo,
    paddingVertical: space.s + 2,
    paddingHorizontal: space.m,
  },
  bannerText: {
    fontSize: font.small + 1,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
  },
  muted: { fontSize: font.small, color: colors.ink, opacity: MUTED_OPACITY },
  field: { gap: space.xs },
  fieldLabel: { fontSize: font.small, fontWeight: "700", color: colors.ink },
  input: {
    minHeight: MIN_TOUCH + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    fontSize: font.body,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  segments: { flexDirection: "row", gap: space.s },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  segmentActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  segmentText: { fontSize: font.body, fontWeight: "700", color: colors.ink },
});
