"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MENU_TAB_PATHS,
  type MenuTab,
} from "@/lib/restaurant/recetas-redirect";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import type { DishEstimateRow } from "@/lib/restaurant/menu-reading/estimate";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  markApproved,
  nextToReview,
  summaryFromEditorState,
  withDishSummary,
  withTreatment,
} from "@/lib/restaurant/recipe-costing/optimistic";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";
import { TREATMENT_URL } from "./TreatmentPanel";
import {
  clearEditors,
  dropEditorsForProduct,
  editorQuery,
  onEditorsCleared,
  prefetchEditor,
} from "@/lib/restaurant/recipe-costing/editor-cache";
import {
  getCachedTab,
  loadTab,
  markTabsStale,
  menuTabKey,
  putTab,
  tabEpoch,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";
import { registerMenuTabSwitcher } from "@/lib/restaurant/recipe-costing/menu-tab-bridge";
import { cachedPickerOptions } from "@/lib/restaurant/recipe-costing/picker-cache";
import { MenuTabSkeleton } from "@/components/restaurant/menu/MenuTabSkeleton";
import { activeMenuTab } from "./MenuAreaTabs";
import { ConfirmHowDialog } from "./ConfirmHowDialog";
import { PlatoScreen } from "./PlatoScreen";
import { MenuDishesScreen } from "@/components/restaurant/menu/MenuDishesScreen";
import { PreparacionesScreen } from "./PreparacionesScreen";
import { ResumenScreen } from "./ResumenScreen";

type WorkspaceTab = "resumen" | "plato" | "preparaciones";

const TAB_OF_VIEW: Record<WorkspaceTab, MenuTab> = {
  resumen: "resumen",
  plato: "platos",
  preparaciones: "preparaciones",
};

/** Params that ride along between Menú tabs (restaurant and period). */
const SHELL_PARAMS = ["location", "from", "to"] as const;

const VIEW_OF_TAB: Partial<Record<MenuTab, WorkspaceTab>> = {
  resumen: "resumen",
  platos: "plato",
  preparaciones: "preparaciones",
};

/** Restaurant and period as they are in the address bar right now. */
function shellFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return {
    location: params.get("location"),
    from: params.get("from"),
    to: params.get("to"),
  };
}

/** A dish's one-dish payload (list numbers + editor view) read ahead. */
const DISH_PAYLOAD_FRESH_MS = 30_000;

/**
 * Menú › Resumen, Platos and Preparaciones (R1-09b): each tab is a route
 * and passes its `view`; moving between tabs is a navigation to that
 * route, choosing a dish or preparation only changes its own param.
 */
