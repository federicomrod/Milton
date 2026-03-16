"use client";

import { useEffect, useState, useCallback } from "react";
import { AdminHeader } from "@/components/management/admin-header";
import { AdminTable, ColumnDef } from "@/components/management/admin-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { KpiFormDialog } from "@/components/management/kpi-form-dialog";
import { DeleteConfirmationDialog } from "@/components/management/delete-confirmation-dialog";
import { useToast } from "@/components/ui/use-toast";

interface Kpi {
  id: string;
  name: string;
  definition: string;
  required_data?: string[];
  flexibility?: Record<string, unknown>;
  formula?: string;
  is_published?: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export default function KpisPage() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKpi, setSelectedKpi] = useState<Kpi | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [kpiToDelete, setKpiToDelete] = useState<Kpi | null>(null);
  const [impactData, setImpactData] = useState<any>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const { toast } = useToast();

  const fetchKpis = useCallback(async () => {
    try {
      const url = showDrafts
        ? "/api/admin/kpis?show_drafts=true"
        : "/api/admin/kpis";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch KPIs");
      const data = await response.json();
      setKpis(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load KPIs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [showDrafts, toast]);

  useEffect(() => {
    setLoading(true);
    fetchKpis();
  }, [fetchKpis]);

  const handleCreate = () => {
    setSelectedKpi(null);
    setIsFormOpen(true);
  };

  const handleEdit = (kpi: Kpi) => {
    setSelectedKpi(kpi);
    setIsFormOpen(true);
  };

  const handleDelete = async (kpi: Kpi) => {
    setKpiToDelete(kpi);

    // Fetch impact data
    try {
      const response = await fetch(`/api/admin/kpis/impact/${kpi.id}`);
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
    if (!kpiToDelete) return;

    try {
      const response = await fetch(`/api/admin/kpis/${kpiToDelete.id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete KPI");

      toast({
        title: "Success",
        description: "KPI deleted successfully",
      });

      fetchKpis();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete KPI",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setKpiToDelete(null);
      setImpactData(null);
    }
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setSelectedKpi(null);
    fetchKpis();
  };

  const columns: ColumnDef<Kpi>[] = [
    {
      key: "name",
      label: "Name",
      render: (kpi) => <div className="font-medium">{kpi.name}</div>,
    },
    {
      key: "definition",
      label: "Definition",
      render: (kpi) => (
        <div className="max-w-md truncate text-sm text-muted-foreground">
          {kpi.definition}
        </div>
      ),
    },
    {
      key: "required_data",
      label: "Required Data",
      render: (kpi) => {
        const count = kpi.required_data?.length || 0;
        return count > 0 ? (
          <Badge variant="secondary">{count} table(s)</Badge>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        );
      },
    },
    {
      key: "is_published",
      label: "Status",
      render: (kpi) => (
        <Badge variant={kpi.is_published ? "default" : "secondary"}>
          {kpi.is_published ? "Published" : "Draft"}
        </Badge>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const impactWarning = impactData
    ? `This KPI is used by ${impactData.referencingTemplates?.length || 0} template(s) and selected by ${impactData.companiesUsing || 0} company(ies).`
    : undefined;

  return (
    <div>
      <AdminHeader
        title={`KPIs (${kpis.length})`}
        description={
          showDrafts
            ? "Manage all key performance indicators (including drafts)"
            : "Manage published key performance indicators"
        }
        breadcrumbs={[
          { label: "Management", href: "/management/dashboard" },
          { label: "KPIs" },
        ]}
        action={
          <div className="flex gap-2">
            <Button
              variant={showDrafts ? "default" : "outline"}
              onClick={() => setShowDrafts(!showDrafts)}
            >
              {showDrafts ? "Hide Drafts" : "Show Drafts"}
            </Button>
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create KPI
            </Button>
          </div>
        }
      />

      <AdminTable
        columns={columns}
        data={kpis}
        onEdit={handleEdit}
        onDelete={handleDelete}
        searchableFields={["name", "definition"]}
        emptyMessage={
          showDrafts
            ? "No KPIs found. Create your first KPI to get started."
            : "No published KPIs found. Create a KPI and set it as published to see it here."
        }
        getRowKey={(kpi) => kpi.id}
      />

      <KpiFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        kpi={selectedKpi}
        onSuccess={handleFormSuccess}
      />

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title="Delete KPI"
        description={`Are you sure you want to delete "${kpiToDelete?.name}"? This action cannot be undone.`}
        impactWarning={impactWarning}
      />
    </div>
  );
}
