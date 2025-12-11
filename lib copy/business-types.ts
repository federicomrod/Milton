// lib/business-types.ts
// Business type definitions for Milton's adaptive dashboard

export type BusinessTypeId = 'saas' | 'agency' | 'fitness_studio';

export interface BusinessTypeDefinition {
  id: BusinessTypeId;
  label: string;
  shortLabel?: string;
  description: string;
  tagline?: string;
}

export const BUSINESS_TYPES: BusinessTypeDefinition[] = [
  {
    id: 'saas',
    label: 'SaaS / Digital Product',
    shortLabel: 'SaaS',
    description:
      'Subscription-based or digital product businesses with recurring revenue and pipelines.',
    tagline: 'MRR, churn, pipeline, CAC & LTV.',
  },
  {
    id: 'agency',
    label: 'Agency / Service Business',
    shortLabel: 'Agency',
    description:
      'Consulting, marketing, training, or professional services with projects and retainers.',
    tagline: 'Projects, invoices, utilization & margin.',
  },
  {
    id: 'fitness_studio',
    label: 'Fitness / Wellness Studio',
    shortLabel: 'Fitness',
    description:
      'Yoga, pilates, and fitness studios with classes, bookings, instructors and packs.',
    tagline: 'Class utilization, pack sales & cancellations.',
  },
];

export const DEFAULT_BUSINESS_TYPE: BusinessTypeId = 'saas';

/**
 * AI guidance per business type
 * These instructions are injected into Milton's system prompt to ensure
 * responses are relevant and avoid suggesting inappropriate metrics.
 */
export const BUSINESS_TYPE_AI_GUIDANCE: Record<BusinessTypeId, string> = {
  saas: [
    'The user runs a SaaS / digital product business.',
    'Prioritize KPIs like MRR, ARR, churn, expansion revenue, CAC, LTV, activation, and pipeline coverage.',
    'Use SaaS concepts when they are clearly relevant, but avoid overcomplicating things for very small teams.',
  ].join(' '),
  agency: [
    'The user runs an agency / service business (consulting, marketing, training, etc.).',
    'Prioritize KPIs like billable utilization, project margin, revenue per client, invoice collection time, and capacity planning.',
    'Avoid talking about MRR/ARR unless the user explicitly mentions retainers or subscriptions.',
  ].join(' '),
  fitness_studio: [
    'The user runs a fitness / wellness studio (e.g. yoga, pilates, boutique fitness).',
    'They typically care about class utilization rate, attendance per class, membership/pack sales, recurring visits per member, cancellation rate, and instructor profitability.',
    'FOCUS on bookings, classes, schedules, instructors, and payments.',
    'DO NOT suggest SaaS metrics like MRR or churn unless the user explicitly tells you they sell recurring subscriptions.',
  ].join(' '),
};

