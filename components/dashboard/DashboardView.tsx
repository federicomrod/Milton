'use client'
import React, { useEffect, useState } from 'react'
import { miltonEventsAPI } from '@/lib/milton-events'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

export default function DashboardView() {
  const [chartData, setChartData] = useState<any[]>([])
  const [businessModel, setBusinessModel] = useState('')

  useEffect(() => {
    const unsubscribe = miltonEventsAPI.subscribe('dashboard.data.ready', (payload) => {
      console.log('[DashboardView] Received dashboard data:', payload)
      setBusinessModel(payload.businessModel)
      if (payload.kpis?.length > 0) {
        // Map KPI rows to chart data with real period labels
        const normalized = payload.kpis.map((kpi: any) => ({
          label: kpi.period ?? 'Unknown period',
          revenue: kpi.revenue ?? 0,
          expenses: kpi.expenses ?? 0,
          net_income: kpi.net_income ?? kpi.value ?? 0,
        }))
        setChartData(normalized)
      }
    })
    return () => unsubscribe()
  }, [])

  if (!chartData.length) {
    return (
      <div className="flex flex-col items-center justify-center text-gray-500 text-sm h-full">
        <p>📊 No KPI data available yet for {businessModel || 'this model'}.</p>
      </div>
    )
  }

  return (
    <div className="p-4">
      <h3 className="font-semibold text-gray-800 mb-3">
        Key KPI Trends ({businessModel})
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#3b82f6" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
