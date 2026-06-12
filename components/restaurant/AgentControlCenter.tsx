// components/restaurant/AgentControlCenter.tsx
//
// Client component — the full Agent Control Center UI.
// Tabs: Control Center | Recommendations | Run History
//
// Data flow:
//   * Initial data is server-fetched and passed as props (agent definitions
//     + configs, recommendations, runs).
//   * Mutations call the API routes and trigger local state updates so the
//     user sees instant feedback without a full page reload.

"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Settings,
  Play,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
  Info,
  ShieldAlert,
  Inbox,
  History,
  Cpu,
  ExternalLink,
  ListChecks,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CockpitTabs } from "@/components/restaurant/cockpit/CockpitTabs";
import type {
  AgentDefinition,
  AgentConfig,
  AgentRun,
  AgentRecommendation,
} from "@/types/agents";
import type { AgentAction, AgentActionStatus } from "@/types/agent-actions";
import type { AgentActionProposal } from "@/lib/restaurant/agents/action-proposals";

// ---------------------------------------------------------------------------
// Types for the combined definition+config view
// ---------------------------------------------------------------------------

export interface AgentWithConfig extends AgentDefinition {
  config: AgentConfig | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<string, string> = {
  sales: "Sales",
  margin: "Margin",
  supplier: "Supplier",
  invoice: "Invoice",
  inventory: "Inventory",
  finance: "Finance",
  menu: "Menu",
};

const SEVERITY_STYLE: Record<
  string,
  { chipClass: string; icon: React.ReactNode }
> = {
  info: {
    chipClass:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
    icon: <Info className="h-3.5 w-3.5" />,
  },
  warning: {
    chipClass:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  critical: {
    chipClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
  },
};

const RUN_STATUS_STYLE: Record<string, string> = {
  queued: "text-muted-foreground",
  running: "text-blue-600 dark:text-blue-400",
  completed: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
};

function fmtDuration(started: string, finished: string | null): string {
  if (!finished) return "—";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}min`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentControlCenter({
  initialAgents,
  initialRecommendations,
  initialRuns,
  initialActions,
  currentUserId,
}: {
  initialAgents: AgentWithConfig[];
  initialRecommendations: AgentRecommendation[];
  initialRuns: AgentRun[];
  initialActions?: AgentAction[];
  /** Used so the Actions UI can say "Assigned to you" without doing a
   *  separate user lookup. Null when the page is unauthenticated. */
  currentUserId?: string | null;
}) {
  const [agents, setAgents] = useState<AgentWithConfig[]>(initialAgents);
  const [recommendations, setRecommendations] = useState<AgentRecommendation[]>(
    initialRecommendations
  );
  const [runs, setRuns] = useState<AgentRun[]>(initialRuns);
  const [actions, setActions] = useState<AgentAction[]>(initialActions ?? []);
  const [activeTab, setActiveTab] = useState<string>("control");

  // Counts derived from actions
  const openActionsCount = actions.filter((a) =>
    ["proposed", "approved", "assigned"].includes(a.status)
  ).length;
  const proposedActionsCount = actions.filter(
    (a) => a.status === "proposed"
  ).length;

  // Group actions by recommendation_id so the recommendation card can show
  // a small "1 action exists" hint without an extra round-trip.
  const actionsByRecommendation = actions.reduce<Record<string, AgentAction[]>>(
    (acc, a) => {
      if (!a.recommendation_id) return acc;
      const list = acc[a.recommendation_id] ?? [];
      list.push(a);
      acc[a.recommendation_id] = list;
      return acc;
    },
    {}
  );

  const refreshAfterRun = async () => {
    try {
      const [recRes, runRes, actRes] = await Promise.all([
        fetch("/api/restaurant/agents/recommendations", {
          credentials: "include",
        }),
        fetch("/api/restaurant/agents/runs", { credentials: "include" }),
        fetch("/api/restaurant/agent-actions", { credentials: "include" }),
      ]);
      if (recRes.ok) {
        const j = (await recRes.json()) as {
          recommendations: AgentRecommendation[];
        };
        if (Array.isArray(j.recommendations))
          setRecommendations(j.recommendations);
      }
      if (runRes.ok) {
        const j = (await runRes.json()) as { runs: AgentRun[] };
        if (Array.isArray(j.runs)) setRuns(j.runs);
      }
      if (actRes.ok) {
        const j = (await actRes.json()) as { actions: AgentAction[] };
        if (Array.isArray(j.actions)) setActions(j.actions);
      }
    } catch {
      // best-effort refresh — UI keeps last known data on error
    }
  };

  const refreshActions = async () => {
    try {
      const res = await fetch("/api/restaurant/agent-actions", {
        credentials: "include",
      });
      if (!res.ok) return;
      const j = (await res.json()) as { actions: AgentAction[] };
      if (Array.isArray(j.actions)) setActions(j.actions);
    } catch {
      // best-effort
    }
  };

  const onActionCreated = (created: AgentAction[]) => {
    setActions((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      return [...created.filter((a) => !seen.has(a.id)), ...prev];
    });
  };

  const onActionStatusChanged = (updated: AgentAction) => {
    setActions((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  // Count open recommendations per agent for badge display.
  const openCountByAgent = recommendations.reduce<Record<string, number>>(
    (acc, r) => {
      if (r.status === "open") acc[r.agent_key] = (acc[r.agent_key] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const totalOpen = recommendations.filter((r) => r.status === "open").length;

  const tabs = [
    {
      id: "control",
      label: "Control Center",
      badge: undefined,
      content: (
        <ControlCenterTab
          agents={agents}
          openCountByAgent={openCountByAgent}
          onConfigUpdated={(key, updated) =>
            setAgents((prev) =>
              prev.map((a) =>
                a.agent_key === key ? { ...a, config: updated } : a
              )
            )
          }
          onRunCompleted={refreshAfterRun}
        />
      ),
    },
    {
      id: "recommendations",
      label: "Recommendations",
      badge: totalOpen > 0 ? String(totalOpen) : undefined,
      content: (
        <RecommendationsTab
          recommendations={recommendations}
          agentNameByKey={Object.fromEntries(
            agents.map((a) => [a.agent_key, a.name])
          )}
          actionsByRecommendation={actionsByRecommendation}
          onStatusChange={(id, newStatus) =>
            setRecommendations((prev) =>
              prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r))
            )
          }
          onActionCreated={(created) => {
            onActionCreated(created);
          }}
          onSwitchToActions={() => setActiveTab("actions")}
        />
      ),
    },
    {
      id: "actions",
      label: "Actions",
      badge:
        openActionsCount > 0
          ? proposedActionsCount > 0
            ? `${proposedActionsCount}`
            : `${openActionsCount}`
          : undefined,
      content: (
        <ActionsTab
          actions={actions}
          agentNameByKey={Object.fromEntries(
            agents.map((a) => [a.agent_key, a.name])
          )}
          recommendationsById={Object.fromEntries(
            recommendations.map((r) => [r.id, r])
          )}
          currentUserId={currentUserId ?? null}
          onStatusChanged={onActionStatusChanged}
          onRefresh={refreshActions}
        />
      ),
    },
    {
      id: "history",
      label: "Run History",
      badge: undefined,
      content: (
        <RunHistoryTab
          runs={runs}
          agentNameByKey={Object.fromEntries(
            agents.map((a) => [a.agent_key, a.name])
          )}
        />
      ),
    },
  ];

  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="space-y-6 max-w-screen-2xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Cpu className="h-6 w-6 text-orange-500" />
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <Badge className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-0">
            Foundation
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground -mt-4 max-w-3xl">
          Structured workflow monitors for your restaurant. Enable an agent,
          then press Run to scan your sales, margins, and supplier data for
          actionable recommendations.
        </p>

        <CockpitTabs tabs={tabs} value={activeTab} onChange={setActiveTab} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Control Center
// ---------------------------------------------------------------------------

function ControlCenterTab({
  agents,
  openCountByAgent,
  onConfigUpdated,
  onRunCompleted,
}: {
  agents: AgentWithConfig[];
  openCountByAgent: Record<string, number>;
  onConfigUpdated: (key: string, config: AgentConfig) => void;
  onRunCompleted: () => Promise<void> | void;
}) {
  const live = agents.filter((a) => a.is_available && !a.is_coming_soon);
  const coming = agents.filter((a) => !a.is_available || a.is_coming_soon);

  return (
    <div className="space-y-8">
      {/* Live agents */}
      <section>
        <h2 className="text-base font-semibold mb-3">Active agents</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {live.map((agent) => (
            <AgentCard
              key={agent.agent_key}
              agent={agent}
              openCount={openCountByAgent[agent.agent_key] ?? 0}
              onConfigUpdated={onConfigUpdated}
              onRunCompleted={onRunCompleted}
            />
          ))}
        </div>
      </section>

      {/* Coming soon agents */}
      {coming.length > 0 && (
        <section>
          <h2 className="text-base font-semibold mb-3">Coming soon</h2>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {coming.map((agent) => (
              <ComingSoonCard key={agent.agent_key} agent={agent} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

function AgentCard({
  agent,
  openCount,
  onConfigUpdated,
  onRunCompleted,
}: {
  agent: AgentWithConfig;
  openCount: number;
  onConfigUpdated: (key: string, config: AgentConfig) => void;
  onRunCompleted: () => Promise<void> | void;
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const [toggling, startToggle] = useTransition();
  const [freqChanging, startFreqChange] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);

  const enabled = agent.config?.enabled ?? false;
  const frequency = agent.config?.run_frequency ?? "manual";

  const handleRun = async () => {
    setRunError(null);
    setRunSummary(null);
    setRunning(true);
    try {
      const res = await fetch("/api/restaurant/agents/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_key: agent.agent_key }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      const count =
        typeof body.findings_count === "number" ? body.findings_count : 0;
      setRunSummary(
        `${agent.name} completed: ${count} finding${count === 1 ? "" : "s"}.`
      );
      await onRunCompleted();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRunning(false);
    }
  };

  const patchConfig = async (patch: Record<string, unknown>) => {
    const res = await fetch("/api/restaurant/agents/config", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_key: agent.agent_key, ...patch }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body.config as AgentConfig;
  };

  const handleToggle = () => {
    setToggleError(null);
    startToggle(async () => {
      try {
        const updated = await patchConfig({ enabled: !enabled });
        onConfigUpdated(agent.agent_key, updated);
      } catch (err) {
        setToggleError(err instanceof Error ? err.message : "Toggle failed");
      }
    });
  };

  const handleFrequencyChange = (freq: string) => {
    startFreqChange(async () => {
      try {
        const updated = await patchConfig({ run_frequency: freq });
        onConfigUpdated(agent.agent_key, updated);
      } catch {
        // silent — visual state stays on previous value
      }
    });
  };

  return (
    <Card
      className={enabled ? "border-orange-200 dark:border-orange-900/50" : ""}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold">
              {agent.name}
            </CardTitle>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABEL[agent.category] ?? agent.category}
            </span>
          </div>
          {/* Toggle */}
          <button
            type="button"
            onClick={handleToggle}
            disabled={toggling}
            className={
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 " +
              (enabled ? "bg-orange-500" : "bg-muted")
            }
            role="switch"
            aria-checked={enabled}
            aria-label={`${enabled ? "Disable" : "Enable"} ${agent.name}`}
          >
            <span
              className={
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform " +
                (enabled ? "translate-x-4" : "translate-x-0")
              }
            />
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {agent.description}
        </p>

        {/* Status + open count */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={
              "inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 " +
              (enabled
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                : "bg-muted text-muted-foreground")
            }
          >
            {enabled ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            {enabled ? "Active" : "Inactive"}
          </span>
          {openCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              <Inbox className="h-3 w-3" />
              {openCount} open
            </span>
          )}
        </div>

        {toggleError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {toggleError}
          </p>
        )}

        {/* Run frequency */}
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground shrink-0">Frequency</span>
          <select
            value={frequency}
            onChange={(e) => handleFrequencyChange(e.target.value)}
            disabled={freqChanging}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs flex-1 min-w-0"
          >
            <option value="manual">Manual</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 gap-1 flex-1"
            onClick={() => setConfigOpen((v) => !v)}
          >
            <Settings className="h-3.5 w-3.5" />
            Configure
            {configOpen ? (
              <ChevronUp className="h-3 w-3 ml-auto" />
            ) : (
              <ChevronDown className="h-3 w-3 ml-auto" />
            )}
          </Button>
          <Button
            size="sm"
            variant="default"
            className="text-xs h-7 gap-1 bg-orange-500 hover:bg-orange-600 text-white border-0"
            onClick={handleRun}
            disabled={running || !enabled}
            title={
              !enabled
                ? "Enable agent first."
                : running
                  ? "Running…"
                  : "Run agent now"
            }
          >
            {running ? (
              <Clock className="h-3.5 w-3.5 animate-pulse" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {running ? "Running…" : "Run"}
          </Button>
        </div>
        {runSummary && (
          <p className="text-xs text-green-700 dark:text-green-300">
            {runSummary}
          </p>
        )}
        {runError && (
          <p className="text-xs text-red-600 dark:text-red-400">{runError}</p>
        )}

        {/* Inline config form */}
        {configOpen && (
          <ConfigForm
            agent={agent}
            onSaved={(updated) => {
              onConfigUpdated(agent.agent_key, updated);
              setConfigOpen(false);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Coming-soon card
// ---------------------------------------------------------------------------

function ComingSoonCard({ agent }: { agent: AgentWithConfig }) {
  return (
    <Card className="opacity-60 border-dashed">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground">
            {agent.name}
          </CardTitle>
          <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-muted text-muted-foreground shrink-0">
            Soon
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {agent.description}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Config form (inline expand)
// ---------------------------------------------------------------------------

const CONFIG_FIELDS: Record<
  string,
  { key: string; label: string; hint?: string }[]
> = {
  pos_agent: [
    {
      key: "revenue_drop_threshold_pct",
      label: "Revenue drop threshold (%)",
      hint: "Alert when revenue drops by this % vs previous period",
    },
    {
      key: "channel_shift_threshold_pct",
      label: "Channel shift threshold (%)",
      hint: "Alert when a channel's share shifts by this %",
    },
    {
      key: "low_volume_item_units",
      label: "Low volume item threshold (units)",
      hint: "Flag items selling fewer than this many units",
    },
  ],
  recipe_margin_agent: [
    {
      key: "low_margin_threshold_pct",
      label: "Low margin threshold (%)",
      hint: "Flag items with gross margin below this %",
    },
    {
      key: "high_food_cost_threshold_pct",
      label: "High food cost threshold (%)",
      hint: "Flag items with food cost above this %",
    },
    {
      key: "high_revenue_missing_recipe_threshold",
      label: "Missing recipe revenue threshold",
      hint: "Flag items with no recipe but revenue above this amount",
    },
  ],
  supplier_agent: [
    {
      key: "price_increase_threshold_pct",
      label: "Price increase threshold (%)",
      hint: "Alert when an ingredient price increases by this %",
    },
    {
      key: "supplier_concentration_threshold_pct",
      label: "Supplier concentration threshold (%)",
      hint: "Alert when a single supplier represents more than this % of spend",
    },
    {
      key: "lookback_days",
      label: "Lookback window (days)",
      hint: "Number of days to look back for price trend analysis",
    },
  ],
};

function ConfigForm({
  agent,
  onSaved,
}: {
  agent: AgentWithConfig;
  onSaved: (updated: AgentConfig) => void;
}) {
  const fields = CONFIG_FIELDS[agent.agent_key] ?? [];
  const defaultConfig = (agent.config?.config ??
    agent.default_config) as Record<string, number>;

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      fields.map((f) => [f.key, String(defaultConfig[f.key] ?? "")])
    )
  );
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        No configurable thresholds for this agent.
      </div>
    );
  }

  const save = () => {
    setError(null);
    setSuccess(false);

    // Validate all values are valid numbers.
    const config: Record<string, number> = {};
    for (const f of fields) {
      const n = Number(values[f.key]);
      if (!Number.isFinite(n)) {
        setError(`${f.label} must be a number.`);
        return;
      }
      config[f.key] = n;
    }

    startSave(async () => {
      try {
        const res = await fetch("/api/restaurant/agents/config", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_key: agent.agent_key, config }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
          return;
        }
        setSuccess(true);
        onSaved(body.config as AgentConfig);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3 mt-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Thresholds
      </p>
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-xs font-medium">{f.label}</span>
          {f.hint && (
            <span className="text-[10px] text-muted-foreground">{f.hint}</span>
          )}
          <Input
            type="number"
            value={values[f.key]}
            onChange={(e) =>
              setValues((v) => ({ ...v, [f.key]: e.target.value }))
            }
            className="h-8 text-xs"
          />
        </label>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={save}
          disabled={saving}
          className="h-7 text-xs"
        >
          {saving ? "Saving…" : "Save configuration"}
        </Button>
        {success && (
          <span className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {error && (
          <span className="text-xs text-red-700 dark:text-red-300">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Recommendations
// ---------------------------------------------------------------------------

const REC_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "approved", label: "Approved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "resolved", label: "Resolved" },
  { value: "snoozed", label: "Snoozed" },
] as const;

function RecommendationsTab({
  recommendations,
  agentNameByKey,
  actionsByRecommendation,
  onStatusChange,
  onActionCreated,
  onSwitchToActions,
}: {
  recommendations: AgentRecommendation[];
  agentNameByKey: Record<string, string>;
  actionsByRecommendation: Record<string, AgentAction[]>;
  onStatusChange: (
    id: string,
    newStatus: AgentRecommendation["status"]
  ) => void;
  onActionCreated: (created: AgentAction[]) => void;
  onSwitchToActions: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("open");

  const filtered =
    statusFilter === "all"
      ? recommendations
      : recommendations.filter((r) => r.status === statusFilter);

  const counts = recommendations.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {REC_STATUS_FILTER_OPTIONS.map((opt) => {
          const count =
            opt.value === "all"
              ? recommendations.length
              : (counts[opt.value] ?? 0);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={
                "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors " +
                (statusFilter === opt.value
                  ? "border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-900/20 dark:text-orange-200 dark:border-orange-700"
                  : "border-border text-muted-foreground hover:border-muted-foreground")
              }
            >
              {opt.label}
              {count > 0 && <span className="tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {statusFilter === "open"
              ? "No open recommendations"
              : `No ${statusFilter} recommendations`}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Enable an agent and press Run to populate this inbox.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              agentName={agentNameByKey[rec.agent_key] ?? rec.agent_key}
              existingActions={actionsByRecommendation[rec.id] ?? []}
              onStatusChange={onStatusChange}
              onActionCreated={onActionCreated}
              onSwitchToActions={onSwitchToActions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationCard({
  rec,
  agentName,
  existingActions,
  onStatusChange,
  onActionCreated,
  onSwitchToActions,
}: {
  rec: AgentRecommendation;
  agentName: string;
  existingActions: AgentAction[];
  onStatusChange: (id: string, s: AgentRecommendation["status"]) => void;
  onActionCreated: (created: AgentAction[]) => void;
  onSwitchToActions: () => void;
}) {
  const [acting, startAct] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_STYLE[rec.severity] ?? SEVERITY_STYLE.info;

  const act = (newStatus: AgentRecommendation["status"]) => {
    setError(null);
    startAct(async () => {
      try {
        const res = await fetch(
          `/api/restaurant/agents/recommendations/${rec.id}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
          return;
        }
        onStatusChange(rec.id, newStatus);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    });
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start gap-3">
          {/* Severity icon */}
          <span
            className={`inline-flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${sev.chipClass}`}
          >
            {sev.icon}
          </span>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{rec.title}</span>
              <span
                className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 font-medium ${sev.chipClass}`}
              >
                {rec.severity}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {agentName}
              </span>
              {rec.recommendation_type && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {rec.recommendation_type}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {rec.description}
            </p>
            {rec.suggested_action && (
              <p className="text-xs text-foreground/80 bg-muted/40 rounded px-2 py-1 border-l-2 border-orange-400">
                <span className="font-medium">Suggested:</span>{" "}
                {rec.suggested_action}
              </p>
            )}
            {rec.related_entity_type && (
              <p className="text-xs text-muted-foreground">
                Related: {rec.related_entity_type}
                {rec.related_entity_id ? ` (${rec.related_entity_id})` : ""}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {fmtDate(rec.created_at)}
            </p>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {rec.status === "open" && (
                <>
                  <ActionBtn
                    label="Approve"
                    onClick={() => act("approved")}
                    disabled={acting}
                    variant="green"
                  />
                  <ActionBtn
                    label="Dismiss"
                    onClick={() => act("dismissed")}
                    disabled={acting}
                    variant="muted"
                  />
                  <ActionBtn
                    label="Snooze"
                    onClick={() => act("snoozed")}
                    disabled={acting}
                    variant="muted"
                  />
                </>
              )}
              {rec.status === "approved" && (
                <>
                  <ActionBtn
                    label="Mark resolved"
                    onClick={() => act("resolved")}
                    disabled={acting}
                    variant="green"
                  />
                  <ActionBtn
                    label="Dismiss"
                    onClick={() => act("dismissed")}
                    disabled={acting}
                    variant="muted"
                  />
                </>
              )}
              {(rec.status === "dismissed" ||
                rec.status === "resolved" ||
                rec.status === "snoozed") && (
                <ActionBtn
                  label="Reopen"
                  onClick={() => act("open")}
                  disabled={acting}
                  variant="muted"
                  icon={<RotateCcw className="h-3 w-3" />}
                />
              )}
              {/* "Open" toggles the proposal panel inline. */}
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[11px] gap-1"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {expanded ? "Close" : "Open"}
                {existingActions.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    · {existingActions.length} action
                    {existingActions.length === 1 ? "" : "s"}
                  </span>
                )}
              </Button>
            </div>
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}

            {expanded && (
              <RecommendationDetailPanel
                rec={rec}
                existingActions={existingActions}
                onActionCreated={onActionCreated}
                onSwitchToActions={onSwitchToActions}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  variant,
  icon,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  variant: "green" | "muted";
  icon?: React.ReactNode;
  title?: string;
}) {
  return (
    <Button
      size="sm"
      variant={variant === "green" ? "default" : "outline"}
      className={
        "h-6 text-[11px] gap-1 " +
        (variant === "green"
          ? "bg-green-600 hover:bg-green-700 text-white border-0"
          : "")
      }
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Tab: Run History
// ---------------------------------------------------------------------------

function RunHistoryTab({
  runs,
  agentNameByKey,
}: {
  runs: AgentRun[];
  agentNameByKey: Record<string, string>;
}) {
  if (runs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
        <History className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">
          No agent runs yet
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Enable an agent and press Run to record a run.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Triggered by</th>
                <th className="px-4 py-3 font-medium text-right">Findings</th>
                <th className="px-4 py-3 font-medium text-right">Duration</th>
                <th className="px-4 py-3 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <tr
                  key={run.id}
                  className={
                    (i % 2 === 1 ? "bg-muted/20" : "bg-background") +
                    " border-b border-border last:border-0"
                  }
                >
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {fmtDate(run.started_at)}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {agentNameByKey[run.agent_key] ?? run.agent_key}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "flex items-center gap-1 text-xs font-medium " +
                        (RUN_STATUS_STYLE[run.status] ??
                          "text-muted-foreground")
                      }
                    >
                      {run.status === "running" && (
                        <Clock className="h-3.5 w-3.5 animate-pulse" />
                      )}
                      {run.status === "completed" && (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {run.status === "failed" && (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {run.status}
                    </span>
                    {run.error_message && (
                      <p
                        className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 max-w-[200px] truncate"
                        title={run.error_message}
                      >
                        {run.error_message}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground capitalize">
                    {run.triggered_by}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {run.findings_count}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                    {fmtDuration(run.started_at, run.finished_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate">
                    {run.summary ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recommendation detail panel — shows proposed actions + Create action button.
// ---------------------------------------------------------------------------

const ACTION_TYPE_LABEL: Record<string, string> = {
  open_related_record: "Open related record",
  create_setup_task: "Create setup task",
  suggest_price_change: "Suggest price change",
  draft_supplier_message: "Draft supplier message",
  review_supplier: "Review supplier",
  review_recipe: "Review recipe",
  mark_reviewed: "Mark reviewed",
};

const ACTION_STATUS_STYLE: Record<string, string> = {
  proposed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  approved:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200",
  assigned:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200",
  executed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  verified: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200",
  cancelled: "bg-muted text-muted-foreground",
};

function formatImpactValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return Number.isInteger(v) ? v.toLocaleString("es-MX") : v.toFixed(2);
  }
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ImpactGrid({ json }: { json: Record<string, unknown> }) {
  const entries = Object.entries(json ?? {}).filter(
    ([, v]) =>
      v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
  );
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded bg-muted/40 px-2 py-1">
          <div className="text-muted-foreground uppercase tracking-wide text-[9px]">
            {k.replace(/_/g, " ")}
          </div>
          <div className="font-mono break-words">{formatImpactValue(v)}</div>
        </div>
      ))}
    </div>
  );
}

function RecommendationDetailPanel({
  rec,
  existingActions,
  onActionCreated,
  onSwitchToActions,
}: {
  rec: AgentRecommendation;
  existingActions: AgentAction[];
  onActionCreated: (created: AgentAction[]) => void;
  onSwitchToActions: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<AgentActionProposal[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/restaurant/agent-actions/proposals?recommendation_id=${encodeURIComponent(rec.id)}`,
      { credentials: "include" }
    )
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
          return;
        }
        setProposals(Array.isArray(body.proposals) ? body.proposals : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rec.id]);

  const createAction = async () => {
    setError(null);
    setSuccess(null);
    setCreating(true);
    try {
      const res = await fetch("/api/restaurant/agent-actions/propose", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation_id: rec.id, create: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      const created = (body.actions ?? []) as AgentAction[];
      const skipped = (body.skipped ?? []) as { reason: string }[];
      onActionCreated(created);
      if (created.length === 0 && skipped.length > 0) {
        setError(
          `No new action created — ${skipped.map((s) => s.reason).join("; ")}`
        );
      } else {
        setSuccess(
          `Created ${created.length} action${created.length === 1 ? "" : "s"}. See the Actions tab.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3 space-y-3">
      {/* Evidence */}
      {rec.impact_json && Object.keys(rec.impact_json).length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            Evidence
          </p>
          <ImpactGrid json={rec.impact_json} />
        </div>
      )}

      {/* Existing actions for this recommendation */}
      {existingActions.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              Actions already created
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={onSwitchToActions}
            >
              Open in Actions
            </Button>
          </div>
          <ul className="space-y-1">
            {existingActions.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate">{a.title}</span>
                <span
                  className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded ${ACTION_STATUS_STYLE[a.status] ?? ""}`}
                >
                  {a.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground italic">
            Duplicates are prevented while these actions stay open.
          </p>
        </div>
      )}

      {/* Proposed actions */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            Proposed action{proposals.length === 1 ? "" : "s"}
          </p>
          {existingActions.length === 0 && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs gap-1 bg-orange-500 hover:bg-orange-600 text-white border-0"
              onClick={createAction}
              disabled={creating || proposals.length === 0}
            >
              <ListChecks className="h-3.5 w-3.5" />
              {creating ? "Creating…" : "Create action"}
            </Button>
          )}
        </div>
        {loading && (
          <p className="text-xs text-muted-foreground">Loading proposals…</p>
        )}
        {!loading && proposals.length === 0 && !error && (
          <p className="text-xs text-muted-foreground">
            No proposal available for this recommendation type.
          </p>
        )}
        <div className="space-y-2">
          {proposals.map((p, i) => {
            const targetRoute =
              typeof p.payload_json?.target_route === "string"
                ? (p.payload_json.target_route as string)
                : null;
            return (
              <div
                key={i}
                className="rounded border border-border bg-background p-2 text-xs space-y-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{p.title}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {ACTION_TYPE_LABEL[p.action_type] ?? p.action_type}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    priority: {p.priority}
                  </span>
                </div>
                {p.description && (
                  <p className="text-xs text-muted-foreground">
                    {p.description}
                  </p>
                )}
                {p.action_type === "suggest_price_change" && (
                  <PriceChangePreview
                    payload={p.payload_json ?? {}}
                    disclaimer={
                      <>
                        Execution updates Milton&apos;s internal menu price
                        only. It does not update POS, delivery platforms, or
                        printed menus.
                      </>
                    }
                  />
                )}
                {targetRoute && (
                  <Link
                    href={targetRoute}
                    className="inline-flex items-center gap-1 text-[11px] text-orange-600 dark:text-orange-300 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open {targetRoute}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        {success && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-green-700 dark:text-green-300">
              {success}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] gap-1"
              onClick={onSwitchToActions}
            >
              Go to Actions
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * State-aware disclaimer copy for the price-change preview shown on action
 * cards. The execute route stores the old/new price summary in
 * `outcome_notes`, and the executed timestamp in `executed_at`, so we can
 * surface the executed numbers without an extra round-trip to
 * agent_action_events.
 */
function priceChangeDisclaimer(action: AgentAction): React.ReactNode {
  const isExecutedLike =
    action.status === "executed" || action.status === "verified";
  if (!isExecutedLike) {
    return (
      <>
        Execution updates Milton&apos;s internal menu price only. It does not
        update POS, delivery platforms, or printed menus.
      </>
    );
  }

  // outcome_notes from the execute route looks like:
  // "Updated <name> selling_price from <old> to <new> <currency>."
  // Parse it to extract old → new and reformat with the executed_at date.
  const notes = action.outcome_notes ?? "";
  const m = notes.match(/from\s+(.+?)\s+to\s+(.+?)\s+([A-Z]{3})\./i);
  const executedAt = action.executed_at
    ? new Date(action.executed_at).toLocaleString("es-MX", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  if (m && executedAt) {
    const [, oldPrice, newPrice, currency] = m;
    return (
      <>
        Executed: Milton&apos;s internal menu price was updated from{" "}
        <span className="font-mono not-italic">{oldPrice}</span> to{" "}
        <span className="font-mono not-italic">{newPrice}</span> {currency} on{" "}
        {executedAt}.
      </>
    );
  }

  // Couldn't parse outcome_notes (older execution / missing data) — fall
  // back to the brief's generic line.
  return (
    <>
      Executed: Milton&apos;s internal menu price was updated. See action
      history for details.
    </>
  );
}

function PriceChangePreview({
  payload,
  disclaimer,
}: {
  payload: Record<string, unknown>;
  /** Optional state-aware copy rendered below the numbers grid. Callers
   *  pass the right message for the current stage (proposal vs executed).
   *  When null/undefined no disclaimer is shown. */
  disclaimer?: React.ReactNode;
}) {
  const cur = (payload.currency as string) ?? "MXN";
  const fmt = (n: unknown): string =>
    typeof n === "number" && Number.isFinite(n)
      ? new Intl.NumberFormat("es-MX", {
          style: "currency",
          currency: /^[A-Z]{3}$/.test(cur) ? cur : "MXN",
          maximumFractionDigits: 0,
        }).format(n)
      : "—";

  // Expected margin after the suggested price = (suggested_price - cost) / suggested_price
  // Only compute when we have both numbers and they're positive.
  const cost =
    typeof payload.estimated_cost === "number" &&
    Number.isFinite(payload.estimated_cost)
      ? (payload.estimated_cost as number)
      : null;
  const suggested =
    typeof payload.suggested_price === "number" &&
    Number.isFinite(payload.suggested_price)
      ? (payload.suggested_price as number)
      : null;
  const expectedMargin =
    cost !== null && suggested !== null && suggested > 0
      ? ((suggested - cost) / suggested) * 100
      : null;

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 text-[11px]">
        <div>
          <div className="text-muted-foreground">Current price</div>
          <div className="font-mono">{fmt(payload.current_price)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Est. cost</div>
          <div className="font-mono">{fmt(payload.estimated_cost)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Target margin</div>
          <div className="font-mono">
            {typeof payload.target_margin_pct === "number"
              ? `${payload.target_margin_pct}%`
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Suggested price</div>
          <div className="font-mono font-semibold">
            {fmt(payload.suggested_price)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Expected margin</div>
          <div className="font-mono">
            {expectedMargin !== null ? `${expectedMargin.toFixed(1)}%` : "—"}
          </div>
        </div>
      </div>
      {disclaimer && (
        <div className="text-[11px] italic text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1 border border-amber-200 dark:border-amber-900/40">
          {disclaimer}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Actions
// ---------------------------------------------------------------------------

const ACTION_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "proposed", label: "Proposed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "assigned", label: "Assigned" },
  { value: "executed", label: "Executed" },
  { value: "verified", label: "Verified" },
  { value: "cancelled", label: "Cancelled" },
];

function ActionsTab({
  actions,
  agentNameByKey,
  recommendationsById,
  currentUserId,
  onStatusChanged,
  onRefresh,
}: {
  actions: AgentAction[];
  agentNameByKey: Record<string, string>;
  recommendationsById: Record<string, AgentRecommendation>;
  currentUserId: string | null;
  onStatusChanged: (updated: AgentAction) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("proposed");
  const filtered =
    statusFilter === "all"
      ? actions
      : actions.filter((a) => a.status === statusFilter);
  const counts = actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {ACTION_STATUS_FILTER_OPTIONS.map((opt) => {
          const count =
            opt.value === "all" ? actions.length : (counts[opt.value] ?? 0);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={
                "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors " +
                (statusFilter === opt.value
                  ? "border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-900/20 dark:text-orange-200 dark:border-orange-700"
                  : "border-border text-muted-foreground hover:border-muted-foreground")
              }
            >
              {opt.label}
              {count > 0 && <span className="tabular-nums">{count}</span>}
            </button>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 text-xs gap-1"
          onClick={() => void onRefresh()}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
          <ListChecks className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {statusFilter === "all"
              ? "No actions yet"
              : `No ${statusFilter} actions`}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Open a recommendation and press “Create action” to populate this
            list.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              agentName={agentNameByKey[a.agent_key] ?? a.agent_key}
              sourceRecommendation={
                a.recommendation_id
                  ? (recommendationsById[a.recommendation_id] ?? null)
                  : null
              }
              currentUserId={currentUserId}
              onStatusChanged={onStatusChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  approved: "Approved",
  rejected: "Rejected",
  assigned: "Assigned",
  executed: "Marked executed",
  verified: "Marked verified",
  cancelled: "Cancelled",
  reopened: "Reopened",
  note_added: "Note added",
  payload_updated: "Payload updated",
};

interface AgentActionEventRow {
  id: string;
  event_type: string;
  user_id: string | null;
  note: string | null;
  previous_status: string | null;
  new_status: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function ActionCard({
  action,
  agentName,
  sourceRecommendation,
  currentUserId,
  onStatusChanged,
}: {
  action: AgentAction;
  agentName: string;
  sourceRecommendation: AgentRecommendation | null;
  currentUserId: string | null;
  onStatusChanged: (updated: AgentAction) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<AgentActionEventRow[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // Execute-modal state (only ever opened for executable price-change actions).
  const [executeOpen, setExecuteOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executeSuccess, setExecuteSuccess] = useState<string | null>(null);

  const targetRoute =
    typeof action.payload_json?.target_route === "string"
      ? (action.payload_json.target_route as string)
      : null;

  // Stage-3 executable detection mirrors the server-side gate.
  const isPriceChange = action.action_type === "suggest_price_change";
  const priceChangePayload = action.payload_json ?? {};
  const priceChangeMenuItemId =
    typeof priceChangePayload.menu_item_id === "string"
      ? (priceChangePayload.menu_item_id as string)
      : action.related_entity_id;
  const priceChangeSuggested =
    typeof priceChangePayload.suggested_price === "number" &&
    Number.isFinite(priceChangePayload.suggested_price as number) &&
    (priceChangePayload.suggested_price as number) > 0
      ? (priceChangePayload.suggested_price as number)
      : null;
  const isExecutablePriceChange =
    isPriceChange && !!priceChangeMenuItemId && priceChangeSuggested !== null;

  const assignedToMe =
    action.assigned_to_user_id !== null &&
    currentUserId !== null &&
    action.assigned_to_user_id === currentUserId;
  const assignedToSomeoneElse =
    action.assigned_to_user_id !== null && !assignedToMe;

  // Load events lazily when the card is expanded.
  useEffect(() => {
    if (!expanded || events !== null || eventsLoading) return;
    let cancelled = false;
    setEventsLoading(true);
    setEventsError(null);
    fetch(
      `/api/restaurant/agent-actions/${encodeURIComponent(action.id)}/events`,
      {
        credentials: "include",
      }
    )
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setEventsError(body?.error ?? `HTTP ${res.status}`);
          return;
        }
        setEvents(Array.isArray(body.events) ? body.events : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setEventsError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, events, eventsLoading, action.id]);

  const transition = async (
    next: AgentActionStatus,
    options: { reopen?: boolean; unassign?: boolean } = {}
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/agent-actions/status", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_id: action.id,
          new_status: next,
          reopen: options.reopen ?? false,
          unassign: options.unassign ?? false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body.action) {
        onStatusChanged(body.action as AgentAction);
        // Drop cached events so they reload with the new event.
        setEvents(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  const status = action.status;
  const canApprove = status === "proposed";
  const canReject = status === "proposed";
  const canAssignToMe =
    (status === "approved" || (status === "assigned" && !assignedToMe)) &&
    currentUserId !== null;
  const canUnassign =
    status === "assigned" && action.assigned_to_user_id !== null;
  const canExecute = status === "approved" || status === "assigned";
  const canVerify = status === "executed";
  const canCancel = ["proposed", "approved", "assigned"].includes(status);
  const canReopen = status === "rejected" || status === "cancelled";

  // Live price update — only ever called from the confirmation dialog.
  const executePriceUpdate = async () => {
    setExecuting(true);
    setExecuteError(null);
    setExecuteSuccess(null);
    try {
      const res = await fetch("/api/restaurant/agent-actions/execute", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: action.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.conflict === "price_drift") {
          setExecuteError(
            (body?.error as string) ??
              "Menu price changed since this action was proposed. Please review and create a new action."
          );
        } else {
          setExecuteError(body?.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      if (body.action) {
        onStatusChanged(body.action as AgentAction);
        // Drop cached events so the next expand reload shows the executed
        // event with old/new price metadata.
        setEvents(null);
      }
      const mi = body.menu_item;
      if (mi) {
        setExecuteSuccess(
          `Updated ${mi.name} from ${mi.old_price ?? "unknown"} to ${mi.new_price} ${mi.currency}.`
        );
      } else {
        setExecuteSuccess("Price updated.");
      }
      // Close after a short delay so the user sees the success line.
      setTimeout(() => setExecuteOpen(false), 1200);
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : "Network error");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-3 space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Header chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{action.title}</span>
              <span
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${ACTION_STATUS_STYLE[action.status] ?? ""}`}
              >
                {action.status}
              </span>
              <span
                className={
                  "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded " +
                  (action.priority === "critical"
                    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200"
                    : action.priority === "high"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                      : action.priority === "medium"
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
                        : "bg-muted text-muted-foreground")
                }
              >
                {action.priority}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {ACTION_TYPE_LABEL[action.action_type] ?? action.action_type}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {agentName}
              </span>
            </div>

            {action.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {action.description}
              </p>
            )}

            {action.action_type === "suggest_price_change" && (
              <PriceChangePreview
                payload={action.payload_json ?? {}}
                disclaimer={priceChangeDisclaimer(action)}
              />
            )}

            {/* Metadata row: assignee · related · due · created */}
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
              <span
                className={
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded " +
                  (assignedToMe
                    ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200"
                    : assignedToSomeoneElse
                      ? "bg-muted text-foreground/80"
                      : "")
                }
              >
                {assignedToMe
                  ? "Assigned to you"
                  : assignedToSomeoneElse
                    ? "Assigned to teammate"
                    : "Unassigned"}
              </span>
              {action.related_entity_type && (
                <span>
                  · Related: {action.related_entity_type}
                  {action.related_entity_id
                    ? ` (${action.related_entity_id})`
                    : ""}
                </span>
              )}
              {sourceRecommendation && (
                <span title={sourceRecommendation.description}>
                  · From: {sourceRecommendation.title}
                </span>
              )}
              {action.due_date && <span>· Due {action.due_date}</span>}
              <span>· Created {fmtDate(action.created_at)}</span>
            </div>

            {targetRoute && (
              <Link
                href={targetRoute}
                className="inline-flex items-center gap-1 text-[11px] text-orange-600 dark:text-orange-300 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open {targetRoute}
              </Link>
            )}

            {action.outcome_notes && (
              <p className="text-[11px] italic text-muted-foreground">
                Note: {action.outcome_notes}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {canApprove && (
                <ActionBtn
                  label="Approve"
                  onClick={() => transition("approved")}
                  disabled={busy}
                  variant="green"
                />
              )}
              {canReject && (
                <ActionBtn
                  label="Reject"
                  onClick={() => transition("rejected")}
                  disabled={busy}
                  variant="muted"
                />
              )}
              {canAssignToMe && (
                <ActionBtn
                  label="Assign to me"
                  onClick={() => transition("assigned")}
                  disabled={busy}
                  variant="muted"
                />
              )}
              {canUnassign && (
                <ActionBtn
                  label="Unassign"
                  onClick={() => transition("approved", { unassign: true })}
                  disabled={busy}
                  variant="muted"
                />
              )}
              {canExecute && isExecutablePriceChange && (
                <ActionBtn
                  label="Execute price update"
                  onClick={() => {
                    setExecuteError(null);
                    setExecuteSuccess(null);
                    setExecuteOpen(true);
                  }}
                  disabled={busy}
                  variant="green"
                />
              )}
              {canExecute && !isExecutablePriceChange && (
                <ActionBtn
                  label="Mark manually executed"
                  onClick={() => transition("executed")}
                  disabled={busy}
                  variant="muted"
                  title="Records that you completed the work outside Milton. No data is mutated."
                />
              )}
              {canVerify && (
                <ActionBtn
                  label="Mark verified"
                  onClick={() => transition("verified")}
                  disabled={busy}
                  variant="green"
                />
              )}
              {canCancel && (
                <ActionBtn
                  label="Cancel"
                  onClick={() => transition("cancelled")}
                  disabled={busy}
                  variant="muted"
                />
              )}
              {canReopen && (
                <ActionBtn
                  label="Reopen"
                  onClick={() => transition("proposed", { reopen: true })}
                  disabled={busy}
                  variant="muted"
                  icon={<RotateCcw className="h-3 w-3" />}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] gap-1 ml-auto"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {expanded ? "Hide details" : "Details"}
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground italic">
              Team assignment will be available once team management is enabled.
            </p>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}

            {/* Expanded detail: evidence + source recommendation + event timeline */}
            {expanded && (
              <div className="mt-2 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                {/* Source recommendation */}
                {sourceRecommendation && (
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                      Source recommendation
                    </p>
                    <p className="text-sm font-medium">
                      {sourceRecommendation.title}
                    </p>
                    {sourceRecommendation.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {sourceRecommendation.description}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      Severity: {sourceRecommendation.severity} · Status:{" "}
                      {sourceRecommendation.status}
                    </p>
                  </div>
                )}

                {/* Payload / impact evidence */}
                {action.payload_json &&
                  Object.keys(action.payload_json).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                        Payload
                      </p>
                      <ImpactGrid json={action.payload_json} />
                    </div>
                  )}
                {action.impact_json &&
                  Object.keys(action.impact_json).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                        Impact
                      </p>
                      <ImpactGrid json={action.impact_json} />
                    </div>
                  )}

                {/* Event timeline */}
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                    Event history
                  </p>
                  {eventsLoading && (
                    <p className="text-xs text-muted-foreground">
                      Loading history…
                    </p>
                  )}
                  {eventsError && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {eventsError}
                    </p>
                  )}
                  {events && events.length === 0 && !eventsLoading && (
                    <p className="text-xs text-muted-foreground">
                      No events recorded yet.
                    </p>
                  )}
                  {events && events.length > 0 && (
                    <ol className="space-y-1.5 border-l-2 border-border pl-3">
                      {events.map((ev) => {
                        const flags: string[] = [];
                        const md = ev.metadata ?? {};
                        if (md.reopen) flags.push("reopen");
                        if (md.unassign) flags.push("unassign");
                        return (
                          <li key={ev.id} className="text-xs">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium">
                                {EVENT_LABEL[ev.event_type] ?? ev.event_type}
                              </span>
                              {ev.previous_status && ev.new_status && (
                                <span className="text-[10px] text-muted-foreground">
                                  {ev.previous_status} → {ev.new_status}
                                </span>
                              )}
                              {flags.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  ({flags.join(", ")})
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                {fmtDate(ev.created_at)}
                              </span>
                            </div>
                            {ev.note && (
                              <p className="text-[11px] text-muted-foreground italic mt-0.5">
                                “{ev.note}”
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>

      {/* Execute-price-update confirmation modal — only mounted for executable
          price-change actions, so non-price actions never see this dialog. */}
      {isExecutablePriceChange && (
        <ExecutePriceUpdateDialog
          open={executeOpen}
          onOpenChange={(v) => {
            // Block closing while the request is in flight to prevent the
            // user accidentally double-clicking Execute.
            if (executing) return;
            setExecuteOpen(v);
          }}
          payload={action.payload_json ?? {}}
          itemName={
            action.title.replace(/^Review price for\s+/i, "").trim() || null
          }
          executing={executing}
          error={executeError}
          success={executeSuccess}
          onConfirm={executePriceUpdate}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Execute-price-update confirmation dialog
// ---------------------------------------------------------------------------

function ExecutePriceUpdateDialog({
  open,
  onOpenChange,
  payload,
  itemName: itemNameProp,
  executing,
  error,
  success,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payload: Record<string, unknown>;
  itemName: string | null;
  executing: boolean;
  error: string | null;
  success: string | null;
  onConfirm: () => void;
}) {
  const currency =
    typeof payload.currency === "string" ? (payload.currency as string) : "MXN";
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "MXN";
  const fmt = (n: unknown): string =>
    typeof n === "number" && Number.isFinite(n)
      ? new Intl.NumberFormat("es-MX", {
          style: "currency",
          currency: safeCurrency,
          maximumFractionDigits: 2,
        }).format(n)
      : "—";

  const cost =
    typeof payload.estimated_cost === "number" &&
    Number.isFinite(payload.estimated_cost)
      ? (payload.estimated_cost as number)
      : null;
  const suggested =
    typeof payload.suggested_price === "number" &&
    Number.isFinite(payload.suggested_price)
      ? (payload.suggested_price as number)
      : null;
  const expectedMargin =
    cost !== null && suggested !== null && suggested > 0
      ? ((suggested - cost) / suggested) * 100
      : null;

  // The recommendation runner doesn't always put the dish name in the
  // payload, so the parent passes a name parsed from the action title.
  const itemName =
    itemNameProp ||
    (typeof payload.menu_item_name === "string"
      ? (payload.menu_item_name as string)
      : "this menu item");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Execute price update</DialogTitle>
          <DialogDescription>
            Updating Milton&apos;s internal price for{" "}
            <span className="font-medium text-foreground">{itemName}</span>.
            Review the numbers before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Numbers */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-muted/40 px-2 py-1.5">
              <div className="text-muted-foreground uppercase tracking-wide text-[9px]">
                Current internal price
              </div>
              <div className="font-mono text-sm">
                {fmt(payload.current_price)}
              </div>
            </div>
            <div className="rounded bg-orange-50 dark:bg-orange-900/20 px-2 py-1.5">
              <div className="text-muted-foreground uppercase tracking-wide text-[9px]">
                New price
              </div>
              <div className="font-mono text-sm font-semibold text-orange-700 dark:text-orange-300">
                {fmt(payload.suggested_price)}
              </div>
            </div>
            <div className="rounded bg-muted/40 px-2 py-1.5">
              <div className="text-muted-foreground uppercase tracking-wide text-[9px]">
                Estimated cost
              </div>
              <div className="font-mono text-sm">
                {fmt(payload.estimated_cost)}
              </div>
            </div>
            <div className="rounded bg-muted/40 px-2 py-1.5">
              <div className="text-muted-foreground uppercase tracking-wide text-[9px]">
                Target margin
              </div>
              <div className="font-mono text-sm">
                {typeof payload.target_margin_pct === "number"
                  ? `${payload.target_margin_pct}%`
                  : "—"}
              </div>
            </div>
            <div className="col-span-2 rounded bg-muted/40 px-2 py-1.5">
              <div className="text-muted-foreground uppercase tracking-wide text-[9px]">
                Expected margin after change
              </div>
              <div className="font-mono text-sm">
                {expectedMargin !== null
                  ? `${expectedMargin.toFixed(1)}%`
                  : "—"}
              </div>
            </div>
          </div>

          {/* Scope warning */}
          <div className="rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              This updates Milton&apos;s internal menu item price only. It does
              not update your POS, printed menu, or delivery platforms.
            </span>
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          {success && (
            <p className="text-xs text-green-700 dark:text-green-300">
              {success}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={executing}
          >
            Cancel
          </Button>
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white border-0"
            onClick={onConfirm}
            disabled={executing || success !== null}
          >
            {executing ? "Updating…" : success ? "Updated" : "Confirm update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
