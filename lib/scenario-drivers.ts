// lib/scenario-drivers.ts
// Driver types and business-model-specific driver templates for scenario editor

export interface Driver {
  id: string;
  label: string;
  value: number;
  unit: string;
  type: "number" | "slider";
  min?: number;
  max?: number;
  step?: number;
  description: string;
  baseline: number;
}

export interface DriverSection {
  id: string;
  title: string;
  drivers: Driver[];
}

/** Display name used in UI (e.g. "Fitness Studio"). DB uses e.g. "fitness_studio". */
export type BusinessModelKey =
  | "B2B SaaS"
  | "Services"
  | "Fitness Studio"
  | "Restaurant";

/** Map DB business_type to template key */
export function businessTypeToTemplateKey(
  businessType: string | null
): BusinessModelKey {
  if (!businessType) return "B2B SaaS";
  const map: Record<string, BusinessModelKey> = {
    fitness_studio: "Fitness Studio",
    restaurant: "Restaurant",
    b2b_saas: "B2B SaaS",
    services: "Services",
  };
  return map[businessType] ?? "B2B SaaS";
}

/** Deep clone driver sections for initial state */
function cloneSections(sections: DriverSection[]): DriverSection[] {
  return sections.map((section) => ({
    ...section,
    drivers: section.drivers.map((d) => ({ ...d })),
  }));
}

/**
 * Merge saved driver_overrides onto template; template provides full structure and baselines.
 * When driverBaselinesFromKpis is provided (e.g. from fitness studio KPIs), those values
 * override the template baseline and initial value for matching driver ids (unless the user
 * has a saved override for that driver).
 */
export function mergeDriverOverrides(
  template: DriverSection[],
  overrides: DriverSection[],
  driverBaselinesFromKpis?: Record<string, number> | null
): DriverSection[] {
  const overrideBySectionId = new Map(overrides.map((s) => [s.id, s]));
  const kpiBaselines = driverBaselinesFromKpis ?? {};
  return cloneSections(
    template.map((section) => {
      const overrideSection = overrideBySectionId.get(section.id);
      const overrideByDriverId = overrideSection
        ? new Map(overrideSection.drivers.map((d) => [d.id, d]))
        : new Map<string, Driver>();
      return {
        ...section,
        drivers: section.drivers.map((driver) => {
          const overrideDriver = overrideByDriverId.get(driver.id);
          const kpiValue = kpiBaselines[driver.id];
          const baseline = kpiValue != null ? kpiValue : driver.baseline;
          const value = overrideDriver
            ? overrideDriver.value
            : kpiValue != null
              ? kpiValue
              : driver.value;
          return {
            ...driver,
            baseline,
            value,
          };
        }),
      };
    })
  );
}

