// components/dashboard/sales-pipeline.tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function SalesPipeline() {
  const { prefs } = useUserPreferences();
  const { deals, allDeals, loading, metrics } = usePipelineData();
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
      <Card>
        <CardHeader>
          <CardTitle>Sales Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">Loading pipeline data...</p>
          </div>
        </CardContent>
      </Card>
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
            <p className="text-gray-500">
              No CRM data available. Please upload your CRM file.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Color Selector */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Sales Pipeline</h2>
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

      {/* Currency Format Dropdown */}
      <div className="flex justify-end mb-2">
        <label className="mr-2 text-sm text-gray-600">Amount Format:</label>
        <select
          value={formatStyle}
          onChange={(e) => setFormatStyle(e.target.value as FormatStyle)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="short">€1.2k</option>
          <option value="swiss">€1&apos;000</option>
          <option value="mio">€1.2 Mio</option>
        </select>
      </div>

      {/* Summary Cards */}
      <PipelineSummaryCards
        allDeals={allDeals}
        metrics={metrics}
        currency={prefs.currency}
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
