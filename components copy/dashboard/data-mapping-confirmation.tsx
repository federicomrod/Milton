import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  ArrowRight, 
  Eye, 
  Brain,
  RefreshCw,
  Download,
  Settings
} from 'lucide-react'

interface ColumnMapping {
  originalColumn: string
  standardField: string
  confidence: number
  dataType: 'string' | 'number' | 'date' | 'currency'
  transformation?: string
}

interface DataMappingUIProps {
  fileName: string
  fileType: 'transactions' | 'deals' | 'budget'
  headers: string[]
  sampleData: any[]
  suggestedMappings: ColumnMapping[]
  confidence: number
  issues: string[]
  onConfirm: (mappings: ColumnMapping[]) => void
  onCancel: () => void
  onReanalyze?: () => void
}

const STANDARD_FIELDS = {
  transactions: [
    { value: 'date', label: 'Date', description: 'Transaction date', required: true },
    { value: 'amount', label: 'Amount', description: 'Transaction amount', required: true },
    { value: 'description', label: 'Description', description: 'Transaction description', required: false },
    { value: 'category', label: 'Category', description: 'Transaction category', required: false },
    { value: 'reference', label: 'Reference', description: 'Reference number', required: false },
    { value: 'unmapped', label: 'Ignore', description: 'Skip this column', required: false }
  ],
  deals: [
    { value: 'dealName', label: 'Deal Name', description: 'Name of the deal', required: true },
    { value: 'clientName', label: 'Client Name', description: 'Client or company name', required: true },
    { value: 'amount', label: 'Amount', description: 'Deal value', required: false },
    { value: 'phase', label: 'Phase/Stage', description: 'Current deal stage', required: false },
    { value: 'product', label: 'Product', description: 'Product or service', required: false },
    { value: 'firstAppointment', label: 'First Contact', description: 'Date of first contact', required: false },
    { value: 'closingDate', label: 'Closing Date', description: 'Expected closing date', required: false },
    { value: 'unmapped', label: 'Ignore', description: 'Skip this column', required: false }
  ],
  budget: [
    { value: 'category', label: 'Category', description: 'Budget category', required: true },
    { value: 'month_jan', label: 'January', description: 'January values', required: false },
    { value: 'month_feb', label: 'February', description: 'February values', required: false },
    { value: 'month_mar', label: 'March', description: 'March values', required: false },
    { value: 'month_apr', label: 'April', description: 'April values', required: false },
    { value: 'month_may', label: 'May', description: 'May values', required: false },
    { value: 'month_jun', label: 'June', description: 'June values', required: false },
    { value: 'unmapped', label: 'Ignore', description: 'Skip this column', required: false }
  ]
}

