// app/api/ai/business-model-analyzer/route.ts
// AI-powered business model schema generation and refinement

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { openai } from '@/lib/openai-client';
import type {
  BusinessModelAnalyzerInput,
  AnalyzerDatasetSample,
  BusinessTypeId,
  ModelProposal,
} from '@/lib/ai/business-model-analyzer-types';

// Fitness studio default model as fallback
const FITNESS_STUDIO_FALLBACK: ModelProposal = {
  businessType: 'fitness_studio',
  recommendedTables: [
    {
      name: 'Customers',
      fields: [
        { name: 'customer_id', type: 'string', primaryKey: true },
        { name: 'name', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'phone', type: 'string', nullable: true },
        { name: 'join_date', type: 'date' },
        { name: 'status', type: 'string' },
      ],
    },
    {
      name: 'Classes',
      fields: [
        { name: 'class_id', type: 'string', primaryKey: true },
        { name: 'class_name', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'capacity', type: 'integer' },
        { name: 'duration_minutes', type: 'integer' },
        { name: 'price', type: 'number' },
      ],
    },
    {
      name: 'Instructors',
      fields: [
        { name: 'instructor_id', type: 'string', primaryKey: true },
        { name: 'name', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'hourly_rate', type: 'number' },
        { name: 'specialization', type: 'string', nullable: true },
      ],
    },
    {
      name: 'Bookings',
      fields: [
        { name: 'booking_id', type: 'string', primaryKey: true },
        { name: 'customer_id', type: 'string', references: { table: 'Customers', field: 'customer_id' } },
        { name: 'class_id', type: 'string', references: { table: 'Classes', field: 'class_id' } },
        { name: 'instructor_id', type: 'string', references: { table: 'Instructors', field: 'instructor_id' } },
        { name: 'booking_time', type: 'date' },
        { name: 'status', type: 'string' },
      ],
    },
    {
      name: 'Payments',
      fields: [
        { name: 'payment_id', type: 'string', primaryKey: true },
        { name: 'customer_id', type: 'string', references: { table: 'Customers', field: 'customer_id' } },
        { name: 'booking_id', type: 'string', nullable: true, references: { table: 'Bookings', field: 'booking_id' } },
        { name: 'amount', type: 'number' },
        { name: 'payment_date', type: 'date' },
        { name: 'payment_method', type: 'string', nullable: true },
      ],
    },
  ],
  relationships: [
    { from: 'Bookings.customer_id', to: 'Customers.customer_id' },
    { from: 'Bookings.class_id', to: 'Classes.class_id' },
    { from: 'Bookings.instructor_id', to: 'Instructors.instructor_id' },
    { from: 'Payments.customer_id', to: 'Customers.customer_id' },
    { from: 'Payments.booking_id', to: 'Bookings.booking_id' },
  ],
};

function buildSystemPrompt(businessType: BusinessTypeId): string {
  return [
    'You are Milton, an AI data architect for small businesses.',
    'Your job is to propose a JSON data model (ModelProposal) for the given business type.',
    'The JSON MUST strictly match this TypeScript shape:',
    '',
    'interface ModelProposal {',
    '  businessType: "saas" | "agency" | "fitness_studio";',
    '  recommendedTables: {',
    '    name: string;',
    '    fields: {',
    '      name: string;',
    '      type: "string" | "number" | "integer" | "boolean" | "date";',
    '      primaryKey?: boolean;',
    '      nullable?: boolean;',
    '      references?: { table: string; field?: string } | null;',
    '    }[];',
    '  }[];',
    '  relationships: {',
    '    from: string;  // e.g. "Bookings.customer_id"',
    '    to: string;    // e.g. "Customers.customer_id"',
    '  }[];',
    '}',
    '',
    'Output ONLY valid JSON, without explanations or markdown code fences.',
  ].join('\n');
}

