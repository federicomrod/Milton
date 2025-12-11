'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select'
import { 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  ArrowRight,
  Eye
} from 'lucide-react'
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface ColumnMapping {
  original: string
  standardField: string
  confidence: number
  detected: boolean
}

interface DataStructure {
  type: 'single-category' | 'multi-category' | 'unknown'
  language: 'en' | 'de' | 'unknown'
  dateFormat: string
  currencySymbol: string
  amountColumn: string
  dateColumn: string
  descriptionColumn: string
  categoryMapping: ColumnMapping[]
}

interface DetectionResult {
  structure: DataStructure
  sampleData: any[]
  suggestedMappings: ColumnMapping[]
  needsUserConfirmation: boolean
}

interface DataMappingConfirmationProps {
  detectionResult: DetectionResult
  fileName: string
  onConfirm: (confirmedMappings: ColumnMapping[], structure: DataStructure) => void
  onCancel: () => void
}

const standardFieldOptions = [
  { value: 'date', label: 'Date', description: 'Transaction date' },
  { value: 'amount', label: 'Amount', description: 'Transaction amount' },
  { value: 'description', label: 'Description', description: 'Transaction description/name' },
  { value: 'category', label: 'Category', description: 'Transaction category' },
  { value: 'reference', label: 'Reference', description: 'Transaction reference/ID' },
  { value: 'ignore', label: 'Ignore', description: 'Skip this column' }
]

export function DataMappingConfirmation({ 
  detectionResult, 
  fileName, 
  onConfirm, 
  onCancel 
}: DataMappingConfirmationProps) {
  const [mappings, setMappings] = useState<ColumnMapping[]>(detectionResult.suggestedMappings)
  const [structure, setStructure] = useState<DataStructure>(detectionResult.structure)
  const [showPreview, setShowPreview] = useState(false)

  const availableColumns = Object.keys(detectionResult.sampleData[0] || {})

  const updateMapping = (original: string, newStandardField: string) => {
    setMappings(prev => prev.map(mapping => 
      mapping.original === original 
        ? { ...mapping, standardField: newStandardField, confidence: 1.0, detected: true }
        : mapping
    ))
  }

  const addMapping = (original: string, standardField: string) => {
    setMappings(prev => [...prev, {
      original,
      standardField,
      confidence: 1.0,
      detected: true
    }])
  }

  const removeMapping = (original: string) => {
    setMappings(prev => prev.filter(mapping => mapping.original !== original))
  }

  const updateStructure = (field: keyof DataStructure, value: any) => {
    setStructure(prev => ({ ...prev, [field]: value }))
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600'
    if (confidence >= 0.6) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) return <Badge variant="default" className="bg-green-100 text-green-800">High</Badge>
    if (confidence >= 0.6) return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Medium</Badge>
    return <Badge variant="destructive" className="bg-red-100 text-red-800">Low</Badge>
  }

  const isValid = () => {
    const requiredFields = ['date', 'amount']
    return requiredFields.every(field => 
      mappings.some(mapping => mapping.standardField === field)
    )
  }

  const getMappedColumns = () => {
    return mappings.map(m => m.original)
  }

  const getUnmappedColumns = () => {
    return availableColumns.filter(col => !getMappedColumns().includes(col))
  }

  const handleConfirm = () => {
    onConfirm(mappings, structure)
  }

  const previewNormalizedData = () => {
    // Show how the first few rows would look after normalization
    return detectionResult.sampleData.slice(0, 3).map((row, index) => {
      const normalized: any = {}
      mappings.forEach(mapping => {
        if (mapping.standardField !== 'ignore') {
          normalized[mapping.standardField] = row[mapping.original]
        }
      })
      return { ...normalized, _rowIndex: index }
    })
  }

  return (
    <div className="space-y-6">
      {/* File Info Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Data Mapping Confirmation
          </CardTitle>
          <CardDescription>
            File: <strong>{fileName}</strong> | 
            Detected: {structure.language.toUpperCase()} language, {structure.type} structure
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Detection Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Detection Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium">Language</label>
              <Select value={structure.language} onValueChange={(value) => updateStructure('language', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Structure Type</label>
              <Select value={structure.type} onValueChange={(value) => updateStructure('type', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single-category">Single Category Column</SelectItem>
                  <SelectItem value="multi-category">Multiple Category Columns</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Date Format</label>
              <Select value={structure.dateFormat} onValueChange={(value) => updateStructure('dateFormat', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  <SelectItem value="DD.MM.YYYY">DD.MM.YYYY</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="DD-MM-YYYY">DD-MM-YYYY</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Currency</label>
              <Select value={structure.currencySymbol} onValueChange={(value) => updateStructure('currencySymbol', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="€">€ (Euro)</SelectItem>
                  <SelectItem value="$">$ (Dollar)</SelectItem>
                  <SelectItem value="£">£ (Pound)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Column Mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Column Mappings</CardTitle>
          <CardDescription>
            Review and adjust how your data columns map to our standard fields
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Mappings */}
          <div className="space-y-3">
            <h4 className="font-medium">Current Mappings</h4>
            {mappings.map((mapping, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="font-mono text-sm bg-white px-2 py-1 rounded border">
                    {mapping.original}
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-400" />
                  <div>
                    <Select 
                      value={mapping.standardField} 
                      onValueChange={(value) => updateMapping(mapping.original, value)}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {standardFieldOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            <div>
                              <div className="font-medium">{option.label}</div>
                              <div className="text-xs text-gray-500">{option.description}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {getConfidenceBadge(mapping.confidence)}
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => removeMapping(mapping.original)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Unmapped Columns */}
          {getUnmappedColumns().length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium">Unmapped Columns</h4>
              {getUnmappedColumns().map((column, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                  <div className="font-mono text-sm">
                    {column}
                  </div>
                  <Select onValueChange={(value) => addMapping(column, value)}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Map to field..." />
                    </SelectTrigger>
                    <SelectContent>
                      {standardFieldOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          <div>
                            <div className="font-medium">{option.label}</div>
                            <div className="text-xs text-gray-500">{option.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validation Alerts */}
      {!isValid() && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Please map at least the <strong>Date</strong> and <strong>Amount</strong> fields to continue.
          </AlertDescription>
        </Alert>
      )}

      {/* Data Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Data Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {mappings.filter(m => m.standardField !== 'ignore').map(mapping => (
                      <th key={mapping.standardField} className="text-left p-2 font-medium">
                        {mapping.standardField}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewNormalizedData().map((row, index) => (
                    <tr key={index} className="border-b">
                      {mappings.filter(m => m.standardField !== 'ignore').map(mapping => (
                        <td key={mapping.standardField} className="p-2">
                          {row[mapping.standardField]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500">
              Showing preview of first 3 rows after mapping
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button 
          onClick={handleConfirm}
          disabled={!isValid()}
          className="gap-2"
        >
          <CheckCircle2 className="h-4 w-4" />
          Confirm & Process Data
        </Button>
      </div>
    </div>
  )
}