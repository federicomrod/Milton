// components/restaurant/AskMiltonWorkspace.tsx
//
// Client shell for the Ask Milton page. Hosts:
//   - the executive briefing panel (data from /api/restaurant/briefing)
//   - suggested question chips
//   - a chat workspace (messages + composer)
//
// All OpenAI calls happen server-side via /api/restaurant/ask-milton.
// This component never sees an API key.

"use client";

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Send,
  User,
  Loader2,
  ArrowRight,
  Info,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { withLocationParam } from "@/components/restaurant/RestaurantShell";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { useAskMiltonController } from "@/components/restaurant/shell/ask-milton-controller";
import {
  ASK_MILTON_MAX_FOLLOWUPS,
  ASK_MILTON_MAX_RELATED_LINKS,
} from "@/lib/restaurant/ask-milton-limits";
import { isPerItemAskMiltonChip } from "@/lib/restaurant/ask-milton-actions";
import { userErrorMessage } from "@/lib/restaurant/user-error";

const MiltonUiLang = createContext<PreferredLanguage>("es");
function useMiltonLang(): PreferredLanguage {
  return useContext(MiltonUiLang);
}

function suggestedQuestions(lang: PreferredLanguage): string[] {
  return [
    t(
      lang,
      "What are my biggest margin risks?",
      "¿Cuáles son mis mayores riesgos de margen?"
    ),
    t(
      lang,
      "Which dishes should I fix first?",
      "¿Qué platos debo corregir primero?"
    ),
    t(
      lang,
      "Which suppliers increased prices?",
      "¿Qué proveedores subieron los precios?"
    ),
    t(
      lang,
      "Which ingredients are most expensive?",
      "¿Qué ingredientes salen más caros?"
    ),
    t(
      lang,
      "Which menu items have missing recipes?",
      "¿Qué platos no tienen receta?"
    ),
    t(
      lang,
      "Where is cost coverage incomplete?",
      "¿Dónde está incompleta la cobertura de costo?"
    ),
    t(
      lang,
      "What changed after the latest invoice?",
      "¿Qué cambió después de la última factura?"
    ),
    t(lang, "What should I do this week?", "¿Qué debería hacer esta semana?"),
  ];
}

// ---------------------------------------------------------------------------
// Types — locally declared to avoid pulling server-only modules client-side.
// ---------------------------------------------------------------------------

interface BriefingPayload {
  source: "openai" | "deterministic";
  generated_at: string;
  context_summary: {
    restaurant_name: string;
    period_label: string;
    currency: string;
    revenue: number;
    orders: number | null;
    cost_coverage_pct: number;
    estimated_gross_margin_pct: number | null;
    food_cost_pct: number | null;
    open_recommendations_total: number;
    open_recommendations_critical: number;
  };
  briefing: {
    headline: string;
    summary: string;
    top_risks: string[];
    top_opportunities: string[];
    recommended_actions: string[];
    confidence_notes: string[];
  };
}

interface SupportingFact {
  label: string;
  value: string;
  source_area: string;
}

interface RelatedLink {
  label: string;
  href: string;
}

interface SuggestedActionLocal {
  label: string;
  action_type: string;
  agent_key: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  payload_json: Record<string, unknown>;
  impact_json: Record<string, unknown>;
  priority: string;
  creates_agent_action: boolean;
  target_route: string | null;
}

