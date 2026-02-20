"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Archive, Trash2, Lightbulb } from "lucide-react";
import { ScenarioCard } from "@/components/dashboard/scenarios/ScenarioCard";
import { EmptyState } from "@/components/dashboard/scenarios/EmptyState";
import { DeleteScenarioDialog } from "@/components/dashboard/scenarios/DeleteScenarioDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Scenario } from "@/lib/types/scenario";
import { mapRowToScenario } from "@/lib/types/scenario";
import type { PlanningScenarioRow } from "@/lib/types/scenario";

type FilterType = "all" | "active" | "archived" | "growing" | "revenue-focus";

export default function ScenariosPage() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);

  const fetchScenarios = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scenarios", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScenarios([]);
        return;
      }
      const raw = data.scenarios ?? data;
      const mapped = Array.isArray(raw)
        ? raw.map((r: PlanningScenarioRow) => mapRowToScenario(r))
        : [];
      setScenarios(mapped);
    } catch {
      setScenarios([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  const filteredScenarios = useMemo(() => {
    return scenarios.filter((scenario) => {
      const matchesSearch = scenario.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

      let matchesFilter = true;
      if (activeFilter === "active") {
        matchesFilter = scenario.tags?.includes("active") ?? false;
      } else if (activeFilter === "archived") {
        matchesFilter = scenario.tags?.includes("archived") ?? false;
      } else if (activeFilter === "growing") {
        matchesFilter = scenario.tags?.includes("growing") ?? false;
      } else if (activeFilter === "revenue-focus") {
        matchesFilter = scenario.tags?.includes("revenue-focus") ?? false;
      }

      return matchesSearch && matchesFilter;
    });
  }, [scenarios, searchQuery, activeFilter]);

  const handleSelectAll = () => {
    if (selectedIds.size === filteredScenarios.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredScenarios.map((s) => s.id)));
    }
  };

  const handleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleCreateScenario = async () => {
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: "New Scenario",
          status: "Draft",
          tags: ["active"],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create");
      const row = data.scenario as PlanningScenarioRow;
      if (row?.id) {
        router.push(`/dashboard/scenarios/${row.id}/edit`);
      } else {
        fetchScenarios();
      }
    } catch (err) {
      console.error("Create scenario error:", err);
      fetchScenarios();
    }
  };

  const handleEdit = (id: string) => {
    router.push(`/dashboard/scenarios/${id}/edit`);
  };

  const handleDuplicate = async (id: string) => {
    try {
      const getRes = await fetch(`/api/scenarios/${id}`, {
        credentials: "include",
      });
      const getData = await getRes.json().catch(() => ({}));
      if (!getRes.ok || !getData.scenario) {
        fetchScenarios();
        return;
      }
      const existing = getData.scenario as PlanningScenarioRow;
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: `${existing.name} (Copy)`,
          status: "Draft",
          tags: existing.tags ?? ["active"],
          driver_overrides: existing.driver_overrides ?? [],
        }),
      });
      if (res.ok) fetchScenarios();
    } catch {
      fetchScenarios();
    }
  };

  const handleDeleteClick = (ids: string[]) => {
    setPendingDeleteIds(ids);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    for (const id of pendingDeleteIds) {
      await fetch(`/api/scenarios/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
    }
    setSelectedIds(new Set());
    setDeleteDialogOpen(false);
    setPendingDeleteIds([]);
    fetchScenarios();
  };

  const handleBulkArchive = async () => {
    for (const id of selectedIds) {
      const scenario = scenarios.find((s) => s.id === id);
      if (!scenario) continue;
      const newTags = [
        ...(scenario.tags?.filter((t) => t !== "active") ?? []),
        "archived",
      ];
      await fetch(`/api/scenarios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tags: newTags }),
      });
    }
    setSelectedIds(new Set());
    fetchScenarios();
  };

  const handleScenarioClick = (id: string) => {
    router.push(`/dashboard/scenarios/${id}`);
  };

  const filters: { label: string; value: FilterType }[] = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },
    { label: "Archived", value: "archived" },
    { label: "Growing", value: "growing" },
    { label: "Revenue Focus", value: "revenue-focus" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading scenarios…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-foreground">Scenarios</h1>
            <Button onClick={handleCreateScenario} className="gap-2">
              <Plus className="h-5 w-5" />
              New Scenario
            </Button>
          </div>

          {/* Search and Filters */}
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search scenarios…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {filters.map((filter) => (
                <Button
                  key={filter.value}
                  variant={
                    activeFilter === filter.value ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setActiveFilter(filter.value)}
                  className="whitespace-nowrap"
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <div className="mb-4 p-4 bg-primary/5 border border-primary/20 rounded-lg flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-foreground">
                {selectedIds.size} selected
              </span>
              <button
                onClick={handleSelectAll}
                className="text-sm text-primary hover:underline"
              >
                {selectedIds.size === filteredScenarios.length
                  ? "Deselect all"
                  : "Select all"}
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkArchive}
                className="gap-2"
              >
                <Archive className="h-4 w-4" />
                Archive
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDeleteClick(Array.from(selectedIds))}
                className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        )}

        {/* Scenarios List */}
        {filteredScenarios.length === 0 && scenarios.length === 0 ? (
          <EmptyState onCreateScenario={handleCreateScenario} />
        ) : filteredScenarios.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No scenarios match your search or filter
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredScenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                isSelected={selectedIds.has(scenario.id)}
                onSelect={handleSelect}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={(id) => handleDeleteClick([id])}
                onClick={handleScenarioClick}
              />
            ))}
          </div>
        )}

        {/* Info Footer */}
        {filteredScenarios.length > 0 && (
          <div className="mt-8 p-4 bg-primary/5 border border-primary/10 rounded-lg flex items-start gap-3">
            <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Create multiple
              versions of your baseline forecast to explore different financial
              outcomes and plan ahead.
            </p>
          </div>
        )}
      </div>

      <DeleteScenarioDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        itemCount={pendingDeleteIds.length}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
