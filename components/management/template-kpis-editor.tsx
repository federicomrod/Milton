"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

interface Kpi {
  id: string;
  name: string;
  definition: string;
}

interface TemplateKpisEditorProps {
  selectedKpiIds: string[];
  onChange: (kpiIds: string[]) => void;
}

export function TemplateKpisEditor({
  selectedKpiIds,
  onChange,
}: TemplateKpisEditorProps) {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchKpis();
  }, []);

  const fetchKpis = async () => {
    try {
      const response = await fetch("/api/admin/kpis");
      if (response.ok) {
        const data = await response.json();
        setKpis(data);
      }
    } catch (error) {
      console.error("Failed to fetch KPIs:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleKpi = (kpiId: string) => {
    if (selectedKpiIds.includes(kpiId)) {
      onChange(selectedKpiIds.filter((id) => id !== kpiId));
    } else {
      onChange([...selectedKpiIds, kpiId]);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading KPIs...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>KPIs</CardTitle>
        <CardDescription>
          Select the KPIs that are relevant for this business model template
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {kpis.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No KPIs available
            </p>
          ) : (
            kpis.map((kpi) => (
              <label
                key={kpi.id}
                className="flex items-start space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors"
              >
                <Checkbox
                  checked={selectedKpiIds.includes(kpi.id)}
                  onCheckedChange={() => toggleKpi(kpi.id)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium">{kpi.name}</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {kpi.definition}
                  </p>
                </div>
              </label>
            ))
          )}
        </div>
        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {selectedKpiIds.length} KPI(s) selected
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
