'use client'

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, Rectangle } from 'recharts'

interface WaterfallData {
  name: string
  value: number
  isTotal?: boolean
  color?: string
}

interface WaterfallChartProps {
  data: WaterfallData[]
  height?: number
}

export function WaterfallChart({ data, height = 400 }: WaterfallChartProps) {
  // Calculate cumulative values for waterfall effect
  const processedData = data.map((item, index) => {
    let start = 0
    let end = 0
    
    if (index === 0 || item.isTotal) {
      // First bar or total bars start from 0
      start = 0
      end = item.value
    } else {
      // Calculate cumulative start position
      start = data.slice(0, index).reduce((sum, d) => {
        if (d.isTotal) return item.value > 0 ? 0 : sum
        return sum + d.value
      }, 0)
      end = start + item.value
    }
    
    return {
      ...item,
      start: Math.min(start, end),
      end: Math.max(start, end),
      height: Math.abs(end - start),
      isNegative: item.value < 0,
      displayValue: item.value
    }
  })

  const CustomBar = (props: any) => {
    const { fill, x, y, width, height, payload } = props
    
    if (!payload) return null
    
    // Add connecting lines between bars (except for totals)
    const elements = []
    
    // Main bar
    elements.push(
      <Rectangle
        key="bar"
        x={x}
        y={y}
        width={width}
        height={height}
        fill={payload.color || fill}
      />
    )
    
    // Connecting line to next bar (if not a total and not the last item)
    const index = processedData.findIndex(d => d.name === payload.name)
    if (!payload.isTotal && index < processedData.length - 1 && !processedData[index + 1].isTotal) {
      const lineY = payload.isNegative ? y + height : y
      elements.push(
        <line
          key="connector"
          x1={x + width}
          y1={lineY}
          x2={x + width + (props.xAxisWidth || 60)}
          y2={lineY}
          stroke="#666"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )
    }
    
    return <g>{elements}</g>
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload
      return (
        <div className="bg-white p-2 border border-gray-200 rounded shadow-lg">
          <p className="font-semibold">{data.name}</p>
          <p className={data.isNegative ? 'text-red-600' : 'text-green-600'}>
            €{Math.abs(data.displayValue).toLocaleString()}
          </p>
        </div>
      )
    }
    return null
  }

  // Calculate Y-axis domain
  const allValues = processedData.flatMap(d => [d.start, d.end])
  const minValue = Math.min(...allValues)
  const maxValue = Math.max(...allValues)
  const padding = (maxValue - minValue) * 0.1
  
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart 
        data={processedData}
        margin={{ top: 20, right: 30, left: 40, bottom: 60 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis 
          dataKey="name" 
          angle={-45} 
          textAnchor="end" 
          height={80}
          interval={0}
        />
        <YAxis 
          domain={[minValue - padding, maxValue + padding]}
          tickFormatter={(value) => `€${(value / 1000).toFixed(0)}k`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar 
          dataKey="height"
          shape={<CustomBar xAxisWidth={60} />}
          isAnimationActive={false}
        >
          {processedData.map((entry, index) => (
            <Cell 
              key={`cell-${index}`} 
              fill={
                entry.isTotal 
                  ? (entry.value >= 0 ? '#3b82f6' : '#dc2626')
                  : (entry.isNegative ? '#ef4444' : '#10b981')
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}