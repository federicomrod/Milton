import React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Redirect,
  Stack,
  useGlobalSearchParams,
  usePathname,
  useRouter,
} from "expo-router";
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
import { ToastHost } from "../components/ToastHost";
import { Button, Muted } from "../components/ui";
import { ManagerProvider, useManager } from "../gestion/ManagerProvider";
import { useG } from "../gestion/hooks";
import { signedOutLanding } from "../lib/landing";
import { I18nProvider, useStrings } from "../i18n";
import { SessionProvider, useSession } from "../session/SessionProvider";
import { colors, fonts } from "../theme";

// When nobody is signed in the app opens on the entry screen (cook or manager).
export const unstable_settings = { anchor: "entrada" };

/** Signed out: send the first screen to /entrada (see lib/landing.ts). Mounted
 *  once per signed-out period, so it decides on the screen it opened on only. */
function SignedOutLanding() {
  const pathname = usePathname();
  const { secret } = useGlobalSearchParams<{ secret?: string }>();
  const [target] = React.useState(() =>
    signedOutLanding(pathname, typeof secret === "string" && secret !== "")
  );
  return target ? <Redirect href={target} /> : null;
}

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
  const { status: kitchen } = useSession();
  const manager = useManager();
  const s = useStrings();
  const g = useG();
  if (kitchen === "loading" || manager.status === "loading") return <Splash />;
  if (manager.status === "error") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          backgroundColor: colors.white,
        }}
      >
        <Muted>{g.errors.offline}</Muted>
        <Button label={g.errors.retry} onPress={manager.retry} />
        <Button
          label={g.noAccess.signOut}
          variant="secondary"
          onPress={() => void manager.signOut()}
        />
      </View>
    );
  }
  const kitchenIn = kitchen === "signedIn";
  const managerIn = manager.status === "signedIn";
  const noAccess = manager.status === "noAccess";
  // A phone can hold both sessions; the profile sheet picks the mode.
  const mode =
    managerIn && kitchenIn ? manager.mode : managerIn ? "manager" : "kitchen";
  const showKitchen = kitchenIn && mode === "kitchen";
  const showManager = managerIn && mode === "manager";
  const signedOut = !kitchenIn && !managerIn && !noAccess;
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.white },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: fonts.bold },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.white },
        }}
      >
        <Stack.Protected guard={showManager}>
          <Stack.Screen name="(gestion)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={managerIn}>
          <Stack.Screen
            name="perfil"
            options={{ headerShown: false, presentation: "modal" }}
          />
        </Stack.Protected>
        <Stack.Protected guard={showKitchen}>
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
        <Stack.Protected guard={noAccess}>
          <Stack.Screen name="sin-acceso" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedOut}>
          <Stack.Screen name="entrada" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!kitchenIn && !noAccess}>
          <Stack.Screen name="join" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {signedOut ? <SignedOutLanding /> : null}
    </>
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
          <ManagerProvider>
            <StatusBar style="dark" />
            {loaded || failed ? <Routes /> : <Splash />}
            <ToastHost />
          </ManagerProvider>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