const b2bSaaS: DriverSection[] = [
  {
    id: "universal",
    title: "Universal Drivers",
    drivers: [
      {
        id: "revenue-growth",
        label: "Revenue growth rate",
        value: 15,
        unit: "%",
        type: "slider",
        min: -50,
        max: 100,
        step: 1,
        description: "Overall revenue growth rate",
        baseline: 15,
      },
      {
        id: "price-adjustment",
        label: "Price adjustment",
        value: 0,
        unit: "%",
        type: "slider",
        min: -50,
        max: 50,
        step: 1,
        description: "Price adjustment across all products",
        baseline: 0,
      },
      {
        id: "cost-growth",
        label: "Cost growth rate",
        value: 10,
        unit: "%",
        type: "slider",
        min: -50,
        max: 100,
        step: 1,
        description: "Overall cost growth rate",
        baseline: 10,
      },
      {
        id: "variable-cost-ratio",
        label: "Variable cost ratio",
        value: 25,
        unit: "%",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Variable costs as percentage of revenue",
        baseline: 25,
      },
      {
        id: "payment-delay",
        label: "Payment delay",
        value: 30,
        unit: "days",
        type: "number",
        min: 0,
        max: 180,
        step: 1,
        description: "Average payment delay from customers",
        baseline: 30,
      },
      {
        id: "one-off-adjustment",
        label: "One-off adjustment",
        value: 0,
        unit: "€",
        type: "number",
        description: "One-time adjustment to cash flow",
        baseline: 0,
      },
    ],
  },
  {
    id: "revenue-sales",
    title: "Revenue & Sales Engine",
    drivers: [
      {
        id: "avg-deal-size",
        label: "Average Deal Size",
        value: 50000,
        unit: "€",
        type: "number",
        min: 0,
        description: "Contract value per new customer",
        baseline: 50000,
      },
      {
        id: "deals-per-ae",
        label: "Deals per AE per Month",
        value: 2,
        unit: "count",
        type: "number",
        min: 0,
        step: 0.1,
        description: "Sales productivity",
        baseline: 2,
      },
      {
        id: "num-ae",
        label: "Number of Account Executives",
        value: 5,
        unit: "count",
        type: "number",
        min: 0,
        description: "Size of sales team",
        baseline: 5,
      },
      {
        id: "win-rate",
        label: "Win Rate",
        value: 25,
        unit: "%",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Conversion from pipeline to closed deals",
        baseline: 25,
      },
      {
        id: "expansion-revenue",
        label: "Expansion Revenue Rate",
        value: 15,
        unit: "%",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Upsell / cross-sell on existing customers",
        baseline: 15,
      },
      {
        id: "price-increase",
        label: "Price Increase",
        value: 5,
        unit: "%",
        type: "slider",
        min: 0,
        max: 50,
        step: 1,
        description: "SaaS pricing changes",
        baseline: 5,
      },
    ],
  },
  {
    id: "retention",
    title: "Retention",
    drivers: [
      {
        id: "monthly-churn",
        label: "Monthly Churn Rate",
        value: 2,
        unit: "%",
        type: "slider",
        min: 0,
        max: 20,
        step: 0.1,
        description: "Customer attrition",
        baseline: 2,
      },
      {
        id: "avg-customer-lifetime",
        label: "Average Customer Lifetime",
        value: 36,
        unit: "months",
        type: "number",
        min: 0,
        description: "Derived or overridden",
        baseline: 36,
      },
    ],
  },
  {
    id: "cost-structure",
    title: "Cost Structure",
    drivers: [
      {
        id: "cost-of-sales",
        label: "Cost of Sales",
        value: 20,
        unit: "% of revenue",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Sales-related variable costs",
        baseline: 20,
      },
      {
        id: "rd-spend",
        label: "R&D Spend",
        value: 30,
        unit: "% of revenue",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Product development",
        baseline: 30,
      },
      {
        id: "ga-spend",
        label: "G&A Spend",
        value: 15,
        unit: "% of revenue",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Overhead and admin",
        baseline: 15,
      },
    ],
  },
];

const services: DriverSection[] = [
  {
    id: "universal",
    title: "Universal Drivers",
    drivers: [
      {
        id: "revenue-growth",
        label: "Revenue growth rate",
        value: 20,
        unit: "%",
        type: "slider",
        min: -50,
        max: 100,
        step: 1,
        description: "Overall revenue growth rate",
        baseline: 20,
      },
      {
        id: "price-adjustment",
        label: "Price adjustment",
        value: 0,
        unit: "%",
        type: "slider",
        min: -50,
        max: 50,
        step: 1,
        description: "Price adjustment across all services",
        baseline: 0,
      },
      {
        id: "cost-growth",
        label: "Cost growth rate",
        value: 15,
        unit: "%",
        type: "slider",
        min: -50,
        max: 100,
        step: 1,
        description: "Overall cost growth rate",
        baseline: 15,
      },
      {
        id: "payment-delay",
        label: "Payment delay",
        value: 45,
        unit: "days",
        type: "number",
        min: 0,
        max: 180,
        step: 1,
        description: "Average payment delay from clients",
        baseline: 45,
      },
    ],
  },
  {
    id: "capacity",
    title: "Capacity & Utilization",
    drivers: [
      {
        id: "billable-hours",
        label: "Billable Hours per Consultant",
        value: 140,
        unit: "hours/month",
        type: "number",
        min: 0,
        description: "Average billable hours per consultant",
        baseline: 140,
      },
      {
        id: "hourly-rate",
        label: "Average Hourly Rate",
        value: 150,
        unit: "€/hour",
        type: "number",
        min: 0,
        description: "Blended rate across all consultants",
        baseline: 150,
      },
      {
        id: "num-consultants",
        label: "Number of Consultants",
        value: 10,
        unit: "count",
        type: "number",
        min: 0,
        description: "Size of delivery team",
        baseline: 10,
      },
      {
        id: "utilization-rate",
        label: "Utilization Rate",
        value: 75,
        unit: "%",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Percentage of available hours billed",
        baseline: 75,
      },
    ],
  },
];