function buildUserPrompt(
  businessType: BusinessTypeId,
  datasets: AnalyzerDatasetSample[],
  currentModel: unknown
): string {
  const parts: string[] = [];

  parts.push(
    `The business type is "${businessType}".`,
    'You will receive sample rows from uploaded files. Use them to infer table names, fields, and relationships.'
  );

  if (businessType === 'fitness_studio') {
    parts.push(
      'This is a fitness / wellness studio (e.g. yoga studio).',
      'Typical entities: Customers/Members, Instructors, Classes, Bookings, Payments.',
      'Important relationships: Bookings link Customers to Classes and Instructors; Payments link Customers (and optionally Bookings).',
      'Use these exact table names: Customers, Classes, Instructors, Bookings, Payments.'
    );
  } else if (businessType === 'saas') {
    parts.push(
      'This is a SaaS / digital product business.',
      'Typical entities: Customers, Subscriptions, Invoices, CRM Deals, Usage Events.'
    );
  } else if (businessType === 'agency') {
    parts.push(
      'This is an agency / services business.',
      'Typical entities: Clients, Projects, Invoices, Time Entries, Team Members.'
    );
  }

  if (currentModel) {
    parts.push(
      'Here is the current model JSON (if present). Refine or extend it instead of discarding it:',
      JSON.stringify(currentModel, null, 2)
    );
  }

  if (datasets.length > 0) {
    parts.push('Here are the uploaded datasets with sample rows:');

    for (const ds of datasets) {
      parts.push(
        `\nDataset: ${ds.sourceName ?? 'Unnamed'}`,
        ds.tableHint ? `Table hint: ${ds.tableHint}` : ''
      );
      parts.push(JSON.stringify(ds.sampleRows.slice(0, 5), null, 2));
    }
  } else {
    parts.push('No datasets were provided. Propose a sensible default model for this business type.');
  }

  parts.push(
    '',
    'Return a ModelProposal JSON that uses clear, human-readable English table and field names.',
    'Do NOT include any extra keys not in the ModelProposal type.',
    'Remember: output must be pure JSON without markdown code fences.'
  );

  return parts.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BusinessModelAnalyzerInput;

    if (!body || !body.businessType) {
      return NextResponse.json(
        { success: false, error: 'Missing businessType' },
        { status: 400 }
      );
    }

    const { businessType, datasets = [], currentModel } = body;

    // Validate businessType
    const validTypes: BusinessTypeId[] = ['saas', 'agency', 'fitness_studio'];
    if (!validTypes.includes(businessType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid businessType' },
        { status: 400 }
      );
    }

    // Optional: ensure user is authenticated
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Build the prompts
    const systemPrompt = buildSystemPrompt(businessType);
    const userPrompt = buildUserPrompt(businessType, datasets, currentModel);

    console.log('[business-model-analyzer] Calling OpenAI for businessType:', businessType);

    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = chatCompletion.choices?.[0]?.message?.content ?? '';

    let parsed: ModelProposal | null = null;
    try {
      // Strip markdown code fences if present
      const cleaned = raw
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned) as ModelProposal;
    } catch (err) {
      console.error('[business-model-analyzer] Failed to parse JSON', err);
      console.error('[business-model-analyzer] Raw response:', raw);
    }

    if (!parsed || !parsed.recommendedTables || !Array.isArray(parsed.recommendedTables)) {
      console.warn('[business-model-analyzer] Invalid model structure, using fallback');
      
      // Return appropriate fallback based on business type
      const fallback: ModelProposal =
        businessType === 'fitness_studio'
          ? FITNESS_STUDIO_FALLBACK
          : {
              businessType,
              recommendedTables: [],
              relationships: [],
            };

      return NextResponse.json(
        { success: true, proposal: fallback, warning: 'Returned fallback model due to parsing error' },
        { status: 200 }
      );
    }

    // Ensure the businessType field is set correctly
    parsed.businessType = businessType;

    console.log('[business-model-analyzer] Successfully generated model with', parsed.recommendedTables.length, 'tables');

    return NextResponse.json(
      {
        success: true,
        proposal: parsed,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[business-model-analyzer] Unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'Unexpected error' },
      { status: 500 }
    );
  }
}
