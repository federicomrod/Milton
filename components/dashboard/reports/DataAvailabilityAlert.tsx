// components/dashboard/reports/DataAvailabilityAlert.tsx
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import type { DataStatus } from "@/lib/hooks/useReportData";

interface DataAvailabilityAlertProps {
  dataStatus: DataStatus;
}

export function DataAvailabilityAlert({
  dataStatus,
}: DataAvailabilityAlertProps) {
  if (!dataStatus.modelTables || dataStatus.modelTables.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <p className="font-medium">No data sources found.</p>
          <p className="text-sm">
            Upload data to your model tables to generate reports.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-2">
          <p className="font-medium">Data Sources:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            {dataStatus.modelTables.map((table) => (
              <div key={table.name} className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    table.count > 0 ? "bg-green-500" : "bg-red-500"
                  }`}
                ></div>
                <span>{table.label}</span>
                <span className="text-xs text-muted-foreground">
                  ({table.count} records)
                </span>
              </div>
            ))}
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