export function RecipesCostingWorkspace({
  initial,
  view: routeView,
  estimates = [],
}: {
  initial: RecipeCostingWorkspace;
  view: WorkspaceTab;
  /** «Estimado por Milton»: read apart from the economics, shown muted. */
  estimates?: DishEstimateRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState(initial);
  // R1-12: the open tab. It follows the route, and also changes when the
  // tab bar hands over a click (the tab then comes from the browser's own
  // cache, with a background re-read, instead of a new server page).
  const [view, setView] = useState<WorkspaceTab>(routeView);
  /** A tab whose data is being read (nothing cached yet): show its skeleton. */
  const [loadingTab, setLoadingTab] = useState<WorkspaceTab | null>(null);
  const activeTab = useRef<WorkspaceTab>(routeView);
  /** One-dish payloads read ahead (hover, next dish), by restaurant, period and dish. */
  const dishPayloads = useRef(
    new Map<string, { json: RecipeCostingWorkspace; at: number }>()
  );
  /** Bumped when a payload is dropped: a read in flight then is not stored. */
  const dishEpoch = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After an estimate run / «Usar como borrador»: re-read the page's estimates. */
  const refreshEstimates = useCallback(() => {
    markTabsStale();
    router.refresh();
  }, [router]);
  const [howOpen, setHowOpen] = useState(false);
  // Tab and dish switches re-render on the server; mark them as a
  // transition so the screen shows it is loading right away.
  const [navigating, startNavigation] = useTransition();

  const selectedId = searchParams.get("producto")
    ? Number(searchParams.get("producto"))
    : (data.selected?.odoo_product_id ?? null);

  /** Open another Menú tab, keeping restaurant and period. */
  const goToTab = useCallback(
    (tab: WorkspaceTab, extra: Record<string, string | null> = {}) => {
      const params = new URLSearchParams();
      for (const key of SHELL_PARAMS) {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      }
      for (const [key, value] of Object.entries(extra)) {
        if (value) params.set(key, value);
      }
      const query = params.toString();
      const path = MENU_TAB_PATHS[TAB_OF_VIEW[tab]];
      startNavigation(() => {
        router.push(query ? `${path}?${query}` : path, { scroll: false });
      });
    },
    [router, searchParams]
  );

  const fetchWorkspace = useCallback(
    async (
      opts: {
        productId?: number | null;
        editorOnly?: boolean;
        view?: WorkspaceTab;
      } = {}
    ) => {
      const params = new URLSearchParams();
      params.set("vista", opts.view ?? view);
      const productId =
        opts.productId !== undefined ? opts.productId : selectedId;
      if (productId) params.set("odoo_product_id", String(productId));
      const location = searchParams.get("location");
      if (location) params.set("location_id", location);
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      if (from && to) {
        params.set("start_date", from);
        params.set("end_date", to);
      }
      if (opts.editorOnly) params.set("editor_only", "1");
      const res = await fetch(
        `/api/restaurant/recipes/costing?${params.toString()}`
      );
      if (!res.ok) throw new Error("No pude recargar el avance.");
      return (await res.json()) as RecipeCostingWorkspace;
    },
    [searchParams, selectedId, view]
  );

  /**
   * R1-12: a click on another Menú tab. The tab opens from the browser's
   * copy at once (and is re-read in the background unless it is fresh); if
   * there is no copy yet its skeleton shows while it loads. If the read
   * fails, fall back to the ordinary page navigation.
   */
  const switchTab = useCallback(
    (tab: MenuTab, href: string): boolean => {
      const next = VIEW_OF_TAB[tab];
      if (!next || next === activeTab.current) return false;
      const key = menuTabKey(next, shellFromLocation());
      const cached = getCachedTab(key);
      // Leaving Platos: its editors are forgotten (a price may change in
      // the tab we are going to).
      if (activeTab.current === "plato") clearEditors();
      activeTab.current = next;
      window.history.pushState(null, "", href);
      setError(null);
      if (cached) {
        setData(cached.data);
        setView(next);
        setLoadingTab(null);
        if (cached.fresh) return true;
      } else {
        setLoadingTab(next);
      }
      void loadTab(key, () =>
        fetchWorkspace({ view: next, productId: null })
      ).then((json) => {
        if (activeTab.current !== next) return;
        if (!json) {
          if (!cached) {
            setLoadingTab(null);
            startNavigation(() => router.push(href, { scroll: false }));
          }
          return;
        }
        setData(json);
        setView(next);
        setLoadingTab(null);
      });
      return true;
    },
    [fetchWorkspace, router]
  );

  /** Pointer over a tab: read it now, so the click finds it ready. */
  const prefetchTab = useCallback(
    (tab: MenuTab) => {
      const next = VIEW_OF_TAB[tab];
      if (!next || next === activeTab.current) return;
      const key = menuTabKey(next, shellFromLocation());
      if (getCachedTab(key)?.fresh) return;
      void loadTab(key, () => fetchWorkspace({ view: next, productId: null }));
    },
    [fetchWorkspace]
  );

  /**
   * R1-13: once the open tab is up, the other two are read in ONE request
   * (they share the expensive part), so the first click on them already
   * finds a copy. A save while it is on its way drops its answer.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      const shell = shellFromLocation();
      const missing = (["resumen", "plato", "preparaciones"] as const).filter(
        (v) =>
          v !== activeTab.current && !getCachedTab(menuTabKey(v, shell))?.fresh
      );
      if (missing.length === 0) return;
      const epochAtStart = tabEpoch();
      const params = new URLSearchParams();
      params.set("vistas", missing.join(","));
      if (shell.location) params.set("location_id", shell.location);
      if (shell.from && shell.to) {
        params.set("start_date", shell.from);
        params.set("end_date", shell.to);
      }
      void fetch(`/api/restaurant/recipes/costing?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json: Record<string, RecipeCostingWorkspace | null> | null) => {
          if (!json || tabEpoch() !== epochAtStart) return;
          for (const v of missing) {
            const payload = json[v];
            if (payload) putTab(menuTabKey(v, shell), payload);
          }
        })
        .catch(() => undefined);
    }, 1200);
    return () => clearTimeout(timer);
  }, [routeView, initial]);

  useEffect(
    () =>
      registerMenuTabSwitcher({
        switchTo: switchTab,
        prefetch: prefetchTab,
      }),
    [switchTab, prefetchTab]
  );

  const reload = useCallback(async () => {
    const epochAtStart = tabEpoch();
    const json = await fetchWorkspace();
    setData(json);
    // A save that landed while this was in flight keeps the cache stale.
    if (tabEpoch() === epochAtStart) {
      putTab(menuTabKey(view, shellFromLocation()), json);
    }
  }, [fetchWorkspace, view]);

  /** After an ingredient edit: refresh only the open dish (no sales scan);
   *  the list, shares and coverage stay as last loaded. */
  const reloadDish = useCallback(async () => {
    if (!selectedId) return reload();
    const json = await fetchWorkspace({ editorOnly: true });
    setData((prev) => {
      const sameDish =
        prev.editor?.odoo_product_id === json.editor?.odoo_product_id;
      const editor =
        json.editor && sameDish && prev.editor
          ? {
              ...json.editor,
              share_label: prev.editor.share_label,
              review_index: prev.editor.review_index,
              review_total: prev.editor.review_total,
              next_odoo_product_id: prev.editor.next_odoo_product_id,
            }
          : json.editor;
      const fresh = json.selected;
      const selected =
        fresh && prev.selected?.odoo_product_id === fresh.odoo_product_id
          ? {
              ...fresh,
              share_pct: prev.selected.share_pct,
              share_label: prev.selected.share_label,
              net_sales: prev.selected.net_sales,
              net_sales_label: prev.selected.net_sales_label,
            }
          : fresh;
      return {
        ...prev,
        editor,
        selected,
        // The chip follows the editor live (onEditorState); the one-dish
        // reload only refreshes the editor view (checklist, version).
      };
    });
  }, [fetchWorkspace, reload, selectedId]);

  useEffect(() => {
    putTab(menuTabKey(routeView, shellFromLocation()), initial);
    // The tab bar may have moved to another tab in the browser since this
    // page was rendered (a server refresh of the old route): that payload
    // belongs to the old tab, so it only warms the cache.
    const urlView = VIEW_OF_TAB[activeMenuTab(window.location.pathname)];
    if (urlView && urlView !== routeView) return;
    setData(initial);
    setView(routeView);
    setLoadingTab(null);
    activeTab.current = routeView;
  }, [initial, routeView]);

  // Leaving Menú (or Platos for another tab) forgets the dishes' editors:
  // a price changed elsewhere must not be shown from here.
  useEffect(() => () => clearEditors(), []);
  // A catalog edit moves every dish's numbers: the dishes read ahead go too.
  useEffect(
    () =>
      onEditorsCleared(() => {
        dishEpoch.current++;
        dishPayloads.current.clear();
      }),
    []
  );

  const dishPayloadKey = useCallback((id: number) => {
    const shell = shellFromLocation();
    return `${menuTabKey("plato", shell)}|${id}`;
  }, []);

  // After an edit the line is already on screen (the editor shows the
  // server's answer); the dish summary catches up once, after a burst of
  // edits, instead of one full reload per save.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReloadDish = useCallback(() => {
    // A saved edit changes what the other tabs and this dish's cached
    // payload show (other dishes' payloads go when the catalog changes).
    markTabsStale();
    const open = Number(
      new URLSearchParams(window.location.search).get("producto")
    );
    if (Number.isInteger(open) && open > 0) {
      dishEpoch.current++;
      dishPayloads.current.delete(dishPayloadKey(open));
    }
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void reloadDish().catch(() => undefined);
    }, 600);
  }, [reloadDish, dishPayloadKey]);
  useEffect(
    () => () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    },
    []
  );

  async function mutate(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      markTabsStale();
      dishEpoch.current++;
      dishPayloads.current.clear();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo falló.");
    } finally {
      setBusy(false);
    }
  }

  function openPreparation(
    componentId: string | null,
    opts: { fromDish?: boolean } = {}
  ) {
    // Opened from a dish: Preparaciones offers the way back to it.
    const extra = {
      prep: componentId,
      desde: opts.fromDish ? "plato" : null,
      producto: opts.fromDish && selectedId ? String(selectedId) : null,
    };
    if (view === "preparaciones") {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(extra)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      // R1-13: choosing another preparation only changes the address bar;
      // the list and the cached lines are already here (it used to render
      // the whole Menú page again on the server).
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
      return;
    }
    goToTab("preparaciones", extra);
  }

  async function post(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "No pude guardar.");
  }

  const postAndReload = (url: string, body: Record<string, unknown>) =>
    void mutate(() => post(url, body));

  /**
   * The treatment dropdown: the screen changes at once and the save runs in
   * the background (no reload of the whole Platos page); an error rolls it
   * back. Everything else still saves and reloads.
   */
  const postOptimistic = (url: string, body: Record<string, unknown>) => {
    const item = (
      body.items as Array<Record<string, unknown>> | undefined
    )?.[0];
    const id = Number(item?.odoo_product_id);
    const treatment = item?.treatment as PosProductClassification | undefined;
    const previous =
      data.products.find((p) => p.odoo_product_id === id)?.treatment ??
      (data.selected?.odoo_product_id === id ? data.selected.treatment : null);
    if (
      url !== TREATMENT_URL ||
      !Number.isInteger(id) ||
      !treatment ||
      !previous
    ) {
      postAndReload(url, body);
      return;
    }
    const queueBefore = data.plato_queue;
    const name = String(item?.odoo_name ?? "");
    setError(null);
    // What was remembered about this dish, and what other tabs show, is old.
    dropEditorsForProduct(id);
    dishEpoch.current++;
    dishPayloads.current.clear();
    markTabsStale();
    setData((prev) => withTreatment(prev, id, treatment));
    void post(url, body).catch((err) => {
      setData((prev) => ({
        ...withTreatment(prev, id, previous),
        plato_queue: queueBefore,
      }));
      setError(
        `No se pudo cambiar cómo se costea ${name || "el producto"}: ${err instanceof Error ? err.message : "intenta otra vez."}`
      );
    });
  };

  /** What a one-dish read changes on screen: the editor view and the
   *  dish's own price numbers; the shares stay from the full list. */
  const applyDishPayload = useCallback(
    (id: number, json: RecipeCostingWorkspace) =>
      setData((prev) =>
        prev.selected?.odoo_product_id !== id
          ? prev
          : {
              ...prev,
              // The one-dish load knows only this dish's sales: keep
              // the shares and position from the full list.
              editor: json.editor
                ? {
                    ...json.editor,
                    share_label:
                      prev.selected?.share_label ?? json.editor.share_label,
                  }
                : null,
              selected: json.selected
                ? {
                    ...json.selected,
                    share_pct: prev.selected.share_pct,
                    share_label: prev.selected.share_label,
                    net_sales: prev.selected.net_sales,
                    net_sales_label: prev.selected.net_sales_label,
                  }
                : prev.selected,
            }
      ),
    []
  );

  /**
   * R1-12: read a dish ahead of time (the next one to review, or the row
   * under the pointer): its editor lines and its one-dish payload. Nothing
   * on screen changes; choosing the dish then shows it at once.
   */
  const prefetchDish = useCallback(
    (id: number) => {
      if (activeTab.current !== "plato") return;
      const location = searchParams.get("location");
      const omit = cachedPickerOptions() ? "&omit_options=1" : "";
      const query = editorQuery({ odooProductId: id, locationId: location });
      void prefetchEditor(
        query,
        async () => {
          const res = await fetch(
            `/api/restaurant/recipes/editor?${query}${omit}`
          );
          return res.ok ? ((await res.json()) as EditorState) : null;
        },
        // Warming only: a copy under two minutes old is not read again
        // (opening the dish still re-reads anything older than 10 s).
        { productId: id, maxAgeMs: 120_000 }
      );
      const key = dishPayloadKey(id);
      const held = dishPayloads.current.get(key);
      if (held && Date.now() - held.at < DISH_PAYLOAD_FRESH_MS) return;
      const epochAtStart = dishEpoch.current;
      void fetchWorkspace({ productId: id, editorOnly: true, view: "plato" })
        .then((json) => {
          if (dishEpoch.current === epochAtStart) {
            dishPayloads.current.set(key, { json, at: Date.now() });
          }
        })
        .catch(() => undefined);
    },
    [dishPayloadKey, fetchWorkspace, searchParams]
  );

  /** Pointer or focus on a dish row: read it ahead once the intent is clear. */
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchDishOnIntent = useCallback(
    (id: number) => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => prefetchDish(id), 120);
    },
    [prefetchDish]
  );
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    []
  );

  /**
   * R1-09c: choosing a dish happens in the browser. The list already has
   * its numbers (dish_summaries); the URL follows with replaceState and
   * only the dish's editor view is fetched, in the background. R1-12: a
   * dish read ahead is shown with no request at all.
   */
  const selectDish = useCallback(
    (id: number) => {
      setData((prev) => ({
        ...prev,
        selected:
          prev.products.find((p) => p.odoo_product_id === id) ?? prev.selected,
        editor: prev.editor?.odoo_product_id === id ? prev.editor : null,
        selected_dish:
          prev.dish_summaries?.find((d) => d.odoo_product_id === id) ??
          (prev.selected_dish?.odoo_product_id === id
            ? prev.selected_dish
            : null),
      }));
      const params = new URLSearchParams(window.location.search);
      params.set("producto", String(id));
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
      const key = dishPayloadKey(id);
      const held = dishPayloads.current.get(key);
      if (held && Date.now() - held.at < DISH_PAYLOAD_FRESH_MS) {
        applyDishPayload(id, held.json);
        return;
      }
      const epochAtStart = dishEpoch.current;
      void fetchWorkspace({ productId: id, editorOnly: true })
        .then((json) => {
          if (dishEpoch.current === epochAtStart) {
            dishPayloads.current.set(key, { json, at: Date.now() });
          }
          applyDishPayload(id, json);
        })
        .catch(() => setError("No pude abrir ese plato. Intenta otra vez."));
    },
    [applyDishPayload, dishPayloadKey, fetchWorkspace, pathname]
  );

  // The next two dishes to review are read while this one is being worked
  // on, so "Aprobar y siguiente" opens the next one with its lines ready.
  const openEditorId = data.editor?.odoo_product_id ?? null;
  const upcoming = useMemo(() => {
    if (view !== "plato" || !selectedId || openEditorId !== selectedId) {
      return "";
    }
    const ids: number[] = [];
    let from = selectedId;
    for (let i = 0; i < 2; i++) {
      const next = nextToReview(data.plato_queue, from);
      if (next === null || next === selectedId || ids.includes(next)) break;
      ids.push(next);
      from = next;
    }
    return ids.join(",");
  }, [view, selectedId, openEditorId, data.plato_queue]);
  useEffect(() => {
    if (!upcoming) return;
    const timer = setTimeout(() => {
      for (const id of upcoming.split(",")) prefetchDish(Number(id));
    }, 400);
    return () => clearTimeout(timer);
  }, [upcoming, prefetchDish]);

  /** After each line edit: the dish's cost, chip and margin follow the
   *  editor's own total at once (no server reload of the list). */
  const onEditorState = useCallback((state: EditorState) => {
    setData((prev) => {
      const current = prev.selected_dish;
      if (!current) return prev;
      return withDishSummary(prev, summaryFromEditorState(current, state));
    });
  }, []);

  /** "Aprobar y siguiente" / "Enviar a aprobación y siguiente": the POS link
   *  and the recipe version are saved as two separate steps on the server. */
  async function confirmDish(how?: string) {
    const editor = data.editor;
    if (!editor) return;
    if (data.actor.needs_client_confirmation && !how) {
      setHowOpen(true);
      return;
    }
    // R1-09c: approve locally and open the next dish at once; the save
    // runs in the background and rolls back on an error.
    const id = editor.odoo_product_id;
    const before = data;
    const next = nextToReview(data.plato_queue, id);
    setError(null);
    // The dish changes state: what was remembered about it, and what the
    // other tabs show, is out of date.
    dropEditorsForProduct(id);
    dishEpoch.current++;
    dishPayloads.current.delete(dishPayloadKey(id));
    markTabsStale();
    if (data.actor.can_approve) setData((prev) => markApproved(prev, id));
    if (next) selectDish(next);
    try {
      await post("/api/restaurant/recipes/plato/confirm", {
        odoo_product_id: editor.odoo_product_id,
        odoo_name: editor.odoo_name,
        recipe_version_id: editor.recipe_version_id,
        location_id: searchParams.get("location") ?? undefined,
        confirmed_how: how ?? "en_pantalla",
        yield_confirmed: editor.checklist.yield_confirmed,
      });
    } catch (err) {
      setData(before);
      selectDish(id);
      setError(
        `${editor.odoo_name}: ${err instanceof Error ? err.message : "no se pudo aprobar."}`
      );
    }
  }

  return (
    <div className="w-full">
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {navigating ? (
        <div
          role="status"
          className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
        >
          Cargando…
        </div>
      ) : null}
      <div
        aria-busy={navigating}
        className={navigating ? "pointer-events-none opacity-60" : undefined}
      >
        {loadingTab ? (
          <MenuTabSkeleton tab={loadingTab} />
        ) : view === "plato" &&
          !searchParams.get("producto") &&
          data.menu_dishes ? (
          // R1-10: Platos is the menu dishes; a dish opens its recipe.
          <MenuDishesScreen
            data={data}
            estimates={estimates}
            onEstimated={refreshEstimates}
            onOpenDish={selectDish}
            statusFilter={(searchParams.get("estado") ?? "")
              .split(",")
              .filter(Boolean)}
          />
        ) : view === "plato" ? (
          <>
            {data.menu_dishes ? (
              <nav className="mb-3 text-[14px] text-[#6b7385]">
                <button
                  type="button"
                  className="font-semibold text-[#1B40C8]"
                  onClick={() => {
                    const params = new URLSearchParams(window.location.search);
                    params.delete("producto");
                    const query = params.toString();
                    window.history.replaceState(
                      null,
                      "",
                      query ? `${pathname}?${query}` : pathname
                    );
                  }}
                >
                  Platos
                </button>
                {data.selected_dish?.menu_dish_name ? (
                  <>
                    {" › "}
                    <b className="text-[#151c2c]">
                      {data.selected_dish.menu_dish_name}
                    </b>
                  </>
                ) : null}
              </nav>
            ) : null}
            <PlatoScreen
              data={data}
              estimates={estimates}
              onEstimateChanged={refreshEstimates}
              locationId={searchParams.get("location")}
              busy={busy}
              onSelect={selectDish}
              onPrefetch={prefetchDishOnIntent}
              onEditorState={onEditorState}
              onEdited={scheduleReloadDish}
              onPost={postOptimistic}
              onConfirm={() => void confirmDish()}
              onOpenPreparation={(id) =>
                openPreparation(id, { fromDish: true })
              }
              statusFilter={(searchParams.get("estado") ?? "")
                .split(",")
                .filter(Boolean)}
              onFilter={(filter) => {
                // A list filter is client state: no server round trip.
                const params = new URLSearchParams(searchParams.toString());
                if (filter) params.set("estado", filter);
                else params.delete("estado");
                const query = params.toString();
                window.history.replaceState(
                  null,
                  "",
                  query ? `${pathname}?${query}` : pathname
                );
              }}
            />
          </>
        ) : view === "preparaciones" ? (
          <PreparacionesScreen
            data={data}
            selectedId={searchParams.get("prep")}
            onSelect={(id) =>
              openPreparation(id, {
                fromDish: searchParams.get("desde") === "plato",
              })
            }
            onBackToDish={
              searchParams.get("desde") === "plato" && selectedId
                ? () => goToTab("plato", { producto: String(selectedId) })
                : undefined
            }
            locationId={searchParams.get("location")}
          />
        ) : (
          <ResumenScreen
            data={data}
            estimates={estimates}
            locationId={searchParams.get("location")}
          />
        )}
      </div>

      <ConfirmHowDialog
        open={howOpen}
        title="Aprobar en nombre del cliente"
        onCancel={() => setHowOpen(false)}
        onConfirm={(how) => {
          setHowOpen(false);
          void confirmDish(how);
        }}
      />
    </div>
  );
}
