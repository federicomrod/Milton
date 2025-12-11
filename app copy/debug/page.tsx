// app/debug/page.tsx
"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export default function DebugPage() {
  const [status, setStatus] = useState<any>(null)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()

      let transactions: any[] = []
      let deals: any[] = []
      let budgets: any[] = []

      if (user) {
        // Try Supabase
        const { data: t } = await supabase.from("transactions").select("*").limit(5)
        const { data: d } = await supabase.from("crm_deals").select("*").limit(5)
        const { data: b } = await supabase.from("budgets").select("*").limit(5)
        transactions = t || []
        deals = d || []
        budgets = b || []
      } else {
        // Fallback to localStorage cache
        transactions = JSON.parse(localStorage.getItem("transactions") || "[]")
        deals = JSON.parse(localStorage.getItem("crmDeals") || "[]")
        budgets = JSON.parse(localStorage.getItem("budget") || "[]")
      }

      setStatus({
        user,
        transactionsCount: transactions.length,
        dealsCount: deals.length,
        budgetsCount: budgets.length,
        sampleTransactions: transactions.slice(0, 2),
        sampleDeals: deals.slice(0, 2),
        sampleBudgets: budgets.slice(0, 2),
      })
    }

    load()
  }, [])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Debug Info</h1>
      <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto">
        {JSON.stringify(status, null, 2)}
      </pre>
    </div>
  )
}