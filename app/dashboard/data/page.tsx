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
} from "lucide-react";
import FileUpload from "@/components/dashboard/file-upload";
import { FileManagement } from "@/components/dashboard/file-management";
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

export default function DataManagementPage() {
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [existingSources, setExistingSources] = useState<UserDataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    loadDataSources();
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

  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm("Are you sure you want to remove this data source?")) return;

    try {
      await deleteUserDataSource(sourceId);
      await loadDataSources();
      setMessage({
        type: "success",
        text: "Data source removed successfully!",
      });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: "error", text: "Failed to remove data source." });
      console.error(error);
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
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Declared Data Sources
            </CardTitle>
            <CardDescription>
              Select which tools or systems you use to track your data. This
              helps us understand your data structure.
            </CardDescription>
          </CardHeader>
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
                      return (
                        <div
                          key={tool.id}
                          className="flex items-center space-x-2"
                        >
                          <Checkbox
                            id={key}
                            checked={isSelected}
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
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`${category}:other`}
                        checked={selectedTools.has(`${category}:other`)}
                        onCheckedChange={() =>
                          toggleTool(category as DataSourceCategory, "other")
                        }
                      />
                      <Label
                        htmlFor={`${category}:other`}
                        className="cursor-pointer font-normal"
                      >
                        Other
                      </Label>
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
                        />
                      )}
                    </div>
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
              disabled={saving}
              className="w-full"
              size="lg"
            >
              {saving ? "Saving..." : "Save Data Sources"}
            </Button>
          </CardContent>
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
                      onClick={() => handleDeleteSource(source.id)}
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
            <FileUpload />
          </CardContent>
        </Card>

        {/* File Management Section */}
        <FileManagement />
      </div>
    </div>
  );
}
