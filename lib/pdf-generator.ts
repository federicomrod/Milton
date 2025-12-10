// lib/pdf-generator.ts
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { ReportData } from '@/lib/report-data-service'

export interface ReportConfig {
  company?: string
  periodLabel?: string
}

const theme = {
  primary: '#0A84FF',
  accent: '#F5F7FA',
  text: '#222222',
  lightText: '#6B7280',
  font: 'Helvetica',
  success: '#10B981',
  danger: '#EF4444'
}

/**
 * Generate a branded, data-driven PDF report using live Supabase metrics
 */
export async function generateReportPDF(
  data: ReportData,
  config?: ReportConfig
): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  let y = 60
  drawHeader(doc, config)
  y = drawKPISection(doc, data.kpis, y + 20)
  y = drawBudgetVariance(doc, data.budgetVariance, y + 40)
  y = drawPipelineSection(doc, data.kpis.pipelineValue, data.kpis.openDeals, y + 40)
  drawSummarySection(doc, data.kpis, y + 60)

  const filename = `${config?.company || 'Milton'}_Report_${new Date().toISOString().split('T')[0]}.pdf`
  doc.save(filename)
}

/* ---------------- Section Functions ---------------- */

function drawHeader(doc: jsPDF, config?: ReportConfig): void {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(20)
  doc.setTextColor(theme.primary)
  doc.text(config?.company || 'Milton Financial Insights', 60, 50)
  
  doc.setFontSize(12)
  doc.setTextColor(theme.text)
  doc.text(`Report Period: ${config?.periodLabel || 'Current Month'}`, 60, 70)
  
  doc.setFontSize(8)
  doc.setTextColor(theme.lightText)
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 60, 85)
}

function drawKPISection(doc: jsPDF, kpis: any, startY: number): number {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(theme.text)
  doc.text('Key Performance Indicators', 60, startY)

  const rows = [
    ['Revenue', formatCurrency(kpis.revenue)],
    ['Expenses', formatCurrency(kpis.expenses)],
    ['Net Income', formatCurrency(kpis.netIncome)],
    ['Burn Rate (per month)', formatCurrency(kpis.burnRate)],
    ['Cash Runway (months)', kpis.cashRunway?.toString() || '0']
  ]

  autoTable(doc, {
    startY: startY + 10,
    head: [['Metric', 'Value']],
    body: rows,
    theme: 'striped',
    styles: { 
      font: theme.font, 
      halign: 'left',
      fontSize: 10
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: '#FFFFFF',
      fontStyle: 'bold'
    },
    alternateRowStyles: {
      fillColor: theme.accent
    },
    margin: { left: 60, right: 60 }
  })
  
  return (doc as any).lastAutoTable?.finalY || startY + 40
}

function drawBudgetVariance(doc: jsPDF, variance: any[], startY: number): number {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(theme.text)
  doc.text('Budget vs Actual', 60, startY)

  const body = variance.map(v => [
    v.label,
    formatCurrency(v.actual),
    formatCurrency(v.planned),
    formatCurrency(v.variance),
    `${v.variancePct.toFixed(1)}%`
  ])

  autoTable(doc, {
    startY: startY + 10,
    head: [['Category', 'Actual', 'Planned', 'Variance', 'Δ %']],
    body,
    theme: 'striped',
    styles: { 
      font: theme.font, 
      halign: 'right',
      fontSize: 10
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: '#FFFFFF',
      fontStyle: 'bold'
    },
    alternateRowStyles: {
      fillColor: theme.accent
    },
    columnStyles: {
      0: { halign: 'left' }
    },
    margin: { left: 60, right: 60 }
  })
  
  return (doc as any).lastAutoTable?.finalY || startY + 60
}

function drawPipelineSection(
  doc: jsPDF, 
  pipelineValue: number, 
  openDeals: number, 
  startY: number
): number {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(theme.text)
  doc.text('Sales Pipeline', 60, startY)

  const rows = [
    ['Total Pipeline Value', formatCurrency(pipelineValue)],
    ['Open Deals', openDeals?.toString() || '0']
  ]
  
  autoTable(doc, {
    startY: startY + 10,
    head: [['Metric', 'Value']],
    body: rows,
    theme: 'striped',
    styles: { 
      font: theme.font, 
      halign: 'left',
      fontSize: 10
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: '#FFFFFF',
      fontStyle: 'bold'
    },
    alternateRowStyles: {
      fillColor: theme.accent
    },
    margin: { left: 60, right: 60 }
  })
  
  return (doc as any).lastAutoTable?.finalY || startY + 40
}

function drawSummarySection(doc: jsPDF, kpis: any, startY: number): void {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(theme.text)
  doc.text('Executive Summary', 60, startY)
  
  doc.setFont(theme.font, 'normal')
  doc.setFontSize(11)
  doc.setTextColor(theme.text)
  
  const summary = generateNarrative(kpis)
  const lines = doc.splitTextToSize(summary, 720)
  doc.text(lines, 60, startY + 20)
}

function generateNarrative(kpis: any): string {
  const trend = kpis.netIncome >= 0 ? 'profitable' : 'burning cash'
  const trendColor = kpis.netIncome >= 0 ? 'positive' : 'negative'
  
  const summary = [
    `Your startup generated ${formatCurrency(kpis.revenue)} in revenue this period, with total expenses of ${formatCurrency(kpis.expenses)}.`,
    `The company is currently ${trend}, showing a ${trendColor} net income of ${formatCurrency(Math.abs(kpis.netIncome))}.`,
    `The monthly burn rate stands at ${formatCurrency(kpis.burnRate)} per month.`,
    `Based on current performance, the cash runway is estimated at ${kpis.cashRunway} months.`,
    `The sales pipeline value stands at ${formatCurrency(kpis.pipelineValue)} across ${kpis.openDeals} open deals.`
  ]
  
  return summary.join(' ')
}

function formatCurrency(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return '–'
  return '€ ' + Number(num).toLocaleString('de-DE', { 
    minimumFractionDigits: 0, 
    maximumFractionDigits: 0 
  })
}
