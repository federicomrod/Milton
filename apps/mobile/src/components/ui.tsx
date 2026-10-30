// The building blocks every screen uses. White surfaces, 1 px #E5E7EB borders,
// ~12 px radius, no heavy shadows, Inter. Primary = full-width blue pill with
// white text; secondary = white pill with a grey border and Ink text. Big touch
// targets (>= 48 pt) and every action is a visible button (no ⋯ menus).

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
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MIN_TOUCH,
  MUTED_OPACITY,
  PLACEHOLDER,
  colors,
  fonts,
  radius,
  space,
} from "../theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function Icon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView edges={["left", "right"]} style={[s.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = variant === "primary";
  const ink = primary ? colors.white : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary ? s.buttonPrimary : s.buttonSecondary,
        (disabled || busy) && s.disabled,
        pressed && s.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <View style={s.row}>
          {icon ? <Icon name={icon} size={20} color={ink} /> : null}
          <Text style={[s.buttonText, { color: ink }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** The two equal outlined buttons under the mic: icon + label, 12 px corners. */
export function TileButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.tile, pressed && s.pressed]}
    >
      <Icon name={icon} size={22} color={colors.ink} />
      <Text style={s.tileText}>{label}</Text>
    </Pressable>
  );
}

export type ChipTone = "mint" | "amarillo" | "grey" | "lavender" | "rosa";

const CHIP_BG: Record<ChipTone, string> = {
  mint: colors.mint,
  amarillo: colors.amarillo,
  grey: colors.border,
  lavender: colors.lavender,
  rosa: colors.rosa,
};

export function Chip({ label, tone }: { label: string; tone: ChipTone }) {
  return (
    <View style={[s.chip, { backgroundColor: CHIP_BG[tone] }]}>
      <Text style={s.chipText}>{label}</Text>
    </View>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[s.card, style]}>{children}</View>;
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
  title: { fontSize: 32, fontFamily: fonts.extrabold, color: colors.ink },
  heading: { fontSize: 24, fontFamily: fonts.extrabold, color: colors.ink },
  big: { fontSize: 20, fontFamily: fonts.bold, color: colors.ink },
  body: { fontSize: 17, fontFamily: fonts.regular, color: colors.ink },
  bold: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink },
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  row: { flexDirection: "row", alignItems: "center", gap: space.s },
  button: {
    minHeight: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.l,
    borderWidth: 1,
  },
  buttonPrimary: { backgroundColor: colors.blue, borderColor: colors.blue },
  buttonSecondary: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  buttonText: { fontSize: 17, fontFamily: fonts.bold },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  tile: {
    flex: 1,
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tileText: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.ink },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    padding: space.m,
  },
  banner: {
    backgroundColor: colors.amarillo,
    paddingVertical: 10,
    paddingHorizontal: space.m,
  },
  bannerText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.ink },
  muted: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: MUTED_OPACITY,
  },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontFamily: fonts.semibold, color: colors.ink },
  input: {
    minHeight: MIN_TOUCH + 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    fontSize: 17,
    fontFamily: fonts.regular,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  segments: { flexDirection: "row", gap: space.s },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  segmentActive: { backgroundColor: colors.blue, borderColor: colors.blue },
  segmentText: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
});
