'use client'
import React from 'react'

export default function CashFlowTab({ data }: { data?: any[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
        <p>💸 No data available for Cash Flow yet.</p>
        <p className="text-xs mt-1">
          Upload your bank transactions and budget files to generate insights.
        </p>
      </div>
    )
  }

  // Existing cash flow chart rendering logic remains untouched here
  return (
    <div>
      {/* Existing visuals for cash flow */}
    </div>
  )
}
