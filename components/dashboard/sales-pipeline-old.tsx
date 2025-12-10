'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Badge } from '@/components/ui/badge'
import { Palette, RotateCcw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface Deal {
  id: string
  dealName: string
  phase: string
  amount: number
  clientName: string
  firstAppointment: string
  closingDate: string
  product: string
}

interface PhaseColors {
  [key: string]: string
}

export function SalesPipeline() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [showWeighted, setShowWeighted] = useState(false)
  const [colorMode, setColorMode] = useState<'individual' | 'corporate'>('individual')
  const [corporateColor, setCorporateColor] = useState('#3b82f6')
  const [isColorDialogOpen, setIsColorDialogOpen] = useState(false)
  const [metrics, setMetrics] = useState<any>({
    pipelineByPhase: [],
    dealsByProduct: [],
    averageSalesCycle: 0,
    conversionRates: [],
    topDeals: [],
    pipelineForecast: []
  })

  // Default individual colors for each phase
  const [phaseColors, setPhaseColors] = useState<PhaseColors>({
    'Lead Generation': '#e0f2fe',  // Light blue
    'First Contact': '#93c5fd',    // Medium blue
    'Need Qualification': '#3b82f6', // Blue
    'Negotiation': '#1e40af',      // Dark blue
    'Deal': '#10b981',             // Green
    'No Deal': '#ef4444'           // Red
  })

  // Predefined color palettes
  const colorPalettes = [
    {
      name: 'Default Blues',
      colors: {
        'Lead Generation': '#e0f2fe',
        'First Contact': '#93c5fd',
        'Need Qualification': '#3b82f6',
        'Negotiation': '#1e40af',
        'Deal': '#10b981',
        'No Deal': '#ef4444'
      }
    },
    {
      name: 'Green Gradient',
      colors: {
        'Lead Generation': '#dcfce7',
        'First Contact': '#86efac',
        'Need Qualification': '#22c55e',
        'Negotiation': '#16a34a',
        'Deal': '#15803d',
        'No Deal': '#ef4444'
      }
    },
    {
      name: 'Purple Gradient',
      colors: {
        'Lead Generation': '#f3e8ff',
        'First Contact': '#c084fc',
        'Need Qualification': '#a855f7',
        'Negotiation': '#9333ea',
        'Deal': '#7c3aed',
        'No Deal': '#ef4444'
      }
    },
    {
      name: 'Warm Gradient',
      colors: {
        'Lead Generation': '#fef3c7',
        'First Contact': '#fbbf24',
        'Need Qualification': '#f59e0b',
        'Negotiation': '#d97706',
        'Deal': '#92400e',
        'No Deal': '#ef4444'
      }
    }
  ]

  // Corporate color palettes (different shades of same color)
  const corporateColorPalettes = [
    { name: 'Blue', color: '#3b82f6' },
    { name: 'Green', color: '#10b981' },
    { name: 'Purple', color: '#8b5cf6' },
    { name: 'Orange', color: '#f59e0b' },
    { name: 'Red', color: '#ef4444' },
    { name: 'Teal', color: '#14b8a6' },
    { name: 'Pink', color: '#ec4899' },
    { name: 'Indigo', color: '#6366f1' }
  ]

  // Generate corporate color shades
  const generateCorporateColors = (baseColor: string): PhaseColors => {
    // This is a simple approach - in a real app you might want to use a color library
    const hslColor = hexToHsl(baseColor)
    
    return {
      'Lead Generation': hslToHex(hslColor.h, hslColor.s, Math.min(95, hslColor.l + 40)),
      'First Contact': hslToHex(hslColor.h, hslColor.s, Math.min(85, hslColor.l + 20)),
      'Need Qualification': baseColor,
      'Negotiation': hslToHex(hslColor.h, hslColor.s, Math.max(15, hslColor.l - 15)),
      'Deal': hslToHex(hslColor.h, hslColor.s, Math.max(10, hslColor.l - 25)),
      'No Deal': '#ef4444' // Always red for failed deals
    }
  }

  // Color conversion utilities (simplified)
  const hexToHsl = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h = 0, s = 0, l = (max + min) / 2
    
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break
        case g: h = (b - r) / d + 2; break
        case b: h = (r - g) / d + 4; break
      }
      h /= 6
    }
    
    return { h: h * 360, s: s * 100, l: l * 100 }
  }

  const hslToHex = (h: number, s: number, l: number) => {
    l /= 100
    const a = s * Math.min(l, 1 - l) / 100
    const f = (n: number) => {
      const k = (n + h / 30) % 12
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
      return Math.round(255 * color).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }

  // Get current colors based on mode
  const getCurrentColors = (): PhaseColors => {
    if (colorMode === 'corporate') {
      return generateCorporateColors(corporateColor)
    }
    return phaseColors
  }

  // Phase weights for weighted pipeline
  const phaseWeights: { [key: string]: number } = {
    'Lead Generation': 0.1,
    'First Contact': 0.2,
    'Need Qualification': 0.4,
    'Negotiation': 0.8,
    'Deal': 1.0,
    'No Deal': 0
  }

  useEffect(() => {
    const loadCRMData = () => {
      const crmData = localStorage.getItem('crmDeals')
      if (!crmData) return

      const dealsData: Deal[] = JSON.parse(crmData)
      setDeals(dealsData)

      // Calculate metrics
      calculatePipelineMetrics(dealsData)
    }

    loadCRMData()
  }, [])

  const calculatePipelineMetrics = (dealsData: Deal[]) => {
    // Pipeline by phase
    const phaseOrder = ['Lead Generation', 'First Contact', 'Need Qualification', 'Negotiation', 'Deal', 'No Deal']
    const phaseData = phaseOrder.map(phase => {
      const phaseDeals = dealsData.filter(d => d.phase === phase)
      return {
        phase,
        count: phaseDeals.length,
        value: phaseDeals.reduce((sum, d) => sum + d.amount, 0),
        avgValue: phaseDeals.length > 0 ? phaseDeals.reduce((sum, d) => sum + d.amount, 0) / phaseDeals.length : 0
      }
    })

    // Calculate conversion funnel (excluding 'No Deal')
    const activePhasesData = phaseOrder.slice(0, -1) // Exclude 'No Deal'
    
    const funnelData = activePhasesData.map((phase, index) => {
      const phaseDeals = dealsData.filter(d => d.phase === phase)
      const count = phaseDeals.length
      const value = phaseDeals.reduce((sum, d) => sum + d.amount, 0)
      
      // For funnel visualization, we want cumulative counts from bottom to top
      const cumulativeCount = activePhasesData.slice(index).reduce((sum, p) => {
        return sum + dealsData.filter(d => d.phase === p).length
      }, 0)
      
      return {
        phase,
        count: count,
        cumulativeCount: cumulativeCount,
        value: value,
        percentage: dealsData.filter(d => d.phase !== 'No Deal').length > 0 ? 
          (cumulativeCount / dealsData.filter(d => d.phase !== 'No Deal').length * 100).toFixed(1) : 0,
        avgDealSize: count > 0 ? Math.round(value / count) : 0
      }
    })

    // Deals by product
    const productData = dealsData.reduce((acc: any[], deal) => {
      const existing = acc.find(p => p.product === deal.product)
      if (existing) {
        existing.count += 1
        existing.value += deal.amount
      } else {
        acc.push({
          product: deal.product,
          count: 1,
          value: deal.amount
        })
      }
      return acc
    }, [])

    // Calculate average sales cycle (for closed deals)
    const closedDeals = dealsData.filter(d => d.phase === 'Deal' && d.firstAppointment && d.closingDate)
    const salesCycles = closedDeals.map(d => {
      const start = new Date(d.firstAppointment)
      const end = new Date(d.closingDate)
      return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    })
    const avgSalesCycle = salesCycles.length > 0 ? 
      Math.round(salesCycles.reduce((sum, days) => sum + days, 0) / salesCycles.length) : 0

    // Pipeline forecast by closing date
    const pipelineForecast = (() => {
      // Get next 6 months
      const months = []
      const today = new Date()
      for (let i = 0; i < 6; i++) {
        const date = new Date(today.getFullYear(), today.getMonth() + i, 1)
        months.push({
          month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
          yearMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        })
      }
      
      // Group deals by month and phase
      const forecastData = months.map(({ month, yearMonth }) => {
        const monthData: any = { month }
        
        // Initialize all phases with 0
        phaseOrder.slice(0, -2).forEach(phase => { // Exclude 'Deal' and 'No Deal'
          monthData[phase] = 0
          monthData[`${phase}_weighted`] = 0
        })
        
        // Add deals to appropriate month and phase
        dealsData.forEach(deal => {
          if (deal.closingDate) {
            const dealDate = new Date(deal.closingDate)
            const dealYearMonth = `${dealDate.getFullYear()}-${String(dealDate.getMonth() + 1).padStart(2, '0')}`
            
            if (dealYearMonth === yearMonth && deal.phase !== 'No Deal' && deal.phase !== 'Deal') {
              monthData[deal.phase] = (monthData[deal.phase] || 0) + deal.amount
              monthData[`${deal.phase}_weighted`] = (monthData[`${deal.phase}_weighted`] || 0) + 
                (deal.amount * (phaseWeights[deal.phase] || 0))
            }
          }
        })
        
        // Calculate total for the month
        monthData.total = phaseOrder.slice(0, -2).reduce((sum, phase) => sum + (monthData[phase] || 0), 0)
        monthData.total_weighted = phaseOrder.slice(0, -2).reduce((sum, phase) => 
          sum + (monthData[`${phase}_weighted`] || 0), 0)
        
        return monthData
      })
      
      return forecastData
    })()

    // Top 10 deals
    const topDeals = [...dealsData]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map(d => ({
        name: d.dealName.substring(0, 30) + '...',
        client: d.clientName,
        amount: d.amount,
        phase: d.phase
      }))

    setMetrics({
      pipelineByPhase: phaseData,
      funnelData: funnelData,
      dealsByProduct: productData,
      averageSalesCycle: avgSalesCycle,
      topDeals: topDeals,
      pipelineForecast: pipelineForecast
    })
  }

  const applyColorPalette = (palette: any) => {
    setPhaseColors(palette.colors)
    setColorMode('individual')
    setIsColorDialogOpen(false)
  }

  const applyCorporateColor = (color: string) => {
    setCorporateColor(color)
    setColorMode('corporate')
    setIsColorDialogOpen(false)
  }

  const resetToDefault = () => {
    setPhaseColors(colorPalettes[0].colors)
    setColorMode('individual')
    setCorporateColor('#3b82f6')
  }

  const currentColors = getCurrentColors()

  if (deals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sales Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">No CRM data available. Please upload your CRM file.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6" data-chart="sales-pipeline">
      {/* Header with Color Selector */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Sales Pipeline</h2>
        <div className="flex items-center gap-2">
          <Dialog open={isColorDialogOpen} onOpenChange={setIsColorDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Palette className="h-4 w-4" />
                Customize Colors
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Pipeline Color Settings</DialogTitle>
                <DialogDescription>
                  Choose colors for your sales pipeline phases
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-6">
                {/* Current Color Preview */}
                <div>
                  <h4 className="font-medium mb-3">Current Colors</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(currentColors).map(([phase, color]) => (
                      <Badge key={phase} className="flex items-center gap-2" style={{ backgroundColor: color, color: '#000' }}>
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></div>
                        {phase}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Corporate Colors */}
                <div>
                  <h4 className="font-medium mb-3">Corporate Branding (Single Color)</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {corporateColorPalettes.map((palette) => (
                      <Button
                        key={palette.name}
                        variant="outline"
                        className="h-12 flex flex-col gap-1"
                        onClick={() => applyCorporateColor(palette.color)}
                        style={{ 
                          backgroundColor: colorMode === 'corporate' && corporateColor === palette.color ? palette.color + '20' : 'transparent'
                        }}
                      >
                        <div className="w-6 h-6 rounded" style={{ backgroundColor: palette.color }}></div>
                        <span className="text-xs">{palette.name}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Predefined Palettes */}
                <div>
                  <h4 className="font-medium mb-3">Predefined Palettes</h4>
                  <div className="space-y-3">
                    {colorPalettes.map((palette) => (
                      <div key={palette.name} className="border rounded p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">{palette.name}</span>
                          <Button size="sm" onClick={() => applyColorPalette(palette)}>
                            Apply
                          </Button>
                        </div>
                        <div className="flex gap-1">
                          {Object.entries(palette.colors).map(([phase, color]) => (
                            <div
                              key={phase}
                              className="w-8 h-8 rounded"
                              style={{ backgroundColor: color }}
                              title={phase}
                            ></div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={resetToDefault} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Reset to Default
                  </Button>
                  <Button onClick={() => setIsColorDialogOpen(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Pipeline Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              €{deals.reduce((sum, d) => sum + d.amount, 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Deals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {deals.filter(d => d.phase !== 'No Deal' && d.phase !== 'Deal').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg. Sales Cycle</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.averageSalesCycle} days</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((deals.filter(d => d.phase === 'Deal').length / 
                deals.filter(d => d.phase === 'Deal' || d.phase === 'No Deal').length) * 100).toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sales Funnel */}
      <Card>
        <CardHeader>
          <CardTitle>Sales Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {metrics.funnelData.map((stage: any, index: number) => {
              const width = `${stage.percentage}%`
              const isLast = index === metrics.funnelData.length - 1
              
              return (
                <div key={stage.phase} className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{stage.phase}</span>
                    <span className="text-sm text-gray-600">
                      {stage.cumulativeCount} deals ({stage.percentage}%)
                    </span>
                  </div>
                  <div className="relative h-10 bg-gray-200 rounded-lg overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 flex items-center justify-center text-white font-semibold transition-all duration-500"
                      style={{ 
                        width: width,
                        backgroundColor: currentColors[stage.phase]
                      }}
                    >
                      <span className="text-xs px-2">
                        €{(stage.value / 1000).toFixed(0)}k
                      </span>
                    </div>
                  </div>
                  {!isLast && (
                    <div className="flex justify-center my-2">
                      <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Value by Phase</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={metrics.pipelineByPhase}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="phase" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip formatter={(value: any) => `€${value.toLocaleString()}`} />
                <Bar dataKey="value" name="Total Value (€)">
                  {metrics.pipelineByPhase.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={currentColors[entry.phase]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deal Count by Phase</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={metrics.pipelineByPhase}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="phase" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" name="Number of Deals">
                  {metrics.pipelineByPhase.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={currentColors[entry.phase]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Forecast */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Pipeline Forecast by Closing Date</CardTitle>
            <ToggleGroup type="single" value={showWeighted ? "weighted" : "unweighted"} onValueChange={(value) => setShowWeighted(value === "weighted")}>
              <ToggleGroupItem value="unweighted" aria-label="Unweighted">
                Unweighted
              </ToggleGroupItem>
              <ToggleGroupItem value="weighted" aria-label="Weighted">
                Weighted
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={metrics.pipelineForecast}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `€${(value / 1000).toFixed(0)}k`} />
              <Tooltip 
                formatter={(value: any) => `€${value.toLocaleString()}`}
                content={({ active, payload, label }: any) => {
                  if (active && payload && payload.length) {
                    const totalKey = showWeighted ? 'total_weighted' : 'total'
                    return (
                      <div className="bg-white p-4 border rounded shadow-lg">
                        <p className="font-semibold mb-2">{label}</p>
                        {payload.map((entry: any, index: number) => (
                          <p key={index} className="text-sm" style={{ color: entry.color }}>
                            {entry.name}: €{entry.value.toLocaleString()}
                            {showWeighted && phaseWeights[entry.name] && (
                              <span className="text-gray-500"> ({(phaseWeights[entry.name] * 100)}%)</span>
                            )}
                          </p>
                        ))}
                        <p className="text-sm font-semibold mt-2 pt-2 border-t">
                          Total: €{payload[0].payload[totalKey].toLocaleString()}
                        </p>
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Legend />
              <Bar 
                dataKey={showWeighted ? "Lead Generation_weighted" : "Lead Generation"} 
                stackId="a" 
                fill={currentColors['Lead Generation']}
                name="Lead Generation"
              />
              <Bar 
                dataKey={showWeighted ? "First Contact_weighted" : "First Contact"} 
                stackId="a" 
                fill={currentColors['First Contact']}
                name="First Contact"
              />
              <Bar 
                dataKey={showWeighted ? "Need Qualification_weighted" : "Need Qualification"} 
                stackId="a" 
                fill={currentColors['Need Qualification']}
                name="Need Qualification"
              />
              <Bar 
                dataKey={showWeighted ? "Negotiation_weighted" : "Negotiation"} 
                stackId="a" 
                fill={currentColors['Negotiation']}
                name="Negotiation"
              />
            </BarChart>
          </ResponsiveContainer>
          {showWeighted && (
            <div className="mt-4 text-sm text-gray-600">
              <p className="font-semibold mb-1">Phase Weights:</p>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(phaseWeights).slice(0, 4).map(([phase, weight]) => (
                  <span key={phase}>{phase}: {(weight * 100)}%</span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Deals by Product */}
        <Card>
          <CardHeader>
            <CardTitle>Deals by Product</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={metrics.dealsByProduct}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {metrics.dealsByProduct.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={Object.values(currentColors)[index % Object.values(currentColors).length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => `€${value.toLocaleString()}`} />
                <Legend 
                  verticalAlign="bottom" 
                  height={36}
                  formatter={(value: any, entry: any) => `${entry.payload.product}: €${(entry.payload.value/1000).toFixed(0)}k`}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Deals */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Deals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.topDeals.map((deal: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: currentColors[deal.phase] }}
                    ></div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{deal.name}</p>
                      <p className="text-xs text-gray-500">{deal.client}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">€{deal.amount.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{deal.phase}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}