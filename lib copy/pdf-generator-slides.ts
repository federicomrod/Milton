// lib/pdf-generator-slides.ts
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { ReportData } from '@/lib/report-data-service'
import { formatCurrency as formatCurrencyUtil, formatNumber as formatNumberUtil, formatDate as formatDateUtil } from '@/lib/utils/formatters'

export interface ReportConfig {
  company?: string
  periodLabel?: string
  currency?: string
  dateFormat?: string
  numberFormat?: string
  timezone?: string
}

export interface ReportInsights {
  overview?: string[]
  financial?: string[]
  pipeline?: string[]
  cashflow?: string[]
}

export interface ChartImages {
  overview?: string
  financial?: string
  pipeline?: string
  cashflow?: string
}

const theme = {
  primary: '#0A84FF',
  text: '#222222',
  lightText: '#6B7280',
  font: 'Helvetica',
  marginX: 60,
  marginY: 60,
}

const layout = {
  pageW: 842, // approx A4 landscape width in pt
  pageH: 595, // approx height
  marginX: 60,
  marginY: 60,
}

const col = {
  leftX: layout.marginX,
  leftW: Math.floor((layout.pageW - layout.marginX * 2) * 0.66),
  rightX: layout.marginX + Math.floor((layout.pageW - layout.marginX * 2) * 0.66) + 16,
  rightW: Math.floor((layout.pageW - layout.marginX * 2) * 0.34) - 16,
}

/**
 * Generate a multi-page slide-based PDF report with live Supabase data
 */
export async function generateReportSlides(
  data: ReportData,
  config?: ReportConfig,
  insights?: ReportInsights,
  chartImages?: ChartImages
): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  /* PAGE 1: Overview */
  drawHeader(doc, config)
  drawOverviewPage(doc, data, insights, chartImages, config)
  doc.addPage()

  /* PAGE 2: Financial Analysis */
  drawHeader(doc, config)
  drawFinancialPage(doc, data, insights, chartImages, config)
  doc.addPage()

  /* PAGE 3: Sales Pipeline */
  drawHeader(doc, config)
  drawPipelinePage(doc, data, insights, chartImages, config)
  doc.addPage()

  /* PAGE 4: Cash Flow Analysis */
  drawHeader(doc, config)
  drawCashFlowPage(doc, data, insights, chartImages, config)

  const filename = `${config?.company || 'Milton'}_Report_${new Date()
    .toISOString()
    .split('T')[0]}.pdf`
  doc.save(filename)
}

/* ---------------- Header ---------------- */
function drawHeader(doc: jsPDF, config?: ReportConfig): void {
  const company = config?.company || 'Milton Financial Insights'
  const period = config?.periodLabel || 'Current Month'
  const generated = new Date().toLocaleDateString('en-GB')

  doc.setFont(theme.font, 'bold')
  doc.setFontSize(20)
  doc.setTextColor(theme.primary)
  doc.text(company, theme.marginX, 40)

  doc.setFontSize(12)
  doc.setTextColor(theme.text)
  doc.text(`Report Period: ${period}`, theme.marginX, 60)
  doc.text(`Generated: ${generated}`, theme.marginX, 75)

  doc.setDrawColor(200, 200, 200)
  doc.line(theme.marginX, 85, 780, 85)
}

/* ---------------- PAGE 1: Overview ---------------- */
function drawOverviewPage(doc: jsPDF, data: ReportData, insights?: ReportInsights, chartImages?: ChartImages, config?: ReportConfig): void {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(theme.text)
  doc.text('1. Overview & Performance', col.leftX, 110)

  const kpis = data.kpis
  const rows = [
    ['Revenue', formatCurrency(kpis.revenue, config)],
    ['Expenses', formatCurrency(kpis.expenses, config)],
    ['Net Income', formatCurrency(kpis.netIncome, config)],
    ['Burn Rate (per month)', formatCurrency(kpis.burnRate, config)],
    ['Cash Runway (months)', kpis.cashRunway?.toString() || '0'],
  ]

  autoTable(doc, {
    startY: 130,
    head: [['Metric', 'Value']],
    body: rows,
    theme: 'striped',
    margin: { left: col.leftX, right: layout.marginX },
    tableWidth: col.leftW,
    styles: { 
      font: theme.font, 
      halign: 'left',
      fontSize: 11
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: '#FFFFFF',
      fontStyle: 'bold',
      fontSize: 12
    },
    alternateRowStyles: {
      fillColor: '#F5F7FA'
    }
  })

  // Chart area with background
  const chartY = 280
  const chartW = col.leftW - 20
  const chartH = 240
  
  doc.setFillColor(248, 248, 248)
  doc.rect(col.leftX, chartY, chartW, chartH, 'F')
  
  if (chartImages?.overview) {
    try {
      doc.addImage(chartImages.overview, 'PNG', col.leftX, chartY, chartW, chartH)
    } catch {
      drawChartPlaceholder(doc, col.leftX, chartY, chartW, chartH, 'Overview Chart (Image Load Failed)')
    }
  } else {
    drawChartPlaceholder(doc, col.leftX, chartY, chartW, chartH, 'Overview Charts')
  }

  // Right panel with insights
  drawCommentPanel(doc, col.rightX, 110, col.rightW, 410, 'Overview – Key Insights', insights?.overview)
}

