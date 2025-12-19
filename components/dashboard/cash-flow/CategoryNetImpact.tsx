// components/dashboard/cash-flow/CategoryNetImpact.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/formatters";
import type { CategoryBreakdown } from "@/lib/cash-flow-data-generators";

interface CategoryNetImpactProps {
  data: CategoryBreakdown[];
  currency: string;
}

export function CategoryNetImpact({ data, currency }: CategoryNetImpactProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Net Impact by Category</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.slice(0, 10).map((cat, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-2 bg-gray-50 rounded"
            >
              <div className="flex-1">
                <p className="text-sm font-medium">{cat.category}</p>
                <div className="flex space-x-4 text-xs text-gray-500">
                  <span>In: {formatCurrency(cat.inflow, currency)}</span>
                  <span>Out: {formatCurrency(cat.outflow, currency)}</span>
                </div>
              </div>
              <div
                className={`text-sm font-bold ${cat.net >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {formatCurrency(cat.net, currency)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
