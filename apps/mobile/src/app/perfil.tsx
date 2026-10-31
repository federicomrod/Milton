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
import { Button, Card, Icon, Muted } from "../components/ui";
import { ApiError } from "../api/client";
import { canInviteTeam } from "../gestion/session-core";
import { useG } from "../gestion/hooks";
import { useManager } from "../gestion/ManagerProvider";
import { useSession } from "../session/SessionProvider";
import { fmt } from "../i18n/strings";
import { initials } from "../gestion/format";
import { colors, fonts, space, tint } from "../theme";

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

  const first = m.user?.name?.trim() || m.user?.email || "";
  const role = m.company?.role ?? "";
  const roleLabel =
    g.profile.roles[role as keyof typeof g.profile.roles] ?? role;
  const count = m.locations.length;
  const sub = [
    roleLabel,
    count === 1
      ? g.profile.restaurantsOne
      : count > 1
        ? fmt(g.profile.restaurantsCount, { n: count })
        : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const kitchenOn = m.mode === "kitchen" && hasKitchen;

  return (
    <ScrollView contentContainerStyle={st.content}>
      <View style={st.handle} />
      <View style={st.top}>
        <View style={st.who}>
          <View style={st.avatar}>
            <Text style={st.avatarText}>{initials(first)}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={st.name} numberOfLines={1}>
              {m.user?.name?.trim() || m.user?.email || ""}
            </Text>
            {sub ? <Muted>{sub}</Muted> : null}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={g.profile.close}
          onPress={() => router.back()}
          style={[st.close, inExpoGo && { marginTop: 34 }]}
        >
          <Icon name="close" />
        </Pressable>
      </View>

      <Text style={st.label}>{g.profile.mode}</Text>
      <ModeCard
        icon="stats-chart-outline"
        title={g.profile.management}
        hint={g.profile.modeManagementHint}
        selected={!kitchenOn}
        onPress={() => chooseMode("manager")}
      />
      <ModeCard
        icon="mic-outline"
        title={g.profile.kitchen}
        hint={hasKitchen ? g.profile.modeKitchenHint : g.profile.kitchenJoin}
        selected={kitchenOn}
        onPress={() => chooseMode("kitchen")}
      />

      <Text style={st.label}>{g.profile.restaurant}</Text>
      <View style={st.rows}>
        {[
          { id: null as string | null, name: g.profile.all },
          ...m.locations,
        ].map((l, i) => (
          <Pressable
            key={l.id ?? "all"}
            accessibilityRole="button"
            accessibilityState={{ selected: l.id === m.locationId }}
            onPress={() => m.setLocationId(l.id)}
            style={[st.row, i > 0 && st.rowBorder]}
          >
            <Icon name="restaurant-outline" size={20} />
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
        <View style={[st.row, st.rowBorder]}>
          <Icon name="notifications-outline" size={20} />
          <Text style={st.rowText}>{g.profile.notifications}</Text>
          <Text style={st.value}>{g.profile.dailySummary}</Text>
        </View>
        {canInviteTeam(m.company) ? (
          <Pressable
            accessibilityRole="button"
            onPress={createInvite}
            disabled={busy}
            style={[st.row, st.rowBorder]}
          >
            <Icon name="qr-code-outline" size={20} />
            <Text style={st.rowText}>{g.profile.inviteTeam}</Text>
            <Icon name="chevron-forward" size={18} />
          </Pressable>
        ) : null}
      </View>
      <Muted>{g.profile.dailySummaryHint}</Muted>

      {invite ? (
        <Card style={st.inviteCard}>
          <Muted>{g.profile.inviteReady}</Muted>
          <Text selectable style={st.code}>
            {invite.url}
          </Text>
          <Button
            label={g.profile.inviteShare}
            onPress={() => void Share.share({ message: invite.url })}
          />
        </Card>
      ) : null}
      {inviteError ? <Muted>{inviteError}</Muted> : null}

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

function ModeCard({
  icon,
  title,
  hint,
  selected,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[st.mode, selected && st.modeOn]}
    >
      <View style={st.modeIcon}>
        <Icon
          name={icon}
          size={22}
          color={selected ? colors.blue : colors.ink}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={st.modeTitle}>{title}</Text>
        <Muted>{hint}</Muted>
      </View>
      <View style={[st.radio, selected && st.radioOn]}>
        {selected ? (
          <Icon name="checkmark" size={16} color={colors.white} />
        ) : null}
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  content: {
    padding: space.l,
    paddingTop: 10,
    gap: 12,
    paddingBottom: space.xl,
    backgroundColor: colors.white,
    flexGrow: 1,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  who: { flexDirection: "row", alignItems: "center", gap: 14, flexShrink: 1 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tint.blue14,
  },
  avatarText: { fontSize: 18, fontFamily: fonts.bold, color: colors.blue },
  name: { fontSize: 20, fontFamily: fonts.bold, color: colors.ink },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.ink,
    opacity: 0.62,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 8,
  },
  mode: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    minHeight: 76,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  modeOn: { borderColor: colors.blue, backgroundColor: tint.blue08 },
  modeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  modeTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  rows: {},
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: {
    flex: 1,
    fontSize: 17,
    fontFamily: fonts.regular,
    color: colors.ink,
  },
  value: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
  inviteCard: { gap: 8 },
  code: { fontSize: 14, fontFamily: fonts.regular, color: colors.ink },
});
