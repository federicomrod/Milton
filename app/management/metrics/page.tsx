"use client";

import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/management/admin-header";
import { AdminTable, ColumnDef } from "@/components/management/admin-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import { MetricFormDialog } from "@/components/management/metric-form-dialog";
import { DeleteConfirmationDialog } from "@/components/management/delete-confirmation-dialog";
import { useToast } from "@/components/ui/use-toast";

interface Metric {
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: "core" | "ltm" | "advanced";
  created_at: string;
  updated_at: string;
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [metricToDelete, setMetricToDelete] = useState<Metric | null>(null);
  const [impactData, setImpactData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("all");
  const { toast } = useToast();

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const response = await fetch("/api/admin/metrics");
      if (!response.ok) throw new Error("Failed to fetch metrics");
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load metrics",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setSelectedMetric(null);
    setIsFormOpen(true);
  };

  const handleEdit = (metric: Metric) => {
    setSelectedMetric(metric);
    setIsFormOpen(true);
  };

  const handleDelete = async (metric: Metric) => {
    setMetricToDelete(metric);

    // Fetch impact data
    try {
      const response = await fetch(`/api/admin/metrics/impact/${metric.id}`);
      if (response.ok) {
        const data = await response.json();
        setImpactData(data);
      }
    } catch (error) {
      console.error("Failed to fetch impact data:", error);
    }

    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!metricToDelete) return;

    try {
      const response = await fetch(`/api/admin/metrics/${metricToDelete.id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete metric");

      toast({
        title: "Success",
        description: "Metric deleted successfully",
      });

      fetchMetrics();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete metric",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setMetricToDelete(null);
      setImpactData(null);
    }
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setSelectedMetric(null);
    fetchMetrics();
  };

  const getCategoryBadge = (category: string) => {
    const variants: Record<string, any> = {
      core: "default",
      ltm: "secondary",
      advanced: "outline",
    };
    return variants[category] || "default";
  };

  const columns: ColumnDef<Metric>[] = [
    {
      key: "name",
      label: "Name",
      render: (metric) => (
        <div>
          <div className="font-medium">{metric.name}</div>
          <div className="text-sm text-muted-foreground">{metric.slug}</div>
        </div>
      ),
    },
    {
      key: "description",
      label: "Description",
      render: (metric) => (
        <div className="max-w-md truncate">
          {metric.description || (
            <span className="text-muted-foreground">No description</span>
          )}
        </div>
      ),
    },
    {
      key: "category",
      label: "Category",
      render: (metric) => (
        <Badge variant={getCategoryBadge(metric.category)}>
          {metric.category.toUpperCase()}
        </Badge>
      ),
    },
  ];

  const filterByCategory = (category: string) => {
    if (category === "all") return metrics;
    return metrics.filter((m) => m.category === category);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const impactWarning = impactData
    ? `This metric is suggested by ${impactData.referencingTemplates?.length || 0} template(s) and used by ${impactData.companiesUsing || 0} company(ies).`
    : undefined;

  return (
    <div>
      <AdminHeader
        title="Metrics"
        description="Manage business metrics and their categories"
        breadcrumbs={[
          { label: "Management", href: "/management/dashboard" },
          { label: "Metrics" },
        ]}
        action={
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create Metric
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All ({metrics.length})</TabsTrigger>
          <TabsTrigger value="core">
            Core ({metrics.filter((m) => m.category === "core").length})
          </TabsTrigger>
          <TabsTrigger value="ltm">
            LTM ({metrics.filter((m) => m.category === "ltm").length})
          </TabsTrigger>
          <TabsTrigger value="advanced">
            Advanced ({metrics.filter((m) => m.category === "advanced").length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          <AdminTable
            columns={columns}
            data={filterByCategory(activeTab)}
            onEdit={handleEdit}
            onDelete={handleDelete}
            searchableFields={["name", "slug", "description"]}
            emptyMessage={
              activeTab === "all"
                ? "No metrics found. Create your first metric to get started."
                : `No ${activeTab} metrics found.`
            }
            getRowKey={(metric) => metric.id}
          />
        </TabsContent>
      </Tabs>

      <MetricFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        metric={selectedMetric}
        onSuccess={handleFormSuccess}
      />

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title="Delete Metric"
        description={`Are you sure you want to delete "${metricToDelete?.name}"? This action cannot be undone.`}
        impactWarning={impactWarning}
      />
    </div>
  );
}
