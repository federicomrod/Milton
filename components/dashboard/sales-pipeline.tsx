// components/dashboard/sales-pipeline.tsx
"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { usePipelineData } from "@/lib/hooks/usePipelineData";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import type {
  FormatStyle,
  PhaseColors,
  ColorPalette,
} from "@/lib/utils/pipeline-utils";
import {
  DEFAULT_PHASE_COLORS,
  COLOR_PALETTES,
  generateCorporateColors,
} from "@/lib/utils/pipeline-utils";
import { SalesFunnelChart } from "@/components/dashboard/pipeline/SalesFunnelChart";
import { PipelineByPhaseChart } from "@/components/dashboard/pipeline/PipelineByPhaseChart";
import { PipelineForecastChart } from "@/components/dashboard/pipeline/PipelineForecastChart";
import { DealsByProductChart } from "@/components/dashboard/pipeline/DealsByProductChart";
import { PipelineSummaryCards } from "@/components/dashboard/pipeline/PipelineSummaryCards";
import { TopDealsList } from "@/components/dashboard/pipeline/TopDealsList";
import { ColorPaletteDialog } from "@/components/dashboard/pipeline/ColorPaletteDialog";

export type PipelineDateRangePeriod = "month" | "year" | "ytd" | "custom";

export interface SalesPipelineProps {
  period?: PipelineDateRangePeriod;
  customDateRange?: { from: string; to: string };
  onPeriodChange?: (period: PipelineDateRangePeriod) => void;
  onCustomDateRangeChange?: (range: { from: string; to: string }) => void;
}

export function SalesPipeline({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: SalesPipelineProps = {}) {
  const { prefs } = useUserPreferences();

  const dateRange = useMemo(() => {
    if (!period && !customDateRange) return undefined;
    const now = new Date();
    const format = (d: Date) => d.toISOString().split("T")[0];
    if (period === "custom" && customDateRange?.from && customDateRange?.to)
      return { from: customDateRange.from, to: customDateRange.to };
    if (period === "year") {
      const from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
      return { from: format(from), to: format(now) };
    }
    if (period === "ytd") {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from: format(from), to: format(now) };
    }
    // month: last 90 days (same default as date picker for all business models)
    const from = new Date(now);
    from.setDate(from.getDate() - 90);
    return { from: format(from), to: format(now) };
  }, [period, customDateRange]);

  const { deals, allDeals, loading, metrics, totalRevenue } =
    usePipelineData(dateRange);
  const [colorMode, setColorMode] = useState<"individual" | "corporate">(
    "individual"
  );
  const [corporateColor, setCorporateColor] = useState("#3b82f6");
  const [isColorDialogOpen, setIsColorDialogOpen] = useState(false);
  const [phaseColors, setPhaseColors] =
    useState<PhaseColors>(DEFAULT_PHASE_COLORS);
  const [formatStyle, setFormatStyle] = useState<FormatStyle>("short");

  const getCurrentColors = (): PhaseColors => {
    if (colorMode === "corporate") {
      return generateCorporateColors(corporateColor);
    }
    return phaseColors;
  };

  const applyColorPalette = (palette: ColorPalette) => {
    setPhaseColors(palette.colors);
    setColorMode("individual");
    setIsColorDialogOpen(false);
  };

  const applyCorporateColor = (color: string) => {
    setCorporateColor(color);
    setColorMode("corporate");
    setIsColorDialogOpen(false);
  };

  const resetToDefault = () => {
    setPhaseColors(COLOR_PALETTES[0].colors);
    setColorMode("individual");
    setCorporateColor("#3b82f6");
  };

  const currentColors = getCurrentColors();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Loading pipeline data...
          </p>
        </div>
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sales Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">
              No CRM data available. Please upload your CRM file.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Date Range (when controlled) and Color Selector */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h2 className="text-2xl font-bold">Sales Pipeline</h2>
        <div className="flex items-center gap-2">
          {period != null &&
            customDateRange != null &&
            onPeriodChange &&
            onCustomDateRangeChange && (
              <DateRangePicker
                period={period}
                customDateRange={customDateRange}
                onPeriodChange={onPeriodChange}
                onCustomDateRangeChange={onCustomDateRangeChange}
              />
            )}
          <ColorPaletteDialog
            isOpen={isColorDialogOpen}
            onOpenChange={setIsColorDialogOpen}
            currentColors={currentColors}
            colorMode={colorMode}
            corporateColor={corporateColor}
            onApplyPalette={applyColorPalette}
            onApplyCorporateColor={applyCorporateColor}
            onReset={resetToDefault}
          />
        </div>
      </div>

      {/* Currency Format Dropdown */}
      <div className="flex justify-end mb-2">
        <label className="mr-2 text-sm text-muted-foreground">
          Amount Format:
        </label>
        <select
          value={formatStyle}
          onChange={(e) => setFormatStyle(e.target.value as FormatStyle)}
          className="text-sm border border-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="short">€1.2k</option>
          <option value="swiss">€1&apos;000</option>
          <option value="mio">€1.2 Mio</option>
        </select>
      </div>

      {/* Summary Cards */}
      <PipelineSummaryCards
        metrics={metrics}
        totalRevenue={totalRevenue}
        currency={prefs.currency}
        numberFormat={prefs.number_format}
      />

      {/* Sales Funnel */}
      <SalesFunnelChart
        funnelData={metrics.funnelData}
        colors={currentColors}
        currency={prefs.currency}
        formatStyle={formatStyle}
      />

      {/* Pipeline Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <PipelineByPhaseChart
          data={metrics.pipelineByPhase}
          colors={currentColors}
          currency={prefs.currency}
          formatStyle={formatStyle}
          title="Pipeline Value by Phase"
          dataKey="value"
        />
        <PipelineByPhaseChart
          data={metrics.pipelineByPhase}
          colors={currentColors}
          currency={prefs.currency}
          formatStyle={formatStyle}
          title="Deal Count by Phase"
          dataKey="count"
        />
      </div>

      {/* Pipeline Forecast */}
      <PipelineForecastChart
        data={metrics.pipelineForecast}
        colors={currentColors}
        currency={prefs.currency}
        formatStyle={formatStyle}
      />

      {/* Bottom Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <DealsByProductChart
          data={metrics.dealsByProduct}
          colors={currentColors}
          currency={prefs.currency}
          formatStyle={formatStyle}
        />
        <TopDealsList
          topDeals={metrics.topDeals}
          colors={currentColors}
          currency={prefs.currency}
          formatStyle={formatStyle}
        />
      </div>
    </div>
  );
}
