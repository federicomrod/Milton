import { createClient } from "@/lib/supabase/client";

export interface KpiTarget {
  id: string;
  user_id: string;
  model_id: string;
  kpi_key: string;
  period: string;
  value: number;
  label: string;
  created_at: string;
  updated_at: string;
}

export async function getTargetsForModel(
  modelId: string
): Promise<KpiTarget[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("kpi_targets")
    .select("*")
    .eq("model_id", modelId)
    .order("kpi_key")
    .order("period");

  if (error) throw error;
  return data ?? [];
}

export async function getTargetsForKpi(
  modelId: string,
  kpiKey: string
): Promise<KpiTarget[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("kpi_targets")
    .select("*")
    .eq("model_id", modelId)
    .eq("kpi_key", kpiKey)
    .order("period");

  if (error) throw error;
  return data ?? [];
}

export async function upsertTarget(
  modelId: string,
  kpiKey: string,
  period: string,
  value: number,
  label = "Target"
): Promise<KpiTarget> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("kpi_targets")
    .upsert(
      {
        user_id: user.id,
        model_id: modelId,
        kpi_key: kpiKey,
        period,
        value,
        label,
      },
      { onConflict: "user_id,model_id,kpi_key,period,label" }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function upsertBulkTargets(
  targets: Array<{
    modelId: string;
    kpiKey: string;
    period: string;
    value: number;
  }>
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const rows = targets.map(({ modelId, kpiKey, period, value }) => ({
    user_id: user.id,
    model_id: modelId,
    kpi_key: kpiKey,
    period,
    value,
    label: "Target",
  }));

  const { error } = await supabase
    .from("kpi_targets")
    .upsert(rows, { onConflict: "user_id,model_id,kpi_key,period,label" });

  if (error) throw error;
}

export async function deleteTarget(targetId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("kpi_targets")
    .delete()
    .eq("id", targetId);

  if (error) throw error;
}

export async function deleteTargetsForKpi(
  modelId: string,
  kpiKey: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("kpi_targets")
    .delete()
    .eq("model_id", modelId)
    .eq("kpi_key", kpiKey);

  if (error) throw error;
}
