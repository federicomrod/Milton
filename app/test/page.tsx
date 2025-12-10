'use client'

import { useState } from 'react'
import { UseCaseSelector } from '@/components/dashboard/use-case-selector'
import { ReportsTab } from '@/components/dashboard/reports-tab'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function TestPage() {
  const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null)

  const handleUseCaseSelect = (useCaseId: string) => {
    setSelectedUseCase(useCaseId)
  }

  const handleUseCaseConfirm = () => {
    alert('Use case confirmed!')
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-3xl font-bold mb-8 text-center">🧪 COMPONENT TEST PAGE</h1>
      
      {/* Test UseCaseSelector */}
      <Card className="mb-8 border-4 border-red-400 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800">🚨 UseCaseSelector Test</CardTitle>
        </CardHeader>
        <CardContent>
          <UseCaseSelector
            selectedUseCase={selectedUseCase}
            onUseCaseSelect={handleUseCaseSelect}
            onConfirm={handleUseCaseConfirm}
          />
        </CardContent>
      </Card>

      {/* Test ReportsTab */}
      <Card className="mb-8 border-4 border-orange-400 bg-orange-50">
        <CardHeader>
          <CardTitle className="text-orange-800">🟠 ReportsTab Test</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportsTab />
        </CardContent>
      </Card>

      {/* Debug Info */}
      <Card className="border-2 border-blue-400 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-800">Debug Info</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Selected Use Case: <strong>{selectedUseCase || 'null'}</strong></p>
          <Button onClick={() => window.location.reload()}>Reload Page</Button>
        </CardContent>
      </Card>
    </div>
  )
} 