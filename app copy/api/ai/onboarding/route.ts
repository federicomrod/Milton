import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  try {
    // 1. Authenticate the user
    let userId: string | null = null

    try {
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id || null
    } catch (err) {
      console.warn('Auth check failed, bypassing for local test')
    }
    
    // 🔓 Always allow requests through in local/dev mode
    if (!userId) {
      console.warn('⚠️ Bypassing Supabase auth (local dev mode)')
    }

    // 2. Parse request body
    const { companyId, industry, employees, goals } = await req.json()
 

    // 3. Resolve missing company ID (fallback)
    let resolvedCompanyId = companyId || 'mock-company-id'

    // Only attempt Supabase lookup if we actually have a userId
    // Only attempt lookup if we have a valid userId
    if (!resolvedCompanyId && userId) {
        const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('created_by', userId)
        .single()
        resolvedCompanyId = company?.id
    }
    
    // 🔧 Local/dev mode: ensure we never exit early
    if (!resolvedCompanyId) {
        console.warn('No company found — continuing with mock data for local dev')
        resolvedCompanyId = 'mock-company-id'
    }

    // 4. (Mock) AI-generated KPI recommendations
    const mockResponse = {
      recommended_kpis: [
        { name: 'Monthly Recurring Revenue (MRR)', why: 'Tracks recurring income from members', category: 'Revenue' },
        { name: 'Customer Retention Rate', why: 'Shows how loyal your members are', category: 'Customer' },
        { name: 'Cash Burn Rate', why: 'Measures spending vs cash on hand', category: 'Cash' },
        { name: 'Occupancy Rate', why: 'Indicates class utilization efficiency', category: 'Operations' },
      ],
      peers_focus: ['ARPM', 'Churn', 'CAC', 'Utilization'],
    }

    // 5. Return JSON response
    console.log('✅ Returning mock KPI response');
    return NextResponse.json(mockResponse, { status: 200 })
  } catch (error) {
    console.error('Error in /api/ai/onboarding:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}