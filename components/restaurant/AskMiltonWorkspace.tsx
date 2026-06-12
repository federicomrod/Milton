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
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Cpu,
  Send,
  User,
  Loader2,
  ArrowRight,
  Info,
  Zap,
  Check,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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

const SUGGESTED_QUESTIONS = [
  "What are my biggest margin risks?",
  "Which dishes should I fix first?",
  "Which suppliers increased prices?",
  "Which ingredients are most expensive?",
  "Which menu items have missing recipes?",
  "Where is cost coverage incomplete?",
  "What changed after the latest invoice?",
  "What should I do this week?",
];

const SOURCE_AREA_LABEL: Record<string, string> = {
  sales: "Sales",
  menu: "Menu",
  supplier: "Supplier",
  invoice: "Invoice",
  agent: "Agent",
  data_quality: "Data quality",
};

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export function AskMiltonWorkspace() {
  return (
    <div className="space-y-6">
      <ExecutiveBriefingPanel />
      <ChatWorkspace />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Executive briefing panel
// ---------------------------------------------------------------------------

function ExecutiveBriefingPanel() {
  const [data, setData] = useState<BriefingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/briefing", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(body as BriefingPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="border-orange-200 dark:border-orange-900/50 bg-gradient-to-br from-orange-50/60 via-background to-background dark:from-orange-950/20 dark:via-background">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40">
            <Sparkles className="h-4 w-4 text-orange-600 dark:text-orange-300" />
          </span>
          <h2 className="text-base font-semibold">Executive briefing</h2>
          {data && <SourceBadge source={data.source} />}
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
            Refresh
          </Button>
        </div>

        {loading && !data && (
          <p className="text-sm text-muted-foreground">
            Reading your latest restaurant numbers…
          </p>
        )}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Could not load briefing: {error}
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
                title="Top risks"
                items={data.briefing.top_risks}
                tone="risk"
              />
              <BriefingList
                title="Top opportunities"
                items={data.briefing.top_opportunities}
                tone="opportunity"
              />
              <BriefingList
                title="Recommended actions"
                items={data.briefing.recommended_actions}
                tone="action"
              />
            </div>

            {data.briefing.confidence_notes.length > 0 && (
              <div className="text-[11px] text-muted-foreground italic flex items-start gap-1.5">
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
        : "text-orange-500";
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
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

function SourceBadge({ source }: { source: "openai" | "deterministic" }) {
  return (
    <Badge
      variant="outline"
      className={
        "text-[10px] uppercase tracking-wide " +
        (source === "openai"
          ? "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
          : "border-border text-muted-foreground")
      }
    >
      {source === "openai" ? (
        <>
          <Sparkles className="h-3 w-3 inline mr-1" />
          AI answer
        </>
      ) : (
        <>
          <Cpu className="h-3 w-3 inline mr-1" />
          Rule-based
        </>
      )}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Chat workspace
// ---------------------------------------------------------------------------

function ChatWorkspace() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

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
        const res = await fetch("/api/restaurant/ask-milton", {
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
          setError(body?.error ?? `HTTP ${res.status}`);
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setPending(false);
      }
    },
    [pending, turns]
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
              placeholder="Ask Milton about sales, margins, suppliers, recipes…"
              rows={2}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 dark:focus:ring-orange-800/50"
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
              Send
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Milton can propose actions from chat. You still approve and execute
            actions in the{" "}
            <Link
              href="/dashboard/restaurant/agents"
              className="underline hover:text-foreground transition-colors"
            >
              Agents workspace
            </Link>
            .
          </p>
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
  return (
    <div className="border-b border-border px-4 sm:px-6 py-4 bg-muted/20">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2">
        Suggested questions
      </p>
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onPick(q)}
            className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-muted hover:border-orange-300 dark:hover:border-orange-800 transition-colors disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center text-center py-8">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40 mb-3">
        <Sparkles className="h-5 w-5 text-orange-600 dark:text-orange-300" />
      </span>
      <p className="text-sm font-semibold">
        Ask Milton anything about your data
      </p>
      <p className="text-xs text-muted-foreground max-w-md mt-1">
        Try a suggested question above, or type your own. Milton uses your
        sales, recipes, suppliers and invoices — and tells you when something is
        missing.
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
  if (turn.role === "user") {
    return (
      <div className="flex items-start gap-3 justify-end">
        <div className="max-w-[80%] rounded-xl bg-orange-500 text-white px-3.5 py-2 text-sm leading-relaxed shadow-sm">
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
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40">
        <Sparkles className="h-4 w-4 text-orange-600 dark:text-orange-300" />
      </span>
      <div className="flex-1 min-w-0 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">
            Milton
          </span>
          {a && <SourceBadge source={a.source} />}
        </div>
        <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap">
          {turn.content}
        </div>

        {a && a.supporting_facts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {a.supporting_facts.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border bg-background px-2 py-1"
                title={SOURCE_AREA_LABEL[f.source_area] ?? f.source_area}
              >
                <span className="text-muted-foreground">{f.label}:</span>
                <span className="font-medium">{f.value}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide ml-1">
                  {SOURCE_AREA_LABEL[f.source_area] ?? f.source_area}
                </span>
              </span>
            ))}
          </div>
        )}

        {a && a.related_links.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {a.related_links.map((l, i) => (
              <Link
                key={i}
                href={l.href}
                className="inline-flex items-center gap-1 text-xs rounded-full border border-border bg-background px-2.5 py-1 hover:bg-muted hover:border-orange-300 dark:hover:border-orange-800 transition-colors"
              >
                {l.label}
                <ArrowRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
        )}

        {a && a.confidence_notes.length > 0 && (
          <div className="text-[11px] text-muted-foreground italic flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{a.confidence_notes[0]}</span>
          </div>
        )}

        {a && a.suggested_actions && a.suggested_actions.length > 0 && (
          <SuggestedActionChips
            actions={a.suggested_actions}
            disabled={disabled}
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
      {items.slice(0, 4).map((q, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q)}
          className="text-[11px] rounded-full border border-dashed border-border px-2.5 py-1 hover:bg-muted transition-colors disabled:opacity-50"
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

type ChipActionState =
  | "idle"
  | "confirming"
  | "loading"
  | "success"
  | "duplicate"
  | "error";

function SuggestedActionChips({
  actions,
  disabled,
}: {
  actions: SuggestedActionLocal[];
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5 pt-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1">
        <Zap className="h-3 w-3" />
        Suggested actions
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.map((action, i) => (
          <SuggestedActionChip key={i} action={action} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

function SuggestedActionChip({
  action,
  disabled,
}: {
  action: SuggestedActionLocal;
  disabled: boolean;
}) {
  const [state, setState] = useState<ChipActionState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConfirm = async () => {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/restaurant/ask-milton/create-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggested_action: action }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setState("duplicate");
      } else if (!res.ok) {
        setErrorMsg(
          (body as { error?: string })?.error ?? `HTTP ${res.status}`
        );
        setState("error");
      } else {
        setState("success");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  };

  // Navigation-only chip
  if (!action.creates_agent_action && action.target_route) {
    return (
      <Link
        href={action.target_route}
        className="inline-flex items-center gap-1.5 text-xs rounded-full border border-border bg-background px-2.5 py-1 hover:bg-muted hover:border-orange-300 dark:hover:border-orange-800 transition-colors"
      >
        <ExternalLink className="h-3 w-3 text-muted-foreground" />
        {action.label}
        <ArrowRight className="h-3 w-3" />
      </Link>
    );
  }

  // Agent-action chip states
  if (state === "idle") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setState("confirming")}
        className="inline-flex items-center gap-1.5 text-xs rounded-full border border-dashed border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 text-orange-900 dark:text-orange-200 px-2.5 py-1 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors disabled:opacity-50"
      >
        <Zap className="h-3 w-3" />
        {action.label}
      </button>
    );
  }

  if (state === "confirming") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 px-3 py-1.5 flex-wrap">
        <span className="text-orange-900 dark:text-orange-200 font-medium">
          Create this as an agent action?
        </span>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          className="rounded border border-orange-300 dark:border-orange-700 bg-orange-500 text-white px-2 py-0.5 hover:bg-orange-600 transition-colors"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="rounded border border-border px-2 py-0.5 hover:bg-muted transition-colors text-muted-foreground"
        >
          No
        </button>
      </span>
    );
  }

  if (state === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs rounded-full border border-border bg-muted/40 px-2.5 py-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Creating…
      </span>
    );
  }

  if (state === "success") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1 flex-wrap">
        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        <span className="text-emerald-800 dark:text-emerald-300 font-medium">
          Action created
        </span>
        <Link
          href="/dashboard/restaurant/agents"
          className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400 underline hover:no-underline"
        >
          View in Agents
          <ArrowRight className="h-3 w-3" />
        </Link>
      </span>
    );
  }

  if (state === "duplicate") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-1 flex-wrap">
        <Info className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        <span className="text-amber-800 dark:text-amber-300">
          An open action already exists for this item.
        </span>
        <Link
          href="/dashboard/restaurant/agents"
          className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400 underline hover:no-underline"
        >
          View in Agents
          <ArrowRight className="h-3 w-3" />
        </Link>
      </span>
    );
  }

  // error state
  return (
    <span className="inline-flex items-center gap-1.5 text-xs rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-1 flex-wrap">
      <AlertTriangle className="h-3 w-3 text-red-500" />
      <span className="text-red-700 dark:text-red-400">
        {errorMsg ?? "Something went wrong"}
      </span>
      <button
        type="button"
        onClick={() => setState("idle")}
        className="underline text-red-700 dark:text-red-400 hover:no-underline"
      >
        Retry
      </button>
    </span>
  );
}

function PendingBubble() {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40">
        <Sparkles className="h-4 w-4 text-orange-600 dark:text-orange-300" />
      </span>
      <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading your latest restaurant data…
      </div>
    </div>
  );
}
