// lib/metric-data-requirements.ts
// Defines data requirements for each metric to enable availability checking

export type DataSource = "transactions" | "deals" | "budget";

export interface MetricDataRequirement {
  metricId: string;
  requiredDataSources: DataSource[];
  minimumRecords?: {
    [key in DataSource]?: number;
  };
  description: string;
}

/**
 * Defines which data sources are required for each metric calculation.
 * This enables us to show flags when users don't have enough data for specific metrics.
 */
export const METRIC_DATA_REQUIREMENTS: MetricDataRequirement[] = [
  // Revenue metrics - require transaction data
  {
    metricId: "mrr",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 1 },
    description:
      "Requires transaction data to calculate monthly recurring revenue",
  },
  {
    metricId: "arr",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 1 },
    description:
      "Requires transaction data to calculate annual recurring revenue",
  },
  {
    metricId: "ltmRevenue",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 1 },
    description:
      "Requires transaction data to calculate last twelve months revenue",
  },

  // Cash flow metrics - require transaction data
  {
    metricId: "cashBalance",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 1 },
    description: "Requires transaction data to calculate cash balance",
  },
  {
    metricId: "burnRate",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 3 }, // Need multiple months for burn rate
    description:
      "Requires transaction data from multiple months to calculate burn rate",
  },
  {
    metricId: "runway",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 1 },
    description: "Requires transaction data to calculate runway",
  },
  {
    metricId: "quickRatio",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 1 },
    description: "Requires transaction data to calculate quick ratio",
  },

  // Margin metrics - require transaction data
  {
    metricId: "grossMargin",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 10 }, // Need enough data for meaningful margin calculation
    description: "Requires transaction data to calculate gross margin",
  },
  {
    metricId: "netMargin",
    requiredDataSources: ["transactions"],
    minimumRecords: { transactions: 10 },
    description: "Requires transaction data to calculate net margin",
  },

  // Customer/Sales metrics - require deal data
  {
    metricId: "contracted",
    requiredDataSources: ["deals"],
    minimumRecords: { deals: 1 },
    description: "Requires deal data to calculate contracted pipeline value",
  },
  {
    metricId: "customers",
    requiredDataSources: ["transactions", "deals"],
    minimumRecords: { transactions: 1, deals: 1 },
    description:
      "Requires both transaction and deal data to identify customers",
  },

  // Advanced customer metrics - require both transactions and deals
  {
    metricId: "cac",
    requiredDataSources: ["transactions", "deals"],
    minimumRecords: { transactions: 5, deals: 2 },
    description:
      "Requires transaction data for marketing expenses and deal data for customer acquisition",
  },
  {
    metricId: "ltv",
    requiredDataSources: ["transactions", "deals"],
    minimumRecords: { transactions: 10, deals: 3 },
    description:
      "Requires transaction revenue data and deal data to calculate customer lifetime value",
  },
  {
    metricId: "churn",
    requiredDataSources: ["deals"],
    minimumRecords: { deals: 5 },
    description: "Requires deal data to calculate churn rate",
  },

  // NPS - requires survey data (placeholder)
  {
    metricId: "nps",
    requiredDataSources: [], // No data sources currently available
    description: "Requires customer survey data (not currently available)",
  },
];

export function getMetricDataRequirements(
  metricId: string
): MetricDataRequirement | undefined {
  return METRIC_DATA_REQUIREMENTS.find((req) => req.metricId === metricId);
}

export function getMissingDataSourcesForMetric(
  metricId: string,
  availableData: { [key in DataSource]?: boolean },
  recordCounts: { [key in DataSource]?: number } = {}
): DataSource[] {
  const requirement = getMetricDataRequirements(metricId);
  if (!requirement) return [];

  const missingSources: DataSource[] = [];

  for (const source of requirement.requiredDataSources) {
    // Check if data source is available
    if (!availableData[source]) {
      missingSources.push(source);
      continue;
    }

    // Check minimum record requirements
    const minRecords = requirement.minimumRecords?.[source];
    if (minRecords && (recordCounts[source] || 0) < minRecords) {
      missingSources.push(source);
    }
  }

  return missingSources;
}

export function isMetricAvailable(
  metricId: string,
  availableData: { [key in DataSource]?: boolean },
  recordCounts: { [key in DataSource]?: number } = {}
): boolean {
  return (
    getMissingDataSourcesForMetric(metricId, availableData, recordCounts)
      .length === 0
  );
}
