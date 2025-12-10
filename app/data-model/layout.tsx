// app/data-model/layout.tsx
'use client'
import React from 'react'
import MiltonChat from '@/components/dashboard/miltonchat'

export default function DataModelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Main data-model workspace */}
      <div className="flex-1 overflow-auto bg-gray-50 p-4">
        <div className="h-full min-h-[90vh] flex flex-col">
          {/* Ensure that the DataModel graph (children) is visible and scrollable */}
          <div className="flex-1 overflow-visible relative">{children}</div>
        </div>
      </div>

      {/* Milton fixed sidebar */}
      <aside className="w-[400px] border-l bg-white shadow-inner flex flex-col">
        <MiltonChat />
      </aside>
    </div>
  )
}
