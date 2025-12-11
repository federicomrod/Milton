// lib/chart-generator.ts
import type { ReportData } from '@/lib/report-data-service'

const QUICKCHART_BASE = 'https://quickchart.io/chart'

// Convert a Chart.js config into a base64 PNG via QuickChart
async function fetchChartBase64(config: any): Promise<string | null> {
  try {
    const url = `${QUICKCHART_BASE}?c=${encodeURIComponent(JSON.stringify(config))}&backgroundColor=white&format=png`
    const res = await fetch(url)
    const blob = await res.blob()
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
    return base64
  } catch (err) {
    console.warn('QuickChart fetch failed', err)
    return null
  }
}

// Main generator
export async function generateChartImages(data: ReportData) {
  const charts = {
    overview: undefined as string | undefined,
    financial: undefined as string | undefined,
    pipeline: undefined as string | undefined,
    cashflow: undefined as string | undefined,
  }

  try {
    // 1. Overview: Revenue trend (line chart)
    const months = Array.from({ length: 6 }, (_, i) => `M-${i + 1}`).reverse()
    const revenues = months.map(() => data.kpis?.revenue || 0)
    const expenses = months.map(() => data.kpis?.expenses || 0)

    const overviewConfig = {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          { label: 'Revenue', data: revenues, borderColor: '#0A84FF', fill: false },
          { label: 'Expenses', data: expenses, borderColor: '#FF6B6B', fill: false },
        ],
      },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } },
    }

    // 2. Financial: Revenue vs Expenses (bar)
    const financialConfig = {
      type: 'bar',
      data: {
        labels: ['Revenue', 'Expenses', 'Net Income'],
        datasets: [
          {
            label: 'Amount (€)',
            backgroundColor: ['#0A84FF', '#FF6B6B', '#4CAF50'],
            data: [data.kpis.revenue, data.kpis.expenses, data.kpis.netIncome],
          },
        ],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    }

    // 3. Pipeline: Value by Stage (bar)
    const pipelineConfig = {
      type: 'bar',
      data: {
        labels: ['Lead', 'Qualification', 'Negotiation', 'Closed Won'],
        datasets: [
          {
            label: 'Pipeline Value (€)',
            backgroundColor: '#0A84FF',
            data: [200000, 400000, 350000, 600000], // placeholder until CRM stage data is structured
          },
        ],
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    }

    // 4. Cash Flow: Inflow vs Outflow (line)
    const cashflowConfig = {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          { label: 'Inflow', data: months.map(() => data.kpis.revenue), borderColor: '#4CAF50', fill: false },
          { label: 'Outflow', data: months.map(() => data.kpis.expenses), borderColor: '#FF6B6B', fill: false },
        ],
      },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } },
    }

    // Fetch images concurrently
    const [overview, financial, pipeline, cashflow] = await Promise.all([
      fetchChartBase64(overviewConfig),
      fetchChartBase64(financialConfig),
      fetchChartBase64(pipelineConfig),
      fetchChartBase64(cashflowConfig),
    ])

    charts.overview = overview || undefined
    charts.financial = financial || undefined
    charts.pipeline = pipeline || undefined
    charts.cashflow = cashflow || undefined
  } catch (e) {
    console.error('Chart generation failed', e)
  }

  return charts
}

/**
 * Generates a simple income statement line chart config
 * using KPI snapshot data (month, revenue, expenses, net_income).
 */
export function generateIncomeStatementChart(kpis: any) {
  if (!kpis || !Array.isArray(kpis)) return { labels: [], datasets: [] }

  const labels = kpis.map((k) => k.month)
  const revenue = kpis.map((k) => Number(k.revenue) || 0)
  const expenses = kpis.map((k) => Number(k.expenses) || 0)
  const netIncome = kpis.map((k) => Number(k.net_income) || 0)

  return {
    labels,
    datasets: [
      { label: 'Revenue', data: revenue },
      { label: 'Expenses', data: expenses },
      { label: 'Net Income', data: netIncome },
    ],
  }
}

