"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AVAILABLE_TOOLS,
  CATEGORY_LABELS,
  DataSourceCategory,
  hasAvailableIntegrations,
} from "@/lib/data-source-tools";
import { upsertUserDataSources } from "@/lib/data-source-service";
import {
  Database,
  CreditCard,
  Users,
  Calculator,
  Receipt,
  Briefcase,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  Upload,
  AlertCircle,
} from "lucide-react";
import { updateOnboardingStatus } from "@/lib/onboarding-status";
import { Separator } from "@/components/ui/separator";

const CATEGORY_ICONS: Record<DataSourceCategory, React.ReactNode> = {
  online_banking: <CreditCard className="h-4 w-4" />,
  crm: <Users className="h-4 w-4" />,
  accounting: <Calculator className="h-4 w-4" />,
  expense_management: <Receipt className="h-4 w-4" />,
  hr: <Briefcase className="h-4 w-4" />,
  cms: <FileText className="h-4 w-4" />,
  g_docs: <FileSpreadsheet className="h-4 w-4" />,
};

interface DataSourceSelectionStepProps {
  onComplete: () => void;
}

export function DataSourceSelectionStep({
  onComplete,
}: DataSourceSelectionStepProps) {
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggleTool = (category: DataSourceCategory, toolId: string) => {
    const key = `${category}:${toolId}`;
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Also clear other text if unchecking "other"
        if (toolId === "other") {
          setOtherTexts((prevTexts) => {
            const newTexts = { ...prevTexts };
            delete newTexts[category];
            return newTexts;
          });
        }
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleContinue = async () => {
    if (selectedTools.size === 0) {
      setError("Please select at least one data source to continue.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const selections: Array<{
        category: DataSourceCategory;
        toolName: string;
        otherText?: string;
      }> = [];

      selectedTools.forEach((key) => {
        const [category, toolName] = key.split(":");
        if (toolName === "other" && otherTexts[category]) {
          selections.push({
            category: category as DataSourceCategory,
            toolName: "other",
            otherText: otherTexts[category],
          });
        } else if (toolName !== "other") {
          selections.push({
            category: category as DataSourceCategory,
            toolName,
          });
        }
      });

      await upsertUserDataSources(selections);
      await updateOnboardingStatus("upload");
      onComplete();
    } catch (err) {
      setError("Failed to save data sources. Please try again.");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const toolsByCategory = AVAILABLE_TOOLS.reduce(
    (acc, tool) => {
      if (!acc[tool.category]) acc[tool.category] = [];
      acc[tool.category].push(tool);
      return acc;
    },
    {} as Record<DataSourceCategory, typeof AVAILABLE_TOOLS>
  );

  const selectedToolIds = Array.from(selectedTools)
    .map((key) => {
      const [, toolId] = key.split(":");
      return toolId;
    })
    .filter((id) => id !== "other");

  const hasIntegrations = hasAvailableIntegrations(selectedToolIds);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Declare Your Data Sources</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tell us which tools or systems you use to track your data. We'll show
          you available integrations or guide you to upload files manually.
        </p>
      </div>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        {Object.entries(toolsByCategory).map(([category, tools]) => (
          <Card key={category}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {CATEGORY_ICONS[category as DataSourceCategory]}
                {CATEGORY_LABELS[category as DataSourceCategory]}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tools.map((tool) => {
                const key = `${tool.category}:${tool.id}`;
                const isSelected = selectedTools.has(key);
                const isDisabled = tool.id !== "sheets_excel";

                if (isDisabled) {
                  return (
                    <div key={tool.id} className="flex items-center space-x-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Checkbox
                              id={key}
                              checked={isSelected}
                              disabled={isDisabled}
                              onCheckedChange={() =>
                                toggleTool(tool.category, tool.id)
                              }
                            />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start">
                          <p>We don&apos;t support this integration yet</p>
                        </TooltipContent>
                      </Tooltip>
                      <Label
                        htmlFor={key}
                        className="cursor-not-allowed opacity-50 font-normal flex-1"
                      >
                        {tool.name}
                      </Label>
                      {tool.hasIntegration && (
                        <Badge variant="outline" className="text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Integration Available
                        </Badge>
                      )}
                    </div>
                  );
                }

                return (
                  <div key={tool.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={key}
                      checked={isSelected}
                      disabled={isDisabled}
                      onCheckedChange={() => toggleTool(tool.category, tool.id)}
                    />
                    <Label
                      htmlFor={key}
                      className="cursor-pointer font-normal flex-1"
                    >
                      {tool.name}
                    </Label>
                    {tool.hasIntegration && (
                      <Badge variant="outline" className="text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Integration Available
                      </Badge>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center space-x-2 cursor-not-allowed opacity-50">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Checkbox
                        id={`${category}:other`}
                        checked={selectedTools.has(`${category}:other`)}
                        disabled
                        onCheckedChange={() =>
                          toggleTool(category as DataSourceCategory, "other")
                        }
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start">
                    <p>We don&apos;t support this integration yet</p>
                  </TooltipContent>
                </Tooltip>
                <Label
                  htmlFor={`${category}:other`}
                  className="cursor-not-allowed font-normal"
                >
                  Other
                </Label>
              </div>
              {selectedTools.has(`${category}:other`) && (
                <Input
                  placeholder="Please specify..."
                  value={otherTexts[category] || ""}
                  onChange={(e) =>
                    setOtherTexts((prev) => ({
                      ...prev,
                      [category]: e.target.value,
                    }))
                  }
                  className="ml-2 max-w-xs"
                  disabled
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Integration Status Banner */}
      {selectedTools.size > 0 && (
        <Card
          className={
            hasIntegrations
              ? "bg-blue-50 border-blue-200"
              : "bg-amber-50 border-amber-200"
          }
        >
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              {hasIntegrations ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-blue-900">
                      Integrations Available
                    </p>
                    <p className="text-sm text-blue-700 mt-1">
                      We have integrations available for some of your selected
                      tools. You'll be able to connect them after this step.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-amber-900">
                      Manual Upload Required
                    </p>
                    <p className="text-sm text-amber-700 mt-1">
                      No integrations are currently available for your selected
                      tools. You can upload files manually below, or skip and
                      upload later.
                    </p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Optional File Upload Section */}
      <div className="space-y-4">
        <Separator />
        <div>
          <h2 className="text-lg font-semibold mb-2">
            Upload Data Files (Optional)
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            You can upload your data files later in the Data Model Builder.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleContinue}
          disabled={saving || selectedTools.size === 0}
          size="lg"
        >
          {saving ? "Saving..." : "Continue to Data Model"}
        </Button>
      </div>
    </div>
  );
}
