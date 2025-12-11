"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export default function DebugInsertPage() {
  const [result, setResult] = useState<any>(null)
  const supabase = createClient()

  useEffect(() => {
    async function testInsert() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setResult("❌ No authenticated user")
        return
      }

      const { data, error } = await supabase
        .from("transactions")
        .insert([{
          user_id: user.id,
          date: "2025-01-15",
          name: "Debug Insert",
          description: "Manual test transaction",
          amount: 123.45,
          category: "Revenue",
          reference: "DEBUG-001"
        }])

      setResult({ data, error })
    }
    testInsert()
  }, [])

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold mb-4">Debug Insert Result</h1>
      <pre className="bg-gray-100 p-4 rounded">
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  )
}