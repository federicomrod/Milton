// Manager / owner sign-in: the same email and password as the web.

import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ApiError } from "../api/client";
import { Button, Field, Muted, text } from "../components/ui";
import { useG } from "../gestion/hooks";
import { useManager } from "../gestion/ManagerProvider";
import { colors, space } from "../theme";

export default function Login() {
  const g = useG();
  const router = useRouter();
  const { signIn } = useManager();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function enter() {
    if (!email.trim() || !password) {
      setError(g.login.missing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? g.login.invalid
          : g.login.failed
      );
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={st.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={st.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={st.head}>
            <Text style={text.title}>{g.login.title}</Text>
            <Muted>{g.login.intro}</Muted>
          </View>
          <Field
            label={g.login.email}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
          />
          <Field
            label={g.login.password}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
          />
          {error ? <Muted>{error}</Muted> : null}
          <Button label={g.login.signIn} onPress={enter} busy={busy} />
          <Button
            label={g.login.back}
            variant="secondary"
            onPress={() => router.back()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  content: {
    padding: space.l,
    gap: space.m,
    flexGrow: 1,
    justifyContent: "center",
  },
  head: { gap: space.s, marginBottom: space.m },
});
