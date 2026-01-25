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
  AVAILABLE_TOOLS,
  CATEGORY_LABELS,
  DataSourceCategory,
  hasAvailableIntegrations,
} from "@/lib/data-source-tools";
import {
  getUserDataSources,
  upsertUserDataSources,
  deleteUserDataSource,
  UserDataSource,
} from "@/lib/data-source-service";
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
  AlertCircle,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import ModelTableListView from "@/components/dashboard/ModelTableListView";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { ModelProposal } from "@/lib/model/transform";
import { useRef } from "react";

const CATEGORY_ICONS: Record<DataSourceCategory, React.ReactNode> = {
  online_banking: <CreditCard className="h-4 w-4" />,
  crm: <Users className="h-4 w-4" />,
  accounting: <Calculator className="h-4 w-4" />,
  expense_management: <Receipt className="h-4 w-4" />,
  hr: <Briefcase className="h-4 w-4" />,
  cms: <FileText className="h-4 w-4" />,
  g_docs: <FileSpreadsheet className="h-4 w-4" />,
};

export default function DataManagementPage() {
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [initialSelectedTools, setInitialSelectedTools] = useState<Set<string>>(
    new Set()
  );
  const [initialOtherTexts, setInitialOtherTexts] = useState<
    Record<string, string>
  >({});
  const [existingSources, setExistingSources] = useState<UserDataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isDeclaredDataSourcesExpanded, setIsDeclaredDataSourcesExpanded] =
    useState(false);
  const [model, setModel] = useState<ModelProposal | null>(null);

  useEffect(() => {
    loadDataSources();
  }, []);

  // Load model from business_models
  useEffect(() => {
    const loadModel = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (company) {
          const { data } = await supabase
            .from("business_models")
            .select("canonical_model")
            .eq("company_id", company.id)
            .single();

          if (data?.canonical_model) {
            setModel(data.canonical_model as ModelProposal);
          }
        }
      } catch (error) {
        console.error("[DataManagement] Error loading model:", error);
      }
    };
    loadModel();
  }, []);

  const loadDataSources = async () => {
    try {
      setLoading(true);
      const sources = await getUserDataSources();
      setExistingSources(sources);

      const tools = new Set(
        sources.map(
          (s) =>
            `${s.category}:${s.tool_name === "other" ? "other" : s.tool_name}`
        )
      );
      const others: Record<string, string> = {};
      sources.forEach((s) => {
        if (s.tool_name === "other" && s.other_text) {
          others[s.category] = s.other_text;
        }
      });
      setSelectedTools(tools);
      setOtherTexts(others);
      // Store initial state for comparison
      setInitialSelectedTools(new Set(tools));
      setInitialOtherTexts({ ...others });
    } catch (error) {
      console.error("Failed to load data sources:", error);
      setMessage({ type: "error", text: "Failed to load data sources." });
    } finally {
      setLoading(false);
    }
  };

  const toggleTool = (category: DataSourceCategory, toolId: string) => {
    const key = `${category}:${toolId}`;
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
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

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

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
      await loadDataSources();
      setMessage({ type: "success", text: "Data sources saved successfully!" });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({
        type: "error",
        text: "Failed to save data sources. Please try again.",
      });
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    sourceId: string | null;
  }>({ open: false, sourceId: null });

  const handleDeleteClick = (sourceId: string) => {
    setConfirmDialog({ open: true, sourceId });
  };

  const handleDeleteSource = async () => {
    if (!confirmDialog.sourceId) return;

    try {
      await deleteUserDataSource(confirmDialog.sourceId);
      await loadDataSources();
      setMessage({
        type: "success",
        text: "Data source removed successfully!",
      });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: "error", text: "Failed to remove data source." });
      console.error(error);
    } finally {
      setConfirmDialog({ open: false, sourceId: null });
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

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

  // Check if there are any changes from the initial state
  const hasChanges =
    selectedTools.size !== initialSelectedTools.size ||
    Array.from(selectedTools).some((key) => !initialSelectedTools.has(key)) ||
    Array.from(initialSelectedTools).some((key) => !selectedTools.has(key)) ||
    JSON.stringify(otherTexts) !== JSON.stringify(initialOtherTexts);

  const getToolName = (category: string, toolName: string): string => {
    if (toolName === "other") {
      const source = existingSources.find(
        (s) => s.category === category && s.tool_name === "other"
      );
      return source?.other_text || "Other";
    }
    const tool = AVAILABLE_TOOLS.find(
      (t) => t.id === toolName && t.category === category
    );
    return tool?.name || toolName;
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground">Data Management</h1>
        <p className="text-muted-foreground mt-1">
          Manage your data sources and declare which tools or systems you use to
          track your data
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                <CardTitle>Declared Data Sources</CardTitle>
              </div>
              <button
                onClick={() =>
                  setIsDeclaredDataSourcesExpanded(
                    !isDeclaredDataSourcesExpanded
                  )
                }
                className="p-1 hover:bg-muted rounded-md transition-colors"
                aria-label={
                  isDeclaredDataSourcesExpanded ? "Collapse" : "Expand"
                }
              >
                {isDeclaredDataSourcesExpanded ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </button>
            </div>
            {isDeclaredDataSourcesExpanded && (
              <CardDescription>
                Select which tools or systems you use to track your data. This
                helps us understand your data structure.
              </CardDescription>
            )}
          </CardHeader>
          {isDeclaredDataSourcesExpanded && (
            <CardContent className="space-y-6">
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                {Object.entries(toolsByCategory).map(([category, tools]) => (
                  <div key={category} className="space-y-3">
                    <div className="flex items-center gap-2 font-medium">
                      {CATEGORY_ICONS[category as DataSourceCategory]}
                      {CATEGORY_LABELS[category as DataSourceCategory]}
                    </div>
                    <div className="space-y-2 pl-6">
                      {tools.map((tool) => {
                        const key = `${tool.category}:${tool.id}`;
                        const isSelected = selectedTools.has(key);
                        const isDisabled = tool.id !== "sheets_excel";

                        if (isDisabled) {
                          return (
                            <div
                              key={tool.id}
                              className="flex items-center space-x-2"
                            >
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
                                  <p>
                                    We don&apos;t support this integration yet
                                  </p>
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
                          <div
                            key={tool.id}
                            className="flex items-center space-x-2"
                          >
                            <Checkbox
                              id={key}
                              checked={isSelected}
                              disabled={isDisabled}
                              onCheckedChange={() =>
                                toggleTool(tool.category, tool.id)
                              }
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
                                  toggleTool(
                                    category as DataSourceCategory,
                                    "other"
                                  )
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
                    </div>
                  </div>
                ))}
              </div>

              {selectedTools.size > 0 && (
                <div
                  className={
                    hasIntegrations
                      ? "bg-blue-50 border border-blue-200 rounded-lg p-4"
                      : "bg-amber-50 border border-amber-200 rounded-lg p-4"
                  }
                >
                  <div className="flex items-start gap-3">
                    {hasIntegrations ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-medium text-blue-900">
                            Integrations Available
                          </p>
                          <p className="text-sm text-blue-700 mt-1">
                            Some of your selected tools have available
                            integrations. Integrations will be available in a
                            future update.
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
                            No integrations are currently available for your
                            selected tools. You can upload files manually in the
                            Data Model Builder.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {message && (
                <div
                  className={`p-3 rounded-lg ${message.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}
                >
                  {message.text}
                </div>
              )}

              <Button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="w-full"
                size="lg"
              >
                {saving ? "Saving..." : "Save Data Sources"}
              </Button>
            </CardContent>
          )}
        </Card>

        {/* Current Sources List */}
        {existingSources.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Current Data Sources</CardTitle>
              <CardDescription>
                Your currently declared data sources
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {existingSources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {CATEGORY_ICONS[source.category]}
                      <div>
                        <p className="font-medium">
                          {getToolName(source.category, source.tool_name)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {CATEGORY_LABELS[source.category]}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteClick(source.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* File Upload Section */}
        {model?.recommendedTables && model.recommendedTables.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Data Files
              </CardTitle>
              <CardDescription>
                Upload CSV or Excel files to import your data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ModelTableListView model={model} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Data Model Setup Required
              </CardTitle>
              <CardDescription>
                Configure your business data model first to start uploading data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Go to the Model Builder to define your data tables and
                relationships before uploading data.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          setConfirmDialog({
            open,
            sourceId: open ? confirmDialog.sourceId : null,
          })
        }
        title="Remove Data Source"
        description="Are you sure you want to remove this data source? This action cannot be undone."
        confirmText="Remove"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDeleteSource}
      />
    </div>
  );
}
