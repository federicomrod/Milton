import React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { I18nProvider, useStrings } from "../i18n";
import { SessionProvider, useSession } from "../session/SessionProvider";
import { colors, fonts } from "../theme";

function Splash() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.white,
      }}
    >
      <ActivityIndicator size="large" color={colors.blue} />
    </View>
  );
}

/** Our own back button: the system one writes the route name («(tabs)»). */
function BackButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }}
    >
      <Ionicons name="chevron-back" size={26} color={colors.ink} />
    </Pressable>
  );
}

function Routes() {
  const { status } = useSession();
  const s = useStrings();
  if (status === "loading") return <Splash />;
  const signedIn = status === "signedIn";
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.bold },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.white },
      }}
    >
      <Stack.Protected guard={signedIn}>
        {/* The title is what iOS writes on the back button of «Cuenta». */}
        <Stack.Screen
          name="(tabs)"
          options={{ headerShown: false, title: s.appName }}
        />
        <Stack.Screen
          name="cuenta"
          options={{
            title: s.account.title,
            headerBackVisible: false,
            headerLeft: () => <BackButton label={s.account.back} />,
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="join" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // Inter loads in a moment; if it ever fails the app still opens (system font).
  const [loaded, failed] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          {loaded || failed ? <Routes /> : <Splash />}
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
