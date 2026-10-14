"use client";

// R1-15g (F4): Milton's group suggestions on a list of ungrouped items.
// Name/category suggestions are worked out here (nothing leaves the browser);
// "Pedir más a Milton" sends only the names and categories of what is left
// to the AI and stores the answer as SUGGESTED groups. A suggestion never
// counts as grouped until accepted; accepting makes it a normal group,
// marked «✦ Agrupado por Milton».

import { useCallback, useMemo, useState } from "react";
import {
  clusterSuggestions,
  leftOver,
  type Cluster,
  type ClusterItem,
} from "@/lib/restaurant/groups/cluster-suggest";
import {
  confirmSuggestion,
  createGroup,
  createSuggestedGroups,
  ungroupGroup,
} from "@/lib/restaurant/groups/group-ops";
import type { GroupMemberType } from "@/lib/restaurant/groups/item-groups";
import { useRememberedSet, type useItemGroups } from "./use-item-groups";

export interface SuggestedCluster extends Cluster {
  /** Set when the suggestion is stored (an ai_suggested / suggested group). */
  groupId?: string;
}

const uuid = () => crypto.randomUUID();

export function useMiltonSuggestions({
  scope,
  grouping,
  ungrouped,
  takenNames,
  enabled,
}: {
  scope: "product" | "preparation" | "ingredient";
  grouping: ReturnType<typeof useItemGroups>;
  /** The items in no group right now. */
  ungrouped: readonly ClusterItem[];
  /** Names of the groups that exist here (confirmed or suggested). */
  takenNames: readonly string[];
  enabled: boolean;
}) {
  const memberType: GroupMemberType =
    scope === "product" ? "pos_product" : scope;
  const hierarchy = useMemo(() => ({ scope }), [scope]);
  const dismissed = useRememberedSet(`milton:sugerencias:descartadas:${scope}`);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAsked, setAiAsked] = useState(false);

  const clusters = useMemo<SuggestedCluster[]>(() => {
    if (!enabled) return [];
    const open = new Set(ungrouped.map((i) => i.ref));
    const stored: SuggestedCluster[] = [];
    for (const g of grouping.state.groups) {
      if (g.scope !== scope || g.status !== "suggested") continue;
      const refs = grouping.state.members
        .filter(
          (m) =>
            m.group_id === g.id &&
            m.member_type === memberType &&
            open.has(m.member_ref)
        )
        .map((m) => m.member_ref);
      if (refs.length < 2) continue;
      stored.push({
        key: `guardada:${g.id}`,
        name: g.name,
        refs,
        reason: "ia",
        groupId: g.id,
      });
    }
    const covered = new Set(stored.flatMap((c) => c.refs));
    const heuristic = clusterSuggestions(
      ungrouped.filter((i) => !covered.has(i.ref)),
      { takenNames: new Set(takenNames) }
    ).filter((c) => !dismissed.set.has(c.key));
    return [...stored, ...heuristic];
  }, [
    enabled,
    ungrouped,
    takenNames,
    grouping.state,
    scope,
    memberType,
    dismissed.set,
  ]);

  const preview = clusters.find((c) => c.key === previewKey) ?? null;

  const apply = useCallback(
    async (c: SuggestedCluster) => {
      setPreviewKey(null);
      if (c.groupId) {
        await grouping.run((s) => confirmSuggestion(s, c.groupId!));
      } else {
        await grouping.run((s) =>
          createGroup(s, {
            name: c.name,
            hierarchy,
            items: c.refs.map((ref) => ({ type: memberType, ref })),
            source: "ai_suggested",
            status: "confirmed",
            uuid,
          })
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouping.run, hierarchy, memberType]
  );

  const dismiss = useCallback(
    async (c: SuggestedCluster) => {
      setPreviewKey(null);
      if (c.groupId) await grouping.run((s) => ungroupGroup(s, c.groupId!));
      else dismissed.toggle(c.key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouping.run, dismissed.toggle]
  );

  /** What no suggestion covers yet: the only thing the AI is asked about. */
  const remaining = useMemo(
    () => leftOver(ungrouped, clusters),
    [ungrouped, clusters]
  );

  const askAi = useCallback(async () => {
    setAiBusy(true);
    setAiAsked(true);
    try {
      const res = await fetch("/api/restaurant/item-groups/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          items: remaining.map((i) => ({
            ref: i.ref,
            name: i.name,
            category: i.category ?? null,
          })),
          taken_names: takenNames,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        clusters?: Cluster[];
        unavailable?: boolean;
        error?: string;
      };
      if (!res.ok) {
        grouping.notify(
          json.error ?? "Milton no pudo sugerir grupos ahora.",
          true
        );
        return;
      }
      if (json.unavailable) {
        grouping.notify(
          "La IA no está configurada en este ambiente: solo hay sugerencias por nombre y categoría."
        );
        return;
      }
      const found = json.clusters ?? [];
      if (found.length === 0) {
        grouping.notify("Milton no encontró más grupos claros.");
        return;
      }
      await grouping.run((s) =>
        createSuggestedGroups(s, {
          hierarchy,
          itemType: memberType,
          clusters: found,
          uuid,
        })
      );
    } catch {
      grouping.notify("Milton no pudo sugerir grupos ahora.", true);
    } finally {
      setAiBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    remaining,
    scope,
    takenNames,
    hierarchy,
    memberType,
    grouping.run,
    grouping.notify,
  ]);

  const previewRefs = useMemo(
    () => (preview ? new Set(preview.refs) : null),
    [preview]
  );

  return {
    clusters,
    preview,
    previewRefs,
    startPreview: (c: SuggestedCluster) => setPreviewKey(c.key),
    endPreview: () => setPreviewKey(null),
    apply,
    dismiss,
    askAi,
    aiBusy,
    aiAsked,
    canAskAi: remaining.length >= 4,
  };
}
