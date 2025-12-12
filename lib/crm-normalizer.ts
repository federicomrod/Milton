// lib/crm-normalizer.ts
import { CrmMapping, CrmStage, mapStage } from './crm-mapping';
import { normalizeDateValue } from '@/lib/utils';

export interface NormalizedCrmDeal {
  id: string;
  deal_name: string;
  amount: number;
  stage: CrmStage;
  company?: string;
  owner?: string;
  product?: string | null;
  close_date: string | null;
  created_date: string | null;
}

function getString(row: any, key?: string): string | undefined {
  if (!key) return undefined;
  const value = row?.[key];
  return value == null ? undefined : String(value);
}

// Date normalization is now handled by the shared normalizeDateValue function from utils.ts

function normalizeId(value: any): string {
  const str = String(value ?? '').trim();
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(str)) {
    return str;
  }

  return crypto.randomUUID();
}

function normalizeDealName(row: any, id: string): string {
  return (
    row.deal_name ||
    row.name ||
    row.title ||
    (row.company ? `${row.company} – Deal` : null) ||
    `Deal ${id.slice(0, 8)}`
  ).toString();
}

const PRODUCT_COLUMN_CANDIDATES = [
  'product typ',
  'product',
  'product type',
  'product description',
  'service',
  'produkt',
  'produkttyp',
  'produktbeschreibung',
  'dienstleistung',
];

function findProductColumn(row: any): string | null {
  const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
  for (const key of keys) {
    if (PRODUCT_COLUMN_CANDIDATES.includes(key)) {
      return key;
    }
  }
  return null;
}

export function normalizeCrmRow(
  row: any,
  mapping: CrmMapping
): NormalizedCrmDeal {
  const amountRaw = row?.[mapping.amount];
  const amount = typeof amountRaw === 'number'
    ? amountRaw
    : Number(String(amountRaw ?? '').replace(/[^0-9.-]/g, '') || 0);

  const stageRaw = getString(row, mapping.stage) ?? '';
  const stage = mapStage(stageRaw);

  // Extract and normalize dates with multiple fallback column names
  const closeDateRaw = row?.[mapping.closeDate ?? ''] ?? row?.close_date ?? row?.closeDate ?? row?.['Close Date'];
  const createdDateRaw = row?.[mapping.createdDate ?? ''] ?? row?.created_date ?? row?.createdDate ?? row?.['Created Date'];

  // Generate ID first, then use it for deal_name fallback
  const id = normalizeId(
    row.id ??
      row.deal_id ??
      row['Deal ID'] ??
      row['ID'] ??
      row.Id ??
      row.ID
  );

  // Create lowercase version of row for product detection
  const lowerRow = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v])
  );

  // Find product column dynamically
  const productKey = findProductColumn(lowerRow);
  const product = productKey ? String(lowerRow[productKey] || '').trim() || null : null;

  return {
    id,
    deal_name: normalizeDealName(row, id),
    amount,
    stage,
    company: getString(row, mapping.company),
    owner: getString(row, mapping.owner),
    product,
    close_date: normalizeDateValue(closeDateRaw),
    created_date: normalizeDateValue(createdDateRaw),
  };
}