interface AnswerPayload {
  source: "openai" | "deterministic";
  generated_at: string;
  answer: string;
  supporting_facts: SupportingFact[];
  related_links: RelatedLink[];
  suggested_followups: string[];
  confidence_notes: string[];
  suggested_actions: SuggestedActionLocal[];
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: AnswerPayload;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export function AskMiltonWorkspace({
  lang = "es",
}: {
  lang?: PreferredLanguage;
}) {
  return (
    <MiltonUiLang.Provider value={lang}>
      <div className="space-y-6">
        <ExecutiveBriefingPanel />
        <Suspense fallback={<ChatWorkspaceSkeleton />}>
          <ChatWorkspace />
        </Suspense>
      </div>
    </MiltonUiLang.Provider>
  );
}

function ChatWorkspaceSkeleton() {
  const lang = useMiltonLang();
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 text-sm text-muted-foreground">
        {t(lang, "Loading Ask Milton...", "Cargando Preguntar a Milton...")}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Executive briefing panel
// ---------------------------------------------------------------------------

function ExecutiveBriefingPanel() {
  // useSearchParams() requires a Suspense boundary — see the wrapper below.
  return (
    <Suspense fallback={<ExecutiveBriefingPanelSkeleton />}>
      <ExecutiveBriefingPanelInner />
    </Suspense>
  );
}

function ExecutiveBriefingPanelSkeleton() {
  const lang = useMiltonLang();
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          {t(lang, "Loading briefing...", "Cargando el briefing...")}
        </div>
      </CardContent>
    </Card>
  );
}

function ExecutiveBriefingPanelInner() {
  const lang = useMiltonLang();
  const [data, setData] = useState<BriefingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Multi-Restaurant UX v1: re-fetch when the selected restaurant changes so
  // the briefing reflects the currently selected location (or consolidated
  // when none is selected).
  const locationId = useSearchParams().get("location");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = locationId
        ? `/api/restaurant/briefing?location=${encodeURIComponent(locationId)}`
        : "/api/restaurant/briefing";
      const res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          userErrorMessage(
            body,
            t(
              lang,
              "Could not load the briefing",
              "No se pudo cargar el briefing"
            )
          )
        );
        setData(null);
        return;
      }
      setData(body as BriefingPayload);
    } catch {
      setError(t(lang, "Network error", "Error de red"));
    } finally {
      setLoading(false);
    }
  }, [locationId, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-[#c6d3f5] dark:border-[#2a3f8f]/50 bg-gradient-to-br from-[#eef2fd]/60 via-background to-background dark:from-[#1B40C8]/20 dark:via-background">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e1e8fa] dark:bg-[#1B40C8]/40">
            <Sparkles className="h-4 w-4 text-[#1B40C8] dark:text-[#9fb4f2]" />
          </span>
          <h2 className="text-base font-semibold">
            {t(lang, "Executive briefing", "Briefing ejecutivo")}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs gap-1"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw
              className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")}
            />
            {t(lang, "Refresh", "Actualizar")}
          </Button>
        </div>

        {loading && !data && (
          <p className="text-sm text-muted-foreground">
            {t(
              lang,
              "Reading your latest restaurant numbers…",
              "Leyendo los números más recientes…"
            )}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t(
              lang,
              "Could not load briefing:",
              "No se pudo cargar el briefing:"
            )}{" "}
            {error}
          </p>
        )}

        {data && (
          <div className="space-y-4">
            <div>
              <p className="text-base font-semibold leading-snug">
                {data.briefing.headline}
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                {data.briefing.summary}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <BriefingList
                title={t(lang, "Top risks", "Principales riesgos")}
                items={data.briefing.top_risks}
                tone="risk"
              />
              <BriefingList
                title={t(
                  lang,
                  "Top opportunities",
                  "Principales oportunidades"
                )}
                items={data.briefing.top_opportunities}
                tone="opportunity"
              />
              <BriefingList
                title={t(lang, "Recommended actions", "Acciones recomendadas")}
                items={data.briefing.recommended_actions}
                tone="action"
              />
            </div>

            {data.briefing.confidence_notes.length > 0 && (
              <div className="text-[12px] text-muted-foreground italic flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{data.briefing.confidence_notes[0]}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BriefingList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "risk" | "opportunity" | "action";
}) {
  if (items.length === 0) return null;
  const dot =
    tone === "risk"
      ? "text-red-500"
      : tone === "opportunity"
        ? "text-emerald-500"
        : "text-[#1B40C8]";
  return (
    <div>
      <p className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
        {title}
      </p>
      <ul className="space-y-1 text-sm">
        {items.slice(0, 3).map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`${dot} mt-1 shrink-0`}>•</span>
            <span className="leading-snug">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat workspace
// ---------------------------------------------------------------------------

function ChatWorkspace() {
  const lang = useMiltonLang();
  const { draft, nonce } = useAskMiltonController();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Multi-Restaurant UX v1: scope every chat turn's context to the
  // currently selected restaurant (or consolidated when none is selected).
  const locationId = useSearchParams().get("location");

  // Switching restaurants mid-conversation starts a fresh thread — old
  // turns were answered under a different (now stale) restaurant context,
  // and re-sending them as `conversation` history could bleed one
  // restaurant's answers into another's. A plain page load also has no
  // turns yet, so this is a no-op on first mount.
  useEffect(() => {
    setTurns([]);
  }, [locationId]);

  useEffect(() => {
    if (draft) setInput(draft);
  }, [draft, nonce]);

  // Auto-scroll on new turns.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || pending) return;
      setError(null);
      const userTurn: ChatTurn = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      const conversation = [...turns, userTurn].map((t) => ({
        role: t.role,
        content: t.content,
      }));
      setTurns((prev) => [...prev, userTurn]);
      setInput("");
      setPending(true);
      try {
        const url = locationId
          ? `/api/restaurant/ask-milton?location=${encodeURIComponent(locationId)}`
          : "/api/restaurant/ask-milton";
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            conversation: conversation.slice(-6),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            userErrorMessage(
              body,
              t(
                lang,
                "Could not get an answer",
                "No se pudo obtener una respuesta"
              )
            )
          );
          return;
        }
        const answer = body as AnswerPayload;
        const assistantTurn: ChatTurn = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: answer.answer,
          answer,
        };
        setTurns((prev) => [...prev, assistantTurn]);
      } catch {
        setError(t(lang, "Network error", "Error de red"));
      } finally {
        setPending(false);
      }
    },
    [pending, turns, locationId, lang]
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onTextareaKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0 flex flex-col">
        {/* Suggested questions */}
        {turns.length === 0 && (
          <SuggestedQuestions onPick={(q) => void send(q)} disabled={pending} />
        )}

        {/* Messages */}
        <div
          ref={listRef}
          className="px-4 sm:px-6 py-4 sm:py-6 min-h-[280px] max-h-[60vh] overflow-y-auto space-y-5"
        >
          {turns.length === 0 && !pending && <EmptyState />}
          {turns.map((t) => (
            <MessageBubble
              key={t.id}
              turn={t}
              onFollowup={(q) => void send(q)}
              disabled={pending}
            />
          ))}
          {pending && <PendingBubble />}
        </div>

        {error && (
          <div className="px-4 sm:px-6 pb-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={onSubmit}
          className="border-t border-border bg-background/60 backdrop-blur px-3 sm:px-4 py-3"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onTextareaKey}
              placeholder={t(
                lang,
                "Ask Milton about sales, margins, suppliers, recipes…",
                "Pregúntale a Milton sobre ventas, márgenes, proveedores, recetas…"
              )}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c6d3f5] dark:focus:ring-[#2a3f8f]/50"
              disabled={pending}
            />
            <Button
              type="submit"
              disabled={pending || input.trim().length === 0}
              className="h-10 gap-1.5"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {t(lang, "Send", "Enviar")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SuggestedQuestions({
  onPick,
  disabled,
}: {
  onPick: (q: string) => void;
  disabled: boolean;
}) {
  const lang = useMiltonLang();
  return (
    <div className="border-b border-border px-4 sm:px-6 py-4 bg-muted/20">
      <p className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
        {t(lang, "Suggested questions", "Preguntas sugeridas")}
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestedQuestions(lang).map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onPick(q)}
            className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-muted hover:border-[#a9bcef] dark:hover:border-[#2a3f8f] transition-colors disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  const lang = useMiltonLang();
  return (
    <div className="flex flex-col items-center text-center py-8">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#e1e8fa] dark:bg-[#1B40C8]/40 mb-3">
        <Sparkles className="h-5 w-5 text-[#1B40C8] dark:text-[#9fb4f2]" />
      </span>
      <p className="text-sm font-semibold">
        {t(
          lang,
          "Ask Milton anything about your data",
          "Pregúntale a Milton sobre tus datos"
        )}
      </p>
      <p className="text-xs text-muted-foreground max-w-md mt-1">
        {t(
          lang,
          "Try a suggested question above, or type your own. Milton uses your sales, recipes, suppliers and invoices — and tells you when something is missing.",
          "Usa una pregunta sugerida o escribe la tuya. Milton usa tus ventas, recetas, proveedores y facturas, y te dice cuando falta algo."
        )}
      </p>
    </div>
  );
}

function MessageBubble({
  turn,
  onFollowup,
  disabled,
}: {
  turn: ChatTurn;
  onFollowup: (q: string) => void;
  disabled: boolean;
}) {
  // Multi-Restaurant UX v1: links surfaced inside an answer (related_links,
  // suggested action chips) must carry the current selection forward too —
  // otherwise following one silently drops back to consolidated. Read
  // unconditionally, before any early return (rules of hooks).
  const locationId = useSearchParams().get("location");

  if (turn.role === "user") {
    return (
      <div className="flex items-start gap-3 justify-end">
        <div className="max-w-[80%] rounded-xl bg-[#1B40C8] text-white px-3.5 py-2 text-sm leading-relaxed shadow-sm">
          {turn.content}
        </div>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4 text-muted-foreground" />
        </span>
      </div>
    );
  }
  const a = turn.answer;
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e1e8fa] dark:bg-[#1B40C8]/40">
        <Sparkles className="h-4 w-4 text-[#1B40C8] dark:text-[#9fb4f2]" />
      </span>
      <div className="flex-1 min-w-0 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">
            Milton
          </span>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap">
          {turn.content}
        </div>

        {a && a.related_links.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {a.related_links
              .slice(0, ASK_MILTON_MAX_RELATED_LINKS)
              .map((l, i) => (
                <Link
                  key={i}
                  href={withLocationParam(l.href, locationId)}
                  className="inline-flex items-center gap-1 text-xs rounded-full border border-border bg-background px-2.5 py-1 hover:bg-muted hover:border-[#a9bcef] dark:hover:border-[#2a3f8f] transition-colors"
                >
                  {l.label}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ))}
          </div>
        )}

        {a &&
          a.suggested_actions &&
          a.suggested_actions.some((x) => !isPerItemAskMiltonChip(x)) && (
            <SuggestedActionChips
              actions={a.suggested_actions.filter(
                (x) => !isPerItemAskMiltonChip(x)
              )}
            />
          )}

        {a && a.suggested_followups.length > 0 && (
          <FollowupChips
            items={a.suggested_followups}
            onPick={onFollowup}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function FollowupChips({
  items,
  onPick,
  disabled,
}: {
  items: string[];
  onPick: (q: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {items.slice(0, ASK_MILTON_MAX_FOLLOWUPS).map((q, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q)}
          className="text-[12px] rounded-full border border-dashed border-border px-2.5 py-1 hover:bg-muted transition-colors disabled:opacity-50"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggested action chips (Stage 2)
// ---------------------------------------------------------------------------

function SuggestedActionChips({
  actions,
}: {
  actions: SuggestedActionLocal[];
}) {
  const lang = useMiltonLang();
  return (
    <div className="space-y-1.5 pt-0.5">
      <p className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1">
        <Zap className="h-3 w-3" />
        {t(lang, "Suggested actions", "Acciones sugeridas")}
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.map((action, i) => (
          <SuggestedActionChip key={i} action={action} />
        ))}
      </div>
    </div>
  );
}

// Ask Milton only links to the screen where you act (#379): no action is
// created or approved from the chat.
function SuggestedActionChip({ action }: { action: SuggestedActionLocal }) {
  const locationId = useSearchParams().get("location");
  if (action.creates_agent_action || !action.target_route) return null;
  return (
    <Link
      href={withLocationParam(action.target_route, locationId)}
      className="inline-flex items-center gap-1.5 text-xs rounded-full border border-[#1B40C8]/30 dark:border-[#1B40C8]/50 bg-[#E7EDFD] dark:bg-[#1B40C8]/20 text-[#1B40C8] dark:text-[#c9d6fb] font-medium px-2.5 py-1 hover:bg-[#1B40C8] hover:text-white hover:border-[#1B40C8] dark:hover:bg-[#1533A3] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
    >
      {action.label}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function PendingBubble() {
  const lang = useMiltonLang();
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e1e8fa] dark:bg-[#1B40C8]/40">
        <Sparkles className="h-4 w-4 text-[#1B40C8] dark:text-[#9fb4f2]" />
      </span>
      <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t(
          lang,
          "Reading your latest restaurant data…",
          "Leyendo los datos más recientes de tu restaurante…"
        )}
      </div>
    </div>
  );
}
