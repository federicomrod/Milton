"use client";

import { Pencil, Copy, Trash2, EllipsisVertical } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { Scenario } from "@/lib/types/scenario";
import { cn } from "@/lib/utils";

interface ScenarioCardProps {
  scenario: Scenario;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
}

const statusStyles: Record<Scenario["status"], string> = {
  Draft: "bg-muted text-muted-foreground border-border",
  Projected: "bg-primary/10 text-primary border-primary/30",
  Ready:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};

export function ScenarioCard({
  scenario,
  isSelected,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onClick,
}: ScenarioCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group relative flex items-center gap-4 p-4 bg-card border border-border rounded-lg hover:border-primary/30 hover:shadow-sm transition-all">
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onSelect(scenario.id)}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      />

      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onClick(scenario.id)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-foreground truncate">
              {scenario.name}
            </h3>
            <p className="text-muted-foreground text-sm mt-1">
              Created {scenario.createdDate}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={cn(
                "px-3 py-1 rounded-full text-sm font-medium border",
                statusStyles[scenario.status]
              )}
            >
              {scenario.status}
            </span>

            {/* Quick Actions - hidden on mobile, shown on hover */}
            <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(scenario.id);
                }}
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(scenario.id);
                }}
                title="Duplicate"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(scenario.id);
                }}
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* More Menu (Mobile fallback) */}
            <div className="relative md:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
              >
                <EllipsisVertical className="h-4 w-4" />
              </Button>

              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg py-1 z-20">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onEdit(scenario.id);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-accent flex items-center gap-2"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onDuplicate(scenario.id);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-accent flex items-center gap-2"
                    >
                      <Copy className="h-4 w-4" />
                      Duplicate
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onDelete(scenario.id);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
