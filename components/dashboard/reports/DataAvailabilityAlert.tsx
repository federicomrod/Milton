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
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-2">
          <p className="font-medium">Data Sources:</p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${dataStatus.hasTransactions ? "bg-green-500" : "bg-red-500"}`}
              ></div>
              Bank Transactions
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${dataStatus.hasCRMData ? "bg-green-500" : "bg-red-500"}`}
              ></div>
              CRM Data
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${dataStatus.hasBudgetData ? "bg-green-500" : "bg-red-500"}`}
              ></div>
              Budget Data
            </div>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
