"use client";

import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/management/admin-header";
import { AdminTable, ColumnDef } from "@/components/management/admin-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { DataTableFormDialog } from "@/components/management/data-table-form-dialog";
import { DeleteConfirmationDialog } from "@/components/management/delete-confirmation-dialog";
import { DataTableTemplatesCell } from "@/components/management/data-table-templates-cell";
import { useToast } from "@/components/ui/use-toast";
import type { DataTable } from "@/lib/types/data";

export default function DataTablesPage() {
  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<DataTable | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tableToDelete, setTableToDelete] = useState<DataTable | null>(null);
  const [impactData, setImpactData] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchDataTables();
  }, []);

  const fetchDataTables = async () => {
    try {
      const response = await fetch("/api/admin/data-tables");
      if (!response.ok) throw new Error("Failed to fetch data tables");
      const data = await response.json();
      setDataTables(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load data tables",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setSelectedTable(null);
    setIsFormOpen(true);
  };

  const handleEdit = (table: DataTable) => {
    setSelectedTable(table);
    setIsFormOpen(true);
  };

  const handleDelete = async (table: DataTable) => {
    setTableToDelete(table);

    // Fetch impact data
    try {
      const response = await fetch(`/api/admin/data-tables/impact/${table.id}`);
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
    if (!tableToDelete) return;

    try {
      const response = await fetch(
        `/api/admin/data-tables/${tableToDelete.id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Failed to delete data table");

      toast({
        title: "Success",
        description: "Data table deleted successfully",
      });

      fetchDataTables();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete data table",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setTableToDelete(null);
      setImpactData(null);
    }
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setSelectedTable(null);
    fetchDataTables();
  };

  const columns: ColumnDef<DataTable>[] = [
    {
      key: "name",
      label: "Name",
      render: (table) => (
        <div>
          <div className="font-medium">{table.name}</div>
          <div className="text-sm text-muted-foreground">{table.slug}</div>
        </div>
      ),
    },
    {
      key: "description",
      label: "Description",
      render: (table) => (
        <div className="max-w-md truncate">
          {table.description || (
            <span className="text-muted-foreground">No description</span>
          )}
        </div>
      ),
    },
    {
      key: "fields",
      label: "Fields",
      render: (table) => (
        <Badge variant="secondary">
          {Array.isArray(table.fields) ? table.fields.length : 0} fields
        </Badge>
      ),
    },
    {
      key: "templates",
      label: "Used By",
      render: (table) => <DataTableTemplatesCell tableId={table.id} />,
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
    ? `This table is referenced by ${impactData.referencingTemplates?.length || 0} template(s) and used by ${impactData.companiesUsing || 0} company(ies).`
    : undefined;

  return (
    <div>
      <AdminHeader
        title="Data Tables"
        description="Manage data table definitions used across business model templates"
        breadcrumbs={[
          { label: "Management", href: "/management/dashboard" },
          { label: "Data Tables" },
        ]}
        action={
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create Data Table
          </Button>
        }
      />

      <AdminTable
        columns={columns}
        data={dataTables}
        onEdit={handleEdit}
        onDelete={handleDelete}
        searchableFields={["name", "slug", "description"]}
        emptyMessage="No data tables found. Create your first data table to get started."
        getRowKey={(table) => table.id}
      />

      <DataTableFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        dataTable={selectedTable}
        onSuccess={handleFormSuccess}
      />

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title="Delete Data Table"
        description={`Are you sure you want to delete "${tableToDelete?.name}"? This action cannot be undone.`}
        impactWarning={impactWarning}
      />
    </div>
  );
}
