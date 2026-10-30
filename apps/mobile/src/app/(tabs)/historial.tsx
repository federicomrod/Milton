import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { ApiError, friendlyMessage } from "../../api/client";
import type { HistoryItem, Recipe } from "../../api/types";
import { AppHeader } from "../../components/AppHeader";
import { ServerRow, WaitingRow } from "../../components/ItemRows";
import {
  Banner,
  Button,
  Card,
  Field,
  Muted,
  Screen,
  Segments,
  text,
} from "../../components/ui";
import { useStrings } from "../../i18n";
import { fmt } from "../../i18n/strings";
import { dayGroup, formatQuantity, type DayGroup } from "../../lib/format";
import { offlineText } from "../../lib/result";
import { reportOffline, useOutbox } from "../../send/outbox";
import { useHistoryFeed } from "../../send/useHistoryFeed";
import { useSession } from "../../session/SessionProvider";
import { colors, fonts, space } from "../../theme";

type Tab = "sends" | "recipes";

export default function Historial() {
  const s = useStrings();
  const { items, offline } = useOutbox();
  const [tab, setTab] = useState<Tab>("sends");
  const waiting = items.filter((i) => i.state !== "sent").length;
  return (
    <Screen>
      <AppHeader title={s.history.title} />
      {offline ? <Banner text={offlineText(waiting, s)} /> : null}
      <View style={st.top}>
        <Segments
          value={tab}
          onChange={setTab}
          options={[
            { value: "sends", label: s.history.sends },
            { value: "recipes", label: s.history.recipes },
          ]}
        />
      </View>
      {tab === "sends" ? <Sends /> : <Recipes />}
    </Screen>
  );
}

// --- Mis envíos -------------------------------------------------------------

function Sends() {
  const s = useStrings();
  const { items: outbox } = useOutbox();
  const feed = useHistoryFeed();
  const [now] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      feed.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const waiting = outbox.filter((i) => i.state !== "sent");
  const label: Record<DayGroup, string> = {
    today: s.history.today,
    yesterday: s.history.yesterday,
    earlier: s.history.earlier,
  };
  const sections = (["today", "yesterday", "earlier"] as const)
    .map((g) => ({
      key: g,
      title: label[g],
      data: feed.items.filter((i) => dayGroup(i.createdAt, now) === g),
    }))
    .filter((sec) => sec.data.length > 0);

  return (
    <SectionList<
      HistoryItem,
      { key: string; title: string; data: HistoryItem[] }
    >
      sections={sections}
      keyExtractor={(i) => i.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={st.list}
      refreshControl={
        <RefreshControl
          refreshing={feed.refreshing}
          tintColor={colors.blue}
          onRefresh={feed.refresh}
        />
      }
      onEndReachedThreshold={0.4}
      onEndReached={feed.loadMore}
      ListHeaderComponent={
        <View>
          {waiting.length > 0 ? (
            <View>
              <Text style={st.section}>{s.history.toSend}</Text>
              {waiting.map((i) => (
                <WaitingRow key={i.id} item={i} />
              ))}
            </View>
          ) : null}
          {feed.error ? <Muted>{feed.error}</Muted> : null}
        </View>
      }
      ListEmptyComponent={
        feed.loading || feed.error || waiting.length > 0 ? undefined : (
          <Muted style={{ paddingVertical: space.l }}>
            {s.history.nothingYet}
          </Muted>
        )
      }
      renderSectionHeader={({ section }) => (
        <Text style={st.section}>{section.title}</Text>
      )}
      renderItem={({ item }) => <ServerRow item={item} />}
    />
  );
}

// --- Recetas ----------------------------------------------------------------

function Recipes() {
  const s = useStrings();
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
        setError(friendlyMessage(err, s.errors));
        if (err instanceof ApiError && err.offline) reportOffline(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [api, s]
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
      contentContainerStyle={st.list}
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (cursor && !loading) void load(query.trim(), cursor);
      }}
      ListHeaderComponent={
        <View style={{ gap: space.s, paddingBottom: space.m }}>
          <Field
            label={s.recipes.searchLabel}
            value={query}
            onChangeText={setQuery}
            placeholder={s.recipes.searchPlaceholder}
            autoCorrect={false}
          />
          {error ? <Muted>{error}</Muted> : null}
        </View>
      }
      ListEmptyComponent={
        loading || error ? undefined : (
          <Muted style={{ paddingVertical: space.l }}>
            {query ? s.recipes.notFound : s.recipes.none}
          </Muted>
        )
      }
      renderItem={({ item }) => (
        <Button
          label={item.name}
          variant="secondary"
          onPress={() => setOpen(item)}
          style={st.recipeButton}
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
  const s = useStrings();
  const meta = [
    recipe.category,
    recipe.yield
      ? fmt(s.recipes.yields, {
          quantity: formatQuantity(recipe.yield.quantity),
          unit: recipe.yield.unit,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ScrollView contentContainerStyle={[st.list, { gap: space.m }]}>
      <Button
        label={s.recipes.back}
        variant="secondary"
        icon="chevron-back"
        onPress={onBack}
      />
      <Text style={text.heading}>{recipe.name}</Text>
      {meta ? <Muted>{meta}</Muted> : null}
      {recipe.description ? (
        <Text style={text.body}>{recipe.description}</Text>
      ) : null}
      <Text style={text.big}>{s.recipes.ingredients}</Text>
      <Card style={{ paddingVertical: space.s }}>
        {recipe.ingredients.length === 0 ? (
          <Muted>{s.recipes.noIngredients}</Muted>
        ) : null}
        {recipe.ingredients.map((i, n) => (
          <View
            key={`${i.name}-${n}`}
            style={[st.ingredient, n === 0 && { borderTopWidth: 0 }]}
          >
            <Text style={[text.body, { flex: 1 }]}>{i.name}</Text>
            <Text style={text.bold}>
              {formatQuantity(i.quantity)} {i.unit}
            </Text>
          </View>
        ))}
      </Card>
      {/* Pasos only when the recipe has real steps. */}
      {recipe.steps.length > 0 ? (
        <>
          <Text style={text.big}>{s.recipes.steps}</Text>
          <Card style={{ gap: space.m }}>
            {recipe.steps.map((step, n) => (
              <Text key={n} style={text.body}>
                {n + 1}. {step}
              </Text>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  top: { paddingHorizontal: space.l, paddingBottom: space.s },
  list: { paddingHorizontal: space.l, paddingBottom: space.xl },
  section: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.ink,
    opacity: 0.62,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingTop: space.m,
  },
  recipeButton: { marginBottom: space.s },
  ingredient: {
    flexDirection: "row",
    gap: space.m,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
