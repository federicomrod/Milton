// components/dashboard/pipeline/ColorPaletteDialog.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Palette, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { PhaseColors, ColorPalette } from "@/lib/utils/pipeline-utils";
import {
  COLOR_PALETTES,
  CORPORATE_COLOR_PALETTES,
  DEFAULT_PHASE_COLORS,
  generateCorporateColors,
} from "@/lib/utils/pipeline-utils";

interface ColorPaletteDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentColors: PhaseColors;
  colorMode: "individual" | "corporate";
  corporateColor: string;
  onApplyPalette: (palette: ColorPalette) => void;
  onApplyCorporateColor: (color: string) => void;
  onReset: () => void;
}

export function ColorPaletteDialog({
  isOpen,
  onOpenChange,
  currentColors,
  colorMode,
  corporateColor,
  onApplyPalette,
  onApplyCorporateColor,
  onReset,
}: ColorPaletteDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Palette className="h-4 w-4" />
          Customize Colors
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pipeline Color Settings</DialogTitle>
          <DialogDescription>
            Choose colors for your sales pipeline phases
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Current Color Preview */}
          <div>
            <h4 className="font-medium mb-3">Current Colors</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(currentColors).map(([phase, color]) => (
                <Badge
                  key={phase}
                  className="flex items-center gap-2"
                  style={{ backgroundColor: color, color: "#000" }}
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color }}
                  ></div>
                  {phase}
                </Badge>
              ))}
            </div>
          </div>

          {/* Corporate Colors */}
          <div>
            <h4 className="font-medium mb-3">
              Corporate Branding (Single Color)
            </h4>
            <div className="grid grid-cols-4 gap-2">
              {CORPORATE_COLOR_PALETTES.map((palette) => (
                <Button
                  key={palette.name}
                  variant="outline"
                  className="h-12 flex flex-col gap-1"
                  onClick={() => onApplyCorporateColor(palette.color)}
                  style={{
                    backgroundColor:
                      colorMode === "corporate" &&
                      corporateColor === palette.color
                        ? palette.color + "20"
                        : "transparent",
                  }}
                >
                  <div
                    className="w-6 h-6 rounded"
                    style={{ backgroundColor: palette.color }}
                  ></div>
                  <span className="text-xs">{palette.name}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Predefined Palettes */}
          <div>
            <h4 className="font-medium mb-3">Predefined Palettes</h4>
            <div className="space-y-3">
              {COLOR_PALETTES.map((palette) => (
                <div key={palette.name} className="border rounded p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium">{palette.name}</span>
                    <Button size="sm" onClick={() => onApplyPalette(palette)}>
                      Apply
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    {Object.entries(palette.colors).map(([phase, color]) => (
                      <div
                        key={phase}
                        className="w-8 h-8 rounded"
                        style={{ backgroundColor: color }}
                        title={phase}
                      ></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={onReset} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Reset to Default
            </Button>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
