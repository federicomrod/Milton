import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    let { companyId, accepted_kpis } = await req.json()

    // ✅ Initialize resolvedCompanyId safely as null (never a string placeholder)
    let resolvedCompanyId: string | null = companyId ?? null

    if (!accepted_kpis) {
      return NextResponse.json({ error: 'Missing accepted_kpis' }, { status: 400 })
    }

    // Auto-resolve companyId if not provided
    if (!resolvedCompanyId) {
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('created_by', user.id)
        .single()
      resolvedCompanyId = company?.id ?? null
    }

    // Gracefully handle missing company ID
    if (!resolvedCompanyId) {
      console.warn('⚠️ No valid company ID found — skipping Supabase insert in local dev')
      return NextResponse.json(
        { error: 'No valid company ID found' },
        { status: 404 }
      )
    }

    console.log('💾 Using company ID:', resolvedCompanyId)

    // Check if profile exists
    const { data: profile } = await supabase
      .from('kpi_profiles')
      .select('id')
      .eq('company_id', resolvedCompanyId)
      .single()

    if (profile) {
      // Update existing profile
      const { error: updateError } = await supabase
        .from('kpi_profiles')
        .update({ 
          accepted_kpis: JSON.stringify(accepted_kpis),
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id)

      if (updateError) {
        console.error('Update error:', updateError)
        return NextResponse.json({ error: updateError.message ?? 'update_error', details: updateError }, { status: 400 })
      }
    } else {
      // Insert new profile
      const { error: insertError } = await supabase
        .from('kpi_profiles')
        .insert({ 
          company_id: resolvedCompanyId,
          accepted_kpis: JSON.stringify(accepted_kpis),
          user_id: user.id
        })

        if (insertError) {
          console.error('Insert error:', insertError)
          return NextResponse.json({ error: insertError.message ?? 'insert_error', details: insertError }, { status: 400 })
        }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('KPI selection API error:', error)
    return NextResponse.json(
      { error: error?.message ?? 'Failed to save KPIs', details: error },
      { status: 500 }
    )
  }
}
