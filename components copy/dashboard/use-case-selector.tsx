'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Building, Target, TrendingUp, Users } from 'lucide-react'
import { USE_CASES, UseCase, getUseCase } from '@/types/use-cases'

interface UseCaseSelectorProps {
  selectedUseCase: string | null
  onUseCaseSelect: (useCaseId: string) => void
  onConfirm: () => void
}

export function UseCaseSelector({ selectedUseCase, onUseCaseSelect, onConfirm }: UseCaseSelectorProps) {
  const [currentUseCase, setCurrentUseCase] = useState<UseCase | null>(null)

  useEffect(() => {
    if (selectedUseCase) {
      const useCase = getUseCase(selectedUseCase)
      setCurrentUseCase(useCase || null)
    }
  }, [selectedUseCase])

  const handleSelect = (useCaseId: string) => {
    onUseCaseSelect(useCaseId)
    const useCase = getUseCase(useCaseId)
    setCurrentUseCase(useCase || null)
  }

  const getIconForUseCase = (useCaseId: string) => {
    switch (useCaseId) {
      case 'b2b-startup':
        return <Building className="h-6 w-6" />
      case 'restaurant':
        return <Users className="h-6 w-6" />
      case 'ecommerce':
        return <TrendingUp className="h-6 w-6" />
      default:
        return <Target className="h-6 w-6" />
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'financial': return 'bg-blue-100 text-blue-800'
      case 'growth': return 'bg-green-100 text-green-800'
      case 'efficiency': return 'bg-purple-100 text-purple-800'
      case 'pipeline': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-2 border-dashed border-blue-300 bg-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Select Your Business Type
          </CardTitle>
          <CardDescription>
            Choose your business model to get the most relevant metrics and insights. 
            This helps our AI better understand your data structure and calculate the right KPIs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Business Type</label>
              <Select value={selectedUseCase || ''} onValueChange={handleSelect}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select your business type..." />
                </SelectTrigger>
                <SelectContent>
                  {USE_CASES.map((useCase) => (
                    <SelectItem key={useCase.id} value={useCase.id}>
                      <div className="flex items-center gap-2">
                        {getIconForUseCase(useCase.id)}
                        <div>
                          <div className="font-medium">{useCase.name}</div>
                          <div className="text-sm text-gray-500">{useCase.businessModel}</div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {currentUseCase && (
              <div className="mt-6 p-4 bg-white rounded-lg border">
                <div className="flex items-start gap-3 mb-4">
                  {getIconForUseCase(currentUseCase.id)}
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{currentUseCase.name}</h3>
                    <p className="text-gray-600 text-sm mt-1">{currentUseCase.description}</p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="outline">{currentUseCase.industry}</Badge>
                      <Badge variant="outline">{currentUseCase.businessModel}</Badge>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 className="font-medium mb-2">Required Data Types</h4>
                    <div className="space-y-2">
                      {currentUseCase.requiredDataTypes.map((dataType) => (
                        <div key={dataType.id} className="flex items-center gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <span className="font-medium">{dataType.name}</span>
                          <span className="text-gray-500">({dataType.expectedFormats.join(', ')})</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Key Metrics</h4>
                    <div className="space-y-1">
                      {currentUseCase.requiredMetrics
                        .filter(metric => metric.priority === 'core')
                        .slice(0, 6)
                        .map((metric) => (
                        <div key={metric.id} className="flex items-center gap-2 text-sm">
                          <Badge 
                            variant="secondary" 
                            className={`text-xs ${getCategoryColor(metric.category)}`}
                          >
                            {metric.category}
                          </Badge>
                          <span>{metric.name}</span>
                        </div>
                      ))}
                      {currentUseCase.requiredMetrics.filter(m => m.priority === 'core').length > 6 && (
                        <div className="text-xs text-gray-500 mt-1">
                          +{currentUseCase.requiredMetrics.filter(m => m.priority === 'core').length - 6} more metrics
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
                  <h4 className="font-medium text-blue-900 mb-1">AI Enhancement</h4>
                  <p className="text-sm text-blue-800">
                    Our AI will use this business context to better interpret your data files, 
                    identify the correct fields for calculations, and provide industry-specific insights.
                  </p>
                </div>

                <div className="mt-4 flex justify-end">
                  <Button onClick={onConfirm} className="gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Confirm & Continue to Upload
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}