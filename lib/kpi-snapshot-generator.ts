import { SupabaseClient } from '@supabase/supabase-js'

function monthKey(date: string) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export async function generateUserKpiSnapshots(supabase: SupabaseClient, userId: string) {
  const { data: txs, error } = await supabase
    .from('transactions')
    .select('date, amount')
    .eq('user_id', userId);

  if (error) {
    console.error('[KPI GEN] transactions fetch error', error);
    throw error;
  }

  const monthly = new Map<string, { revenue: number; expenses: number }>();
  txs?.forEach((row: any) => {
    if (!row?.date || row.amount == null) return;
    const key = monthKey(row.date);
    const rec = monthly.get(key) || { revenue: 0, expenses: 0 };
    if (row.amount >= 0) rec.revenue += Number(row.amount);
    else rec.expenses += Math.abs(Number(row.amount));
    monthly.set(key, rec);
  });

  const rows = Array.from(monthly.entries()).map(([period, { revenue, expenses }]) => ({
    user_id: userId,
    period,
    revenue,
    expenses,
    net_income: revenue - expenses,
    burn_rate: revenue - expenses < 0 ? Math.abs(revenue - expenses) : 0,
    cash_runway: null,
  }));

  if (!rows.length) {
    console.warn('[KPI GEN] no rows to insert');
    return { inserted: 0 };
  }

  const { error: upsertError } = await supabase
    .from('kpi_snapshots_data')
    .upsert(rows, { onConflict: 'user_id,period' });

  if (upsertError) {
    console.error('[KPI GEN] upsert error', upsertError);
    throw upsertError;
  }

  console.log(`[KPI GEN] inserted/updated ${rows.length} rows`);
  return { inserted: rows.length };
}