/* ---------------- PAGE 2: Financial ---------------- */
function drawFinancialPage(doc: jsPDF, data: ReportData, insights?: ReportInsights, chartImages?: ChartImages, config?: ReportConfig): void {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(theme.text)
  doc.text('2. Financial Analysis', col.leftX, 110)

  const variance = data.budgetVariance || []
  const body = variance.map(v => [
    v.label,
    formatCurrency(v.actual, config),
    formatCurrency(v.planned, config),
    formatCurrency(v.variance, config),
    `${v.variancePct.toFixed(1)}%`,
  ])

  autoTable(doc, {
    startY: 130,
    head: [['Category', 'Actual', 'Planned', 'Variance', 'Δ %']],
    body,
    theme: 'striped',
    margin: { left: col.leftX, right: layout.marginX },
    tableWidth: col.leftW,
    styles: { 
      font: theme.font, 
      halign: 'right',
      fontSize: 11
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: '#FFFFFF',
      fontStyle: 'bold',
      fontSize: 12
    },
    alternateRowStyles: {
      fillColor: '#F5F7FA'
    },
    columnStyles: {
      0: { halign: 'left' }
    }
  })

  // Chart area with background
  const finalY = (doc as any).lastAutoTable?.finalY || 240
  const chartY = finalY + 20
  const chartW = col.leftW - 20
  const chartH = 200
  
  doc.setFillColor(248, 248, 248)
  doc.rect(col.leftX, chartY, chartW, chartH, 'F')
  
  if (chartImages?.financial) {
    try {
      doc.addImage(chartImages.financial, 'PNG', col.leftX, chartY, chartW, chartH)
    } catch {
      drawChartPlaceholder(doc, col.leftX, chartY, chartW, chartH, 'Financial Chart (Image Load Failed)')
    }
  } else {
    drawChartPlaceholder(doc, col.leftX, chartY, chartW, chartH, 'Revenue vs Expense')
  }

  // Right panel with insights
  drawCommentPanel(doc, col.rightX, 110, col.rightW, 410, 'Financial – Variance & Notes', insights?.financial)
}

/* ---------------- PAGE 3: Pipeline ---------------- */
function drawPipelinePage(doc: jsPDF, data: ReportData, insights?: ReportInsights, chartImages?: ChartImages, config?: ReportConfig): void {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(theme.text)
  doc.text('3. Sales Pipeline', col.leftX, 110)

  const rows = [
    ['Total Pipeline Value', formatCurrency(data.kpis.pipelineValue, config)],
    ['Open Deals', data.kpis.openDeals?.toString() || '0'],
  ]

  autoTable(doc, {
    startY: 130,
    head: [['Metric', 'Value']],
    body: rows,
    theme: 'striped',
    margin: { left: col.leftX, right: layout.marginX },
    tableWidth: col.leftW,
    styles: { 
      font: theme.font, 
      halign: 'left',
      fontSize: 11
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: '#FFFFFF',
      fontStyle: 'bold',
      fontSize: 12
    },
    alternateRowStyles: {
      fillColor: '#F5F7FA'
    }
  })

  // Chart area with background
  const chartY = 230
  const chartW = col.leftW - 20
  const chartH = 290
  
  doc.setFillColor(248, 248, 248)
  doc.rect(col.leftX, chartY, chartW, chartH, 'F')
  
  if (chartImages?.pipeline) {
    try {
      doc.addImage(chartImages.pipeline, 'PNG', col.leftX, chartY, chartW, chartH)
    } catch {
      drawChartPlaceholder(doc, col.leftX, chartY, chartW, chartH, 'Pipeline Chart (Image Load Failed)')
    }
  } else {
    drawChartPlaceholder(doc, col.leftX, chartY, chartW, chartH, 'Pipeline by Stage')
  }

  // Right panel with insights
  drawCommentPanel(doc, col.rightX, 110, col.rightW, 410, 'Pipeline – Highlights', insights?.pipeline)
}

