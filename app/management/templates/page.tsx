"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminHeader } from "@/components/management/admin-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Pencil } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface Template {
  key: string;
  name: string;
  description?: string;
  kpi_ids?: string[];
  required_table_ids?: string[];
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [publishedKpiIds, setPublishedKpiIds] = useState<Set<string>>(
    new Set()
  );
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [templatesRes, kpisRes] = await Promise.all([
        fetch("/api/admin/templates"),
        fetch("/api/admin/kpis?show_drafts=true"),
      ]);
      if (!templatesRes.ok) throw new Error("Failed to fetch templates");
      if (!kpisRes.ok) throw new Error("Failed to fetch KPIs");

      const [templatesData, kpisData] = await Promise.all([
        templatesRes.json(),
        kpisRes.json(),
      ]);

      setTemplates(templatesData);
      setPublishedKpiIds(
        new Set(
          kpisData
            .filter(
              (k: { id: string; is_published: boolean }) => k.is_published
            )
            .map((k: { id: string }) => k.id)
        )
      );
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load templates",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (templateKey: string) => {
    router.push(`/management/templates/${templateKey}`);
  };

  const handleCreate = () => {
    router.push("/management/templates/new");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const getPublishedKpiCount = (kpiIds?: string[]) =>
    (kpiIds ?? []).filter((id) => publishedKpiIds.has(id)).length;

  return (
    <div>
      <AdminHeader
        title="Business Model Templates"
        description="Manage business model templates and their configurations"
        breadcrumbs={[
          { label: "Management", href: "/management/dashboard" },
          { label: "Templates" },
        ]}
        action={
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create Template
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.key} className="relative">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>{template.name}</CardTitle>
                  <Badge variant="outline" className="mt-2">
                    {template.key}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleEdit(template.key)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              {template.description && (
                <CardDescription className="mt-2">
                  {template.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">KPIs:</span>
                <Badge variant="secondary">
                  {template.kpi_ids?.length || 0}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground cursor-default flex items-center gap-1">
                        KPIs published:
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="opacity-50"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 16v-4" />
                          <path d="M12 8h.01" />
                        </svg>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        Number of KPIs that are published and visible to users
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Badge
                  variant="outline"
                  className="text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-400"
                >
                  {getPublishedKpiCount(template.kpi_ids)}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Data Tables:</span>
                <Badge variant="secondary">
                  {template.required_table_ids?.length || 0}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">
            No templates found. Create your first template to get started.
          </p>
        </div>
      )}
    </div>
  );
}
