"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AdminHeader } from "@/components/management/admin-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Save, ArrowLeft } from "lucide-react";
import { TemplateDataTablesEditor } from "@/components/management/template-data-tables-editor";
import { TemplateKpisEditor } from "@/components/management/template-kpis-editor";
import { TemplateRelationshipsEditor } from "@/components/management/template-relationships-editor";
import { TemplateModelPreview } from "@/components/management/template-model-preview";
import type { DataTableRelationship } from "@/lib/types/data";

interface Template {
  key: string;
  name: string;
  description?: string;
  required_table_ids?: string[];
  required_relationships?: DataTableRelationship[];
  kpi_ids?: string[];
  filters?: any[];
  mvp_guardrails?: any;
}

export default function TemplateEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const isNew = params.key === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<Template>({
    key: "",
    name: "",
    description: "",
    required_table_ids: [],
    required_relationships: [],
    kpi_ids: [],
    filters: [],
    mvp_guardrails: {},
  });

  useEffect(() => {
    if (!isNew) {
      fetchTemplate();
    }
  }, [params.key]);

  const fetchTemplate = async () => {
    try {
      const response = await fetch(`/api/admin/templates/${params.key}`);
      if (!response.ok) throw new Error("Failed to fetch template");
      const data = await response.json();
      setTemplate(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load template",
        variant: "destructive",
      });
      router.push("/management/templates");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // Validation
    if (!template.key || !template.name) {
      toast({
        title: "Validation Error",
        description: "Key and name are required",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    try {
      const url = isNew
        ? "/api/admin/templates"
        : `/api/admin/templates/${params.key}`;
      const method = isNew ? "POST" : "PUT";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(template),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save template");
      }

      toast({
        title: "Success",
        description: isNew
          ? "Template created successfully"
          : "Template updated successfully",
      });

      if (isNew) {
        router.push("/management/templates");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateTemplate = (updates: Partial<Template>) => {
    setTemplate((prev) => ({ ...prev, ...updates }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title={isNew ? "Create Template" : `Edit Template: ${template.name}`}
        description={
          isNew
            ? "Define a new business model template"
            : "Modify template configuration"
        }
        breadcrumbs={[
          { label: "Management", href: "/management/dashboard" },
          { label: "Templates", href: "/management/templates" },
          { label: isNew ? "New" : template.name },
        ]}
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => router.push("/management/templates")}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="basic" className="space-y-6">
        <TabsList>
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="tables">Data Tables</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="model">Model Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>
                Template key, name, and description
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="key">Key *</Label>
                  <Input
                    id="key"
                    value={template.key}
                    onChange={(e) => updateTemplate({ key: e.target.value })}
                    placeholder="saas"
                    disabled={!isNew}
                  />
                  <p className="text-xs text-muted-foreground">
                    {isNew
                      ? "Unique identifier (lowercase, underscores)"
                      : "Cannot be changed after creation"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={template.name}
                    onChange={(e) => updateTemplate({ name: e.target.value })}
                    placeholder="SaaS Business"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={template.description || ""}
                  onChange={(e) =>
                    updateTemplate({ description: e.target.value })
                  }
                  placeholder="Describe this business model template..."
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tables">
          <TemplateDataTablesEditor
            selectedTableIds={template.required_table_ids || []}
            onChange={(tableIds) =>
              updateTemplate({ required_table_ids: tableIds })
            }
          />
        </TabsContent>

        <TabsContent value="relationships">
          <TemplateRelationshipsEditor
            relationships={template.required_relationships || []}
            onChange={(relationships) =>
              updateTemplate({ required_relationships: relationships })
            }
            selectedTableIds={template.required_table_ids || []}
          />
        </TabsContent>

        <TabsContent value="kpis">
          <TemplateKpisEditor
            selectedKpiIds={template.kpi_ids || []}
            onChange={(kpiIds) => updateTemplate({ kpi_ids: kpiIds })}
            selectedTableIds={template.required_table_ids || []}
          />
        </TabsContent>

        <TabsContent value="model">
          <TemplateModelPreview
            selectedTableIds={template.required_table_ids || []}
            relationships={template.required_relationships || []}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
