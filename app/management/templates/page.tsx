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
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const response = await fetch("/api/admin/templates");
      if (!response.ok) throw new Error("Failed to fetch templates");
      const data = await response.json();
      setTemplates(data);
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
