import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { ApiError, friendlyMessage } from "../../api/client";
import type { HistoryItem, Recipe } from "../../api/types";
import { KIND_LABEL, OutboxRow } from "../../components/OutboxList";
import {
  Banner,
  Button,
  Chip,
  Field,
  Muted,
  Screen,
  Segments,
  text,
} from "../../components/ui";
import { formatQuantity, formatWhen } from "../../lib/format";
import { reportOffline, useOutbox } from "../../send/outbox";
import { useSession } from "../../session/SessionProvider";
import { colors, font, space } from "../../theme";

type Tab = "sends" | "recipes";

export default function Historial() {
  const { offline } = useOutbox();
  const [tab, setTab] = useState<Tab>("sends");
  return (
    <Screen>
      {offline ? <Banner text="Sin conexión" /> : null}
      <View style={s.top}>
        <Segments
          value={tab}
          onChange={setTab}
          options={[
            { value: "sends", label: "Mis envíos" },
            { value: "recipes", label: "Recetas" },
          ]}
        />
      </View>
      {tab === "sends" ? <Sends /> : <Recipes />}
    </Screen>
  );
}

// --- Mis envíos -------------------------------------------------------------

function Sends() {
  const { api } = useSession();
  const { items: outbox } = useOutbox();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (more: boolean) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      try {
        const page = await api.history(more ? cursor : null);
        setItems((prev) => (more ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
        reportOffline(false);
      } catch (err) {
        setError(friendlyMessage(err));
        if (err instanceof ApiError && err.offline) reportOffline(true);
      } finally {
        busy.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, cursor]
  );

  // Reload when the tab comes to the front, so a fresh send shows up.
  useFocusEffect(
    useCallback(() => {
      void load(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const waiting = outbox.filter((i) => i.state !== "sent");

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      contentContainerStyle={s.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.blue}
          onRefresh={() => {
            setRefreshing(true);
            void load(false);
          }}
        />
      }
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (cursor) void load(true);
      }}
      ListHeaderComponent={
        <View>
          {waiting.length > 0 ? (
            <View>
              <Text style={text.big}>Por enviar</Text>
              {waiting.map((i) => (
                <OutboxRow key={i.id} item={i} />
              ))}
            </View>
          ) : null}
          {error ? <Muted>{error}</Muted> : null}
        </View>
      }
      ListEmptyComponent={
        loading || error ? undefined : (
          <Muted style={{ paddingVertical: space.l }}>
            Aún no has enviado nada.
          </Muted>
        )
      }
      renderItem={({ item }) => (
        <View style={s.row}>
          <View style={s.rowHead}>
            <Text style={s.kind}>{KIND_LABEL[item.kind] ?? "Envío"}</Text>
            <Chip tone="mint" label="Enviado" />
          </View>
          {item.text ? <Text style={s.body}>{item.text}</Text> : null}
          <Muted>{formatWhen(item.createdAt)}</Muted>
        </View>
      )}
    />
  );
}

// --- Recetas ----------------------------------------------------------------

function Recipes() {
  const { api } = useSession();
  const [query, setQuery] = useState("");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Recipe | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (q: string, from: string | null) => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const page = await api.recipes({ q: q || null, cursor: from });
        if (mine !== seq.current) return;
        setRecipes((prev) =>
          from ? [...prev, ...page.recipes] : page.recipes
        );
        setCursor(page.nextCursor);
        setError(null);
        reportOffline(false);
      } catch (err) {
        if (mine !== seq.current) return;
        setError(friendlyMessage(err));
        if (err instanceof ApiError && err.offline) reportOffline(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [api]
  );

  // Search by name, a moment after the cook stops typing.
  useEffect(() => {
    const t = setTimeout(() => void load(query.trim(), null), query ? 400 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  if (open) return <RecipeDetail recipe={open} onBack={() => setOpen(null)} />;

  return (
    <FlatList
      data={recipes}
      keyExtractor={(r) => r.id}
      contentContainerStyle={s.list}
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (cursor && !loading) void load(query.trim(), cursor);
      }}
      ListHeaderComponent={
        <View style={{ gap: space.s, paddingBottom: space.s }}>
          <Field
            label="Buscar receta"
            value={query}
            onChangeText={setQuery}
            placeholder="Nombre del plato"
            autoCorrect={false}
          />
          {error ? <Muted>{error}</Muted> : null}
        </View>
      }
      ListEmptyComponent={
        loading || error ? undefined : (
          <Muted style={{ paddingVertical: space.l }}>
            {query ? "No encontré ese plato." : "Aún no hay recetas aprobadas."}
          </Muted>
        )
      }
      renderItem={({ item }) => (
        <Button
          label={item.name}
          variant="secondary"
          onPress={() => setOpen(item)}
          style={s.recipeButton}
        />
      )}
    />
  );
}

function RecipeDetail({
  recipe,
  onBack,
}: {
  recipe: Recipe;
  onBack: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={[s.list, { gap: space.m }]}>
      <Button label="Volver a recetas" variant="secondary" onPress={onBack} />
      <Text style={text.title}>{recipe.name}</Text>
      <Muted>
        {[
          recipe.category,
          recipe.yield
            ? `Rinde ${formatQuantity(recipe.yield.quantity)} ${recipe.yield.unit}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Muted>
      {recipe.description ? (
        <Text style={s.body}>{recipe.description}</Text>
      ) : null}
      <Text style={text.big}>Ingredientes</Text>
      {recipe.ingredients.length === 0 ? (
        <Muted>Sin ingredientes.</Muted>
      ) : null}
      {recipe.ingredients.map((i, n) => (
        <View key={`${i.name}-${n}`} style={s.ingredient}>
          <Text style={[s.body, { flex: 1 }]}>{i.name}</Text>
          <Text style={s.qty}>
            {formatQuantity(i.quantity)} {i.unit}
          </Text>
        </View>
      ))}
      {recipe.steps.length > 0 ? <Text style={text.big}>Pasos</Text> : null}
      {recipe.steps.map((step, n) => (
        <Text key={n} style={s.body}>
          {n + 1}. {step}
        </Text>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  top: { padding: space.m, paddingBottom: space.s },
  list: { padding: space.m, paddingBottom: space.xl },
  row: {
    paddingVertical: space.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: space.s,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kind: { fontSize: font.small, fontWeight: "700", color: colors.ink },
  body: { fontSize: font.body, color: colors.ink },
  recipeButton: { marginBottom: space.s, alignItems: "flex-start" },
  ingredient: {
    flexDirection: "row",
    gap: space.m,
    paddingVertical: space.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  qty: { fontSize: font.body, fontWeight: "700", color: colors.ink },
});
