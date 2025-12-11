'use client'

import { ReportsTab } from '@/components/dashboard/reports-tab'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText } from 'lucide-react'

export default function ReportingPage() {
  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Reporting</h1>
          </div>
          <p className="text-gray-600">
            Generate professional PDF reports with AI-powered insights, financial charts, and KPI summaries
          </p>
        </div>

        {/* Reports Generation Component */}
        <ReportsTab />
      </div>
    </div>
  )
}

