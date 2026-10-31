// Perfil (mockup 13), a sheet over the app: mode switch Gestión / Cocina,
// restaurant switch, Notificaciones (read only for now), Invitar a mi equipo
// and Cerrar sesión. Cocina is offered only when this phone can use it.

import React from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRouter } from "expo-router";
import { Button, Card, Icon, Muted, Segments } from "../components/ui";
import { ApiError } from "../api/client";
import { canInviteTeam } from "../gestion/session-core";
import { useG } from "../gestion/hooks";
import { useManager } from "../gestion/ManagerProvider";
import { useSession } from "../session/SessionProvider";
import { colors, fonts, radius, space } from "../theme";

// Expo Go floats its own gear over the top-right corner: the close button sits
// just below it there; a real build has no gear and no extra gap.
const inExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export default function Perfil() {
  const g = useG();
  const router = useRouter();
  const kitchen = useSession();
  const m = useManager();
  const [invite, setInvite] = React.useState<{ url: string } | null>(null);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const hasKitchen = kitchen.status === "signedIn";
  const inviteLocation =
    m.locationId ?? (m.locations.length === 1 ? m.locations[0].id : null);

  function chooseMode(next: "manager" | "kitchen") {
    if (next === "kitchen") {
      if (!hasKitchen) {
        router.push("/join");
        return;
      }
      m.setMode("kitchen");
    } else {
      m.setMode("manager");
    }
    router.dismissAll?.();
    router.replace("/");
  }

  async function createInvite() {
    if (!inviteLocation) {
      setInviteError(g.profile.invitePick);
      return;
    }
    setBusy(true);
    setInviteError(null);
    try {
      const res = await m.api.createKitchenInvite(inviteLocation);
      setInvite({ url: res.inviteUrl });
    } catch (err) {
      setInviteError(
        err instanceof ApiError && err.status === 403
          ? g.noAccess.text
          : g.profile.inviteFailed
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={st.content}>
      <View style={st.top}>
        <Text style={st.title}>{g.profile.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={g.profile.close}
          onPress={() => router.back()}
          style={[st.close, inExpoGo && { marginTop: 34 }]}
        >
          <Icon name="close" />
        </Pressable>
      </View>
      <Muted>{m.user?.email ?? ""}</Muted>

      <Text style={st.section}>{g.profile.mode}</Text>
      <Segments<"manager" | "kitchen">
        value={m.mode === "kitchen" && hasKitchen ? "kitchen" : "manager"}
        onChange={chooseMode}
        options={[
          { value: "manager", label: g.profile.management },
          { value: "kitchen", label: g.profile.kitchen },
        ]}
      />
      {!hasKitchen ? <Muted>{g.profile.kitchenJoin}</Muted> : null}

      <Text style={st.section}>{g.profile.restaurant}</Text>
      <Card style={st.rows}>
        {[
          { id: null as string | null, name: g.profile.all },
          ...m.locations,
        ].map((l) => (
          <Pressable
            key={l.id ?? "all"}
            accessibilityRole="button"
            accessibilityState={{ selected: l.id === m.locationId }}
            onPress={() => m.setLocationId(l.id)}
            style={st.row}
          >
            <Text
              style={[
                st.rowText,
                l.id === m.locationId && { fontFamily: fonts.bold },
              ]}
            >
              {l.name}
            </Text>
            {l.id === m.locationId ? (
              <Icon name="checkmark" color={colors.blue} />
            ) : null}
          </Pressable>
        ))}
      </Card>

      <Text style={st.section}>{g.profile.notifications}</Text>
      <Card style={st.rows}>
        <View style={st.row}>
          <Icon name="mail-outline" />
          <View style={{ flex: 1 }}>
            <Text style={st.rowText}>{g.profile.dailySummary}</Text>
            <Muted>{g.profile.dailySummaryHint}</Muted>
          </View>
        </View>
      </Card>

      {canInviteTeam(m.company) ? (
        <>
          <Text style={st.section}>{g.profile.inviteTeam}</Text>
          <Muted>{g.profile.inviteHint}</Muted>
          {invite ? (
            <Card style={st.rows}>
              <Muted>{g.profile.inviteReady}</Muted>
              <Text selectable style={st.code}>
                {invite.url}
              </Text>
              <Button
                label={g.profile.inviteShare}
                onPress={() => void Share.share({ message: invite.url })}
              />
            </Card>
          ) : (
            <Button
              label={g.profile.inviteCreate}
              onPress={createInvite}
              busy={busy}
              variant="secondary"
            />
          )}
          {inviteError ? <Muted>{inviteError}</Muted> : null}
        </>
      ) : null}

      <Button
        label={g.profile.signOut}
        variant="secondary"
        onPress={async () => {
          await m.signOut();
          router.dismissAll?.();
          router.replace("/");
        }}
      />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  content: {
    padding: space.l,
    gap: space.m,
    paddingBottom: space.xl,
    backgroundColor: colors.white,
    flexGrow: 1,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 28, fontFamily: fonts.extrabold, color: colors.ink },
  close: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.ink,
    marginTop: space.s,
  },
  rows: { padding: 4, gap: 2 },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.s,
    justifyContent: "space-between",
  },
  rowText: {
    flexShrink: 1,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.ink,
  },
  code: { fontSize: 14, fontFamily: fonts.regular, color: colors.ink },
});
