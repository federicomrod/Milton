// lib/kpi-recipe-service.ts
import { createClient } from '@/lib/supabase/client'

/**
 * Loads KPI recipe definitions for a given business model key
 * from public.business_model_templates.
 */
export async function getKpiRecipes(modelKey: string) {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('business_model_templates')
      .select('kpi_recipes')
      .eq('key', modelKey)
      .limit(1)

    if (error) {
      console.error('[getKpiRecipes] error:', error)
      return []
    }
    return (data && data.length > 0) ? data[0].kpi_recipes || [] : []
  } catch (err) {
    console.error('[getKpiRecipes] unexpected error:', err)
    return []
  }
}
