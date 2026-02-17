// components/dashboard/reports/ReportSection.tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

interface ReportCard {
  id: string;
  label: string;
  enabled: boolean;
  blocked?: boolean;
}

interface ReportChart {
  id: string;
  label: string;
  enabled: boolean;
  blocked?: boolean;
}

interface ReportSectionProps {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  cards: ReportCard[];
  charts: ReportChart[];
  onToggleSection: (enabled: boolean) => void;
  onToggleCard: (cardId: string, enabled: boolean) => void;
  onToggleChart: (chartId: string, enabled: boolean) => void;
  slideNumber?: number;
}

export function ReportSection({
  id,
  title,
  description,
  enabled,
  cards,
  charts,
  onToggleSection,
  onToggleCard,
  onToggleChart,
  slideNumber,
}: ReportSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const hasBlockedItems =
    cards.some((c) => c.blocked) || charts.some((c) => c.blocked);

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <Checkbox
              id={`section-${id}`}
              checked={enabled}
              onCheckedChange={(checked) => onToggleSection(checked === true)}
              className="h-5 w-5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor={`section-${id}`}
                  className="text-base font-semibold cursor-pointer"
                >
                  {title}
                </Label>
                {hasBlockedItems && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Some items blocked
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-muted rounded"
          >
            {isExpanded ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </button>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent className="pt-0 space-y-4">
          {cards.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">
                KPIs
              </Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
                  >
                    <Checkbox
                      id={`card-${id}-${card.id}`}
                      checked={card.enabled && enabled}
                      disabled={!enabled || card.blocked}
                      onCheckedChange={(checked) =>
                        onToggleCard(card.id, checked === true)
                      }
                    />
                    <Label
                      htmlFor={`card-${id}-${card.id}`}
                      className={`text-sm cursor-pointer flex-1 ${
                        !enabled || card.blocked ? "text-muted-foreground" : ""
                      }`}
                    >
                      {card.label}
                    </Label>
                    {card.blocked && (
                      <Badge variant="outline" className="text-xs">
                        Blocked
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {charts.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Charts
              </Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {charts.map((chart) => (
                  <div
                    key={chart.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
                  >
                    <Checkbox
                      id={`chart-${id}-${chart.id}`}
                      checked={chart.enabled && enabled}
                      disabled={!enabled || chart.blocked}
                      onCheckedChange={(checked) =>
                        onToggleChart(chart.id, checked === true)
                      }
                    />
                    <Label
                      htmlFor={`chart-${id}-${chart.id}`}
                      className={`text-sm cursor-pointer flex-1 ${
                        !enabled || chart.blocked ? "text-muted-foreground" : ""
                      }`}
                    >
                      {chart.label}
                    </Label>
                    {chart.blocked && (
                      <Badge variant="outline" className="text-xs">
                        Blocked
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
