'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import MiltonChat from '@/app/onboarding/components/MiltonChat'
import { createClient } from '@/lib/supabase/client'
import { generateBusinessModel } from '@/lib/onboarding/business-model-service'

type KPI = { name: string; why: string; category: string }

export default function OnboardingPage() {
  const [recommendedKPIs, setRecommendedKPIs] = useState<KPI[]>([])
  const [selectedKPIs, setSelectedKPIs] = useState<KPI[]>([])
  const [peersFocus, setPeersFocus] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyInfo, setCompanyInfo] = useState<any>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [miltonMessages, setMiltonMessages] = useState<{ from: 'milton' | 'user'; text: string }[]>([])
  const router = useRouter()

  // Fetch company ID on mount
  useEffect(() => {
    const supabase = createClient()
    
    async function fetchCompany() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: company } = await supabase
          .from('companies')
          .select('id')
          .eq('created_by', user.id)
          .single()

        if (company) {
          localStorage.setItem('companyId', company.id)
          setCompanyId(company.id)
        }
      }
    }
    fetchCompany()
  }, [])

  const handleOnboardingFinish = useCallback(async (answers: { industry: string; employees: string; goals: string }) => {
    console.log('🟩 Milton finished onboarding with answers:', answers)
    setLoading(true)
    setMiltonMessages(prev => [
      ...prev,
      { from: 'milton', text: 'Analyzing your business model to prepare tailored KPIs...' }
    ])
    setError(null)
    setCompanyInfo(answers)

    try {
      // Generate AI business model proposal
      console.log('🧠 Generating business model for:', answers)
      const businessDescription = `Industry: ${answers.industry}, Employees: ${answers.employees}, Goals: ${answers.goals}`

      setMiltonMessages(prev => [
        ...prev,
        { from: 'milton', text: 'Analyzing your business model with AI...' }
      ])

      // Call the new API endpoint for business model analysis
      const response = await fetch('/api/ai/business-model-analyzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDescription })
      })

      if (!response.ok) {
        throw new Error(`Business model analysis failed: ${response.status}`)
      }

      const proposal = await response.json()

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { error: modelError } = await supabase
          .from('business_models')
          .upsert({ user_id: user.id, model_json: proposal })
        if (modelError) throw modelError
        try {
          localStorage.setItem('milton-model', JSON.stringify(proposal))
          console.log('✅ Business model stored successfully')
          // Do NOT redirect here - let user complete KPI selection first
        } catch (storageErr) {
          console.warn('LocalStorage write failed:', storageErr)
        }
      }

      setMiltonMessages(prev => [
        ...prev,
        { from: 'milton', text: '✅ Business model analysis completed successfully.' }
      ])

      // Existing generateBusinessModel call (kept as is)
      const model = await generateBusinessModel(businessDescription)

      console.log('✅ Business model stored successfully')
    } catch (err) {
      console.error('Error generating business model:', err)
      setMiltonMessages(prev => [
        ...prev,
        { from: 'milton', text: '⚠️ Couldn’t analyze your business model — continuing with KPIs anyway.' }
      ])
      // Continue flow even if AI model creation fails
    }

    if (!companyId) {
      console.warn('Company ID missing, skipping KPI fetch until available.')
      setMiltonMessages(prev => [
        ...prev,
        { from: 'milton', text: 'Company ID not found yet — skipping KPI analysis for now.' }
      ])
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/ai/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: companyId,
          industry: answers.industry,
          employees: Number(answers.employees || 0),
          goals: answers.goals
        })
      })

      if (!res.ok) {
        throw new Error(`Failed to fetch onboarding data: ${res.status}`)
      }

      const data = await res.json()
      setRecommendedKPIs(data.recommended_kpis || [])
      setPeersFocus(data.peers_focus || [])
    } catch (err) {
      console.error('Failed to load KPIs:', err)
      setError('Milton couldn\'t load KPI data. Please try again later.')
    } finally {
      setLoading(false)
    }
  }, [companyId, router])

  const toggleKPISelection = useCallback((kpi: KPI) => {
    setSelectedKPIs(prev => {
      const isSelected = prev.some(k => k.name === kpi.name)
      if (isSelected) {
        return prev.filter(k => k.name !== kpi.name)
      } else {
        return [...prev, kpi]
      }
    })
  }, [])

  async function saveSelectedKPIs() {
    try {
      const res = await fetch('/api/kpis/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,                  // whatever you store in state
          accepted_kpis: selectedKPIs.map(k => k.name), // or however you store them
        }),
      })
  
      // If server returns details, surface them for debugging
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        console.error('KPI save failed:', res.status, err)
        throw new Error(`Save failed: ${res.status}`)
      }
  
      // Show Milton-style message instead of browser alert
      setMiltonMessages(prev => [
        ...prev,
        { from: 'milton', text: '✅ KPIs saved successfully! Redirecting you to your Data Model Builder...' }
      ])

      // Wait 1 second, then navigate to model builder
      setTimeout(() => {
        router.push('/dashboard/model')
      }, 1000)
    } catch (err) {
      console.error('Falling back to local storage. Reason:', err)
      // ✅ Pragmatic unblock: persist locally, continue flow
      try {
        localStorage.setItem('selectedKPIs', JSON.stringify(selectedKPIs))
      } catch {}
      alert('KPIs saved locally for now. Redirecting to your Data Model Builder…')
      router.push('/dashboard/model')
    }
  }

  // Memoize MiltonChat to prevent re-renders when KPI state updates
  const memoizedMiltonChat = useMemo(
    () => (
      <MiltonChat
        onFinish={handleOnboardingFinish}
        messages={miltonMessages}
        setMessages={setMiltonMessages}
      />
    ),
    [handleOnboardingFinish, miltonMessages]
  )

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Left: Milton Chat */}
      <div className="w-3/5 border-r bg-white shadow-sm flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-semibold text-gray-800">Welcome to Milton</h1>
          <p className="text-gray-500 text-sm">Your AI-powered finance copilot</p>
        </div>
        <div className="flex-1 overflow-auto">
          {memoizedMiltonChat}
        </div>
      </div>

      {/* Right: KPI Recommendation Panel */}
      <div className="w-2/5 p-8 flex flex-col items-center justify-center bg-gray-50 overflow-auto">
        <Card className="p-6 w-full max-w-md text-center">
          {error ? (
            <>
              <h2 className="text-xl font-semibold mb-4 text-red-600">Error</h2>
              <p className="text-gray-600 mb-4">{error}</p>
              <Button 
                onClick={() => {
                  setError(null)
                  setRecommendedKPIs([])
                  setPeersFocus([])
                }}
                variant="outline"
              >
                Try Again
              </Button>
            </>
          ) : !loading && recommendedKPIs.length === 0 ? (
            <>
              <h2 className="text-xl font-semibold mb-4 text-gray-700">KPI Recommendations</h2>
              <p className="text-gray-500">
                Once Milton learns about your business, KPI suggestions will appear here.
              </p>
            </>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center text-gray-500">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent mb-3"></div>
              <p>Analyzing your business model...</p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-4 text-gray-700">Recommended KPIs</h2>
              {recommendedKPIs.length > 0 && (
                <p className="text-sm text-gray-500 mb-2">
                  Click on at least three KPIs that matter most to you.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 text-left">
                {recommendedKPIs.map((k, i) => {
                  const isSelected = selectedKPIs.some(sk => sk.name === k.name)
                  return (
                    <div
                      key={i}
                      onClick={() => toggleKPISelection(k)}
                      className={`cursor-pointer rounded-2xl border p-3 bg-white shadow-sm ${
                        isSelected 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200'
                      }`}
                    >
                      <div className="text-sm uppercase opacity-60">{k.category}</div>
                      <div className="font-medium">{k.name}</div>
                      <div className="text-sm opacity-80">{k.why}</div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-6 text-left">
                <p className="font-semibold mb-2 text-gray-700">Peers focus on:</p>
                <div className="flex flex-wrap gap-2">
                  {peersFocus.map((p, i) => (
                    <span key={i} className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-sm">{p}</span>
                  ))}
                </div>
              </div>
              <Button 
                className="mt-6 w-full" 
                disabled={selectedKPIs.length < 3}
                onClick={saveSelectedKPIs}
              >
                {selectedKPIs.length < 3
                  ? `Select at least ${3 - selectedKPIs.length} more KPI${3 - selectedKPIs.length > 1 ? 's' : ''}`
                  : 'Confirm My KPIs'}
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}