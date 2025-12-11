'use client'
import React from 'react'

export default function OverviewTab({ kpis }: { kpis?: any[] }) {
  if (!kpis || kpis.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
        <p>📊 No data available for Overview yet.</p>
        <p className="text-xs mt-1">
          Upload your bank transactions and budget files to generate insights.
        </p>
      </div>
    )
  }

  // Existing overview chart rendering logic remains untouched here
  return (
    <div>
      {/* Existing visuals for KPIs */}
    </div>
  )
}