/* ---------------- PAGE 4: Cash Flow ---------------- */
function drawCashFlowPage(doc: jsPDF, data: ReportData, insights?: ReportInsights, chartImages?: ChartImages, config?: ReportConfig): void {
  doc.setFont(theme.font, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(theme.text)
  doc.text('4. Cash Flow Analysis', col.leftX, 110)

  const rows = [
    ['Burn Rate (per month)', formatCurrency(data.kpis.burnRate, config)],
    ['Cash Runway (months)', data.kpis.cashRunway?.toString() || '0'],
    ['Net Income', formatCurrency(data.kpis.netIncome, config)],
  ]

  autoTable(doc, {
    startY: 130,
    head: [['Metric', 'Value']],
    body: rows,
    theme: 'striped',
    margin: { left: col.leftX, right: layout.marginX },
    tableWidth: col.leftW,
    styles: { 
      font: theme.font, 
      halign: 'left',
      fontSize: 11
    },
    headStyles: {
      fillColor: theme.primary,
      textColor: '#FFFFFF',
      fontStyle: 'bold',
      fontSize: 12
    },
    alternateRowStyles: {
      fillColor: '#F5F7FA'
    }
  })

  // Chart area with background
  const chartY = 260
  const chartW = col.leftW - 20
  const chartH = 260
  
  doc.setFillColor(248, 248, 248)
  doc.rect(col.leftX, chartY, chartW, chartH, 'F')
  
  if (chartImages?.cashflow) {
    try {
      doc.addImage(chartImages.cashflow, 'PNG', col.leftX, chartY, chartW, chartH)
    } catch {
      drawChartPlaceholder(doc, col.leftX, chartY, chartW, chartH, 'Cash Flow Chart (Image Load Failed)')
    }
  } else {
    drawChartPlaceholder(doc, col.leftX, chartY, chartW, chartH, 'Cash Flow Trend')
  }

  // Right panel with insights
  drawCommentPanel(doc, col.rightX, 110, col.rightW, 410, 'Cash Flow – Highlights', insights?.cashflow)
}

/* ---------------- Helpers ---------------- */
function drawCommentPanel(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  bullets: string[] | undefined
): void {
  // Background fill
  doc.setDrawColor(230, 230, 230)
  doc.setFillColor(248, 248, 248)
  doc.rect(x, y, w, h, 'F')
  
  // Border
  doc.setDrawColor(210, 210, 210)
  doc.rect(x, y, w, h)

  // Title
  doc.setFont('Helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor('#222222')
  doc.text(title, x + 14, y + 22)

  // Bullets
  doc.setFont('Helvetica', 'normal')
  doc.setFontSize(11)
  const bodyY = y + 42
  const maxWidth = w - 28
  let cursor = bodyY
  const items = (bullets && bullets.length ? bullets : ['No material variance for this section.']).slice(0, 4)
  
  for (const b of items) {
    const lines = doc.splitTextToSize('• ' + b, maxWidth)
    doc.text(lines, x + 14, cursor)
    cursor += lines.length * 14 + 6
    if (cursor > y + h - 20) break
  }
}

function drawChartPlaceholder(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string
): void {
  // Light background fill
  doc.setFillColor(245, 247, 250)
  doc.rect(x, y, w, h, 'F')
  
  // Border
  doc.setDrawColor(180, 180, 180)
  doc.setLineWidth(1)
  doc.rect(x, y, w, h)
  
  // Label
  doc.setFont(theme.font, 'normal')
  doc.setFontSize(11)
  doc.setTextColor('#555555')
  doc.text(label, x + w / 2, y + h / 2, { align: 'center' })
}

function formatCurrency(num: number | undefined | null, config?: ReportConfig): string {
  if (num === undefined || num === null || isNaN(num)) return '–'
  const currency = config?.currency || 'EUR'
  return formatCurrencyUtil(num, currency)
}

