"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface DriverRow {
  name: string;
  values: Record<string, string | number>;
}

interface DriverDifferencesProps {
  scenarios: Array<{ id: string; name: string }>;
  drivers: DriverRow[];
}

export function DriverDifferences({
  scenarios,
  drivers,
}: DriverDifferencesProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="px-6 py-4 bg-muted/50 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">
          What&apos;s different between scenarios
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">
                Driver
              </th>
              {scenarios.map((scenario) => (
                <th
                  key={scenario.id}
                  className="px-6 py-3 text-left text-sm font-medium text-muted-foreground"
                >
                  {scenario.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver, index) => (
              <tr
                key={driver.name}
                className={cn(
                  "border-b border-border",
                  index % 2 === 0 ? "bg-card" : "bg-muted/30"
                )}
              >
                <td className="px-6 py-4 text-sm font-medium text-foreground">
                  {driver.name}
                </td>
                {scenarios.map((scenario) => (
                  <td key={scenario.id} className="px-6 py-4">
                    <span className="inline-flex items-center px-3 py-1 bg-muted rounded-md text-sm">
                      {driver.values[scenario.id]}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