const fitnessStudio: DriverSection[] = [
  {
    id: "universal",
    title: "Universal Drivers",
    drivers: [
      {
        id: "revenue-growth",
        label: "Revenue growth rate",
        value: 10,
        unit: "%",
        type: "slider",
        min: -50,
        max: 100,
        step: 1,
        description: "Overall revenue growth rate",
        baseline: 10,
      },
      {
        id: "price-adjustment",
        label: "Price adjustment",
        value: 0,
        unit: "%",
        type: "slider",
        min: -50,
        max: 50,
        step: 1,
        description: "Membership price adjustment",
        baseline: 0,
      },
      {
        id: "cost-growth",
        label: "Cost growth rate",
        value: 5,
        unit: "%",
        type: "slider",
        min: -50,
        max: 100,
        step: 1,
        description: "Overall cost growth rate",
        baseline: 5,
      },
    ],
  },
  {
    id: "membership",
    title: "Membership & Capacity",
    drivers: [
      {
        id: "total-members",
        label: "Total Active Members",
        value: 250,
        unit: "count",
        type: "number",
        min: 0,
        description: "Number of active memberships",
        baseline: 250,
      },
      {
        id: "avg-membership-fee",
        label: "Average Membership Fee",
        value: 60,
        unit: "€/month",
        type: "number",
        min: 0,
        description: "Average monthly membership revenue",
        baseline: 60,
      },
      {
        id: "member-acquisition",
        label: "New Members per Month",
        value: 15,
        unit: "count",
        type: "number",
        min: 0,
        description: "Monthly new member sign-ups",
        baseline: 15,
      },
      {
        id: "monthly-churn",
        label: "Monthly Churn Rate",
        value: 5,
        unit: "%",
        type: "slider",
        min: 0,
        max: 50,
        step: 0.5,
        description: "Member cancellation rate",
        baseline: 5,
      },
      {
        id: "studio-capacity",
        label: "Studio Capacity",
        value: 350,
        unit: "members",
        type: "number",
        min: 0,
        description: "Maximum member capacity",
        baseline: 350,
      },
    ],
  },
];

const restaurant: DriverSection[] = [
  {
    id: "universal",
    title: "Universal Drivers",
    drivers: [
      {
        id: "revenue-growth",
        label: "Revenue growth rate",
        value: 8,
        unit: "%",
        type: "slider",
        min: -50,
        max: 100,
        step: 1,
        description: "Overall revenue growth rate",
        baseline: 8,
      },
      {
        id: "price-adjustment",
        label: "Price adjustment",
        value: 0,
        unit: "%",
        type: "slider",
        min: -50,
        max: 50,
        step: 1,
        description: "Menu price adjustment",
        baseline: 0,
      },
      {
        id: "cost-growth",
        label: "Cost growth rate",
        value: 6,
        unit: "%",
        type: "slider",
        min: -50,
        max: 100,
        step: 1,
        description: "Overall cost growth rate",
        baseline: 6,
      },
    ],
  },
  {
    id: "operations",
    title: "Operations & Traffic",
    drivers: [
      {
        id: "covers-per-day",
        label: "Covers per Day",
        value: 80,
        unit: "count",
        type: "number",
        min: 0,
        description: "Average number of customers served daily",
        baseline: 80,
      },
      {
        id: "avg-check-size",
        label: "Average Check Size",
        value: 35,
        unit: "€",
        type: "number",
        min: 0,
        description: "Average spend per customer",
        baseline: 35,
      },
      {
        id: "operating-days",
        label: "Operating Days per Month",
        value: 26,
        unit: "days",
        type: "number",
        min: 0,
        max: 31,
        description: "Number of days open per month",
        baseline: 26,
      },
      {
        id: "table-turnover",
        label: "Table Turnover Rate",
        value: 2.5,
        unit: "turns/day",
        type: "number",
        min: 0,
        step: 0.1,
        description: "Average table turns per service",
        baseline: 2.5,
      },
    ],
  },
  {
    id: "costs",
    title: "Cost Structure",
    drivers: [
      {
        id: "food-cost",
        label: "Food Cost",
        value: 30,
        unit: "% of revenue",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Cost of goods sold",
        baseline: 30,
      },
      {
        id: "labor-cost",
        label: "Labor Cost",
        value: 35,
        unit: "% of revenue",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Staff wages and benefits",
        baseline: 35,
      },
      {
        id: "occupancy-cost",
        label: "Occupancy Cost",
        value: 15,
        unit: "% of revenue",
        type: "slider",
        min: 0,
        max: 100,
        step: 1,
        description: "Rent and utilities",
        baseline: 15,
      },
    ],
  },
];

const templates: Record<BusinessModelKey, DriverSection[]> = {
  "B2B SaaS": b2bSaaS,
  Services: services,
  "Fitness Studio": fitnessStudio,
  Restaurant: restaurant,
};

export function getDriverSectionsForBusinessModel(
  businessType: string | null
): DriverSection[] {
  const key = businessTypeToTemplateKey(businessType);
  return cloneSections(templates[key]);
}