export default function EnhancedDataMappingUI({
  fileName,
  fileType,
  headers,
  sampleData,
  suggestedMappings,
  confidence,
  issues,
  onConfirm,
  onCancel,
  onReanalyze
}: DataMappingUIProps) {
  const [mappings, setMappings] = useState<ColumnMapping[]>(suggestedMappings)
  const [activeTab, setActiveTab] = useState('mappings')
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const standardFields = STANDARD_FIELDS[fileType] || []

  useEffect(() => {
    validateMappings()
  }, [mappings])

  const validateMappings = () => {
    const errors = []
    const mappedFields = mappings.map(m => m.standardField).filter(f => f !== 'unmapped')
    const requiredFields = standardFields.filter(f => f.required)

    // Check for required fields
    for (const required of requiredFields) {
      if (!mappedFields.includes(required.value)) {
        errors.push(`Required field "${required.label}" is not mapped`)
      }
    }

    // Check for duplicate mappings
    const duplicates = mappedFields.filter((field, index, arr) => 
      arr.indexOf(field) !== index && field !== 'unmapped'
    )
    if (duplicates.length > 0) {
      errors.push(`Duplicate mappings found: ${duplicates.join(', ')}`)
    }

    setValidationErrors(errors)
  }

  const updateMapping = (originalColumn: string, standardField: string) => {
    setMappings(prev => prev.map(mapping =>
      mapping.originalColumn === originalColumn
        ? { ...mapping, standardField, confidence: 1.0 }
        : mapping
    ))
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-50'
    if (confidence >= 0.6) return 'text-yellow-600 bg-yellow-50'
    return 'text-red-600 bg-red-50'
  }

  const getConfidenceBadge = (confidence: number) => {
    const percentage = Math.round(confidence * 100)
    if (confidence >= 0.8) return <Badge className="bg-green-100 text-green-800">{percentage}%</Badge>
    if (confidence >= 0.6) return <Badge className="bg-yellow-100 text-yellow-800">{percentage}%</Badge>
    return <Badge className="bg-red-100 text-red-800">{percentage}%</Badge>
  }

  const previewMappedData = () => {
    return sampleData.slice(0, 5).map((row, index) => {
      const mapped: any = { _index: index + 1 }
      mappings.forEach(mapping => {
        if (mapping.standardField !== 'unmapped') {
          mapped[mapping.standardField] = row[mapping.originalColumn] || ''
        }
      })
      return mapped
    })
  }

  const isValid = validationErrors.length === 0

  return (
    <Dialog open={true} onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Data Mapping - {fileName}
            <Badge variant={confidence > 0.8 ? 'default' : 'secondary'}>
              {fileType.toUpperCase()}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col h-full">
          {/* Status Bar */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                <span className="text-sm">AI Confidence:</span>
                {getConfidenceBadge(confidence)}
              </div>
              <div className="text-sm text-gray-600">
                {headers.length} columns • {sampleData.length} sample rows
              </div>
            </div>
            <div className="flex gap-2">
              {onReanalyze && (
                <Button variant="outline" size="sm" onClick={onReanalyze}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Re-analyze
                </Button>
              )}
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-1" />
                Export Template
              </Button>
            </div>
          </div>

          {/* Issues Alert */}
          {(issues.length > 0 || validationErrors.length > 0) && (
            <Alert className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  {issues.map((issue, idx) => (
                    <div key={idx} className="text-sm">• {issue}</div>
                  ))}
                  {validationErrors.map((error, idx) => (
                    <div key={idx} className="text-sm text-red-600">• {error}</div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Main Content Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="mappings">Column Mappings</TabsTrigger>
              <TabsTrigger value="preview">Data Preview</TabsTrigger>
              <TabsTrigger value="validation">Validation</TabsTrigger>
            </TabsList>

            <TabsContent value="mappings" className="flex-1 overflow-y-auto space-y-3">
              <div className="grid gap-3">
                {mappings.map((mapping, index) => (
                  <Card key={index} className={`${getConfidenceColor(mapping.confidence)} border-l-4`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 flex-1">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-sm font-medium truncate">
                              {mapping.originalColumn}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Data Type: {mapping.dataType}
                            </div>
                          </div>
                          
                          <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          
                          <div className="min-w-0 flex-1">
                            <Select
                              value={mapping.standardField}
                              onValueChange={(value) => updateMapping(mapping.originalColumn, value)}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {standardFields.map(field => (
                                  <SelectItem key={field.value} value={field.value}>
                                    <div className="flex items-center gap-2">
                                      <span className={field.required ? 'font-medium' : ''}>
                                        {field.label}
                                      </span>
                                      {field.required && <span className="text-red-500">*</span>}
                                    </div>
                                    <div className="text-xs text-gray-500">{field.description}</div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {getConfidenceBadge(mapping.confidence)}
                        </div>
                      </div>
                      
                      {/* Sample Data Preview */}
                      <div className="mt-3 pt-3 border-t">
                        <div className="text-xs text-gray-500 mb-1">Sample values:</div>
                        <div className="text-sm font-mono bg-white p-2 rounded border max-h-16 overflow-y-auto">
                          {sampleData.slice(0, 3).map((row, idx) => (
                            <div key={idx} className="truncate">
                              {row[mapping.originalColumn] || '(empty)'}
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="preview" className="flex-1 overflow-hidden">
              <div className="h-full flex flex-col">
                <div className="mb-4">
                  <h3 className="font-medium">Mapped Data Preview</h3>
                  <p className="text-sm text-gray-600">
                    Preview of how your data will look after applying the mappings
                  </p>
                </div>
                
                <div className="flex-1 overflow-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="p-2 text-left font-medium w-12">#</th>
                        {mappings
                          .filter(m => m.standardField !== 'unmapped')
                          .map(mapping => (
                            <th key={mapping.standardField} className="p-2 text-left font-medium min-w-32">
                              {mapping.standardField}
                              <div className="text-xs font-normal text-gray-500">
                                ← {mapping.originalColumn}
                              </div>
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewMappedData().map((row, idx) => (
                        <tr key={idx} className="border-t hover:bg-gray-50">
                          <td className="p-2 text-gray-500">{row._index}</td>
                          {mappings
                            .filter(m => m.standardField !== 'unmapped')
                            .map(mapping => (
                              <td key={mapping.standardField} className="p-2">
                                <div className="truncate max-w-48" title={row[mapping.standardField]}>
                                  {row[mapping.standardField] || '(empty)'}
                                </div>
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="validation" className="flex-1 overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Mapping Summary</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Total Columns:</span>
                      <span className="ml-2 font-medium">{headers.length}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Mapped Columns:</span>
                      <span className="ml-2 font-medium">
                        {mappings.filter(m => m.standardField !== 'unmapped').length}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Required Fields:</span>
                      <span className="ml-2 font-medium">
                        {standardFields.filter(f => f.required).length}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Validation Status:</span>
                      <span className={`ml-2 font-medium ${isValid ? 'text-green-600' : 'text-red-600'}`}>
                        {isValid ? 'Valid' : 'Invalid'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Required Fields Status</h3>
                  <div className="space-y-2">
                    {standardFields.filter(f => f.required).map(field => {
                      const isMapped = mappings.some(m => m.standardField === field.value)
                      return (
                        <div key={field.value} className="flex items-center gap-2">
                          {isMapped ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                          <span className={isMapped ? 'text-green-700' : 'text-red-700'}>
                            {field.label}
                          </span>
                          <span className="text-gray-500 text-sm">- {field.description}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {validationErrors.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2 text-red-600">Validation Errors</h3>
                    <div className="space-y-1">
                      {validationErrors.map((error, idx) => (
                        <div key={idx} className="text-sm text-red-600 flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3" />
                          {error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-4 border-t">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            
            <div className="flex gap-2">
              <Button variant="outline">
                <Settings className="h-4 w-4 mr-1" />
                Save Template
              </Button>
              <Button 
                onClick={() => onConfirm(mappings)}
                disabled={!isValid}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Apply Mapping ({mappings.filter(m => m.standardField !== 'unmapped').length} fields)
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}