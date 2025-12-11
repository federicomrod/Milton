// lib/pdf-generator.ts
import jsPDF from 'jspdf'

interface ReportConfig {
  title: string
  companyName: string
  reportPeriod: string
  includeOverview: boolean
  includeFinancial: boolean
  includeSales: boolean
  includeCashFlow: boolean
}

interface MetricsData {
  mrr: number
  arr: number
  cashBalance: number
  burnRate: number
  contracted: number
  ltmRevenue: number
  netMargin: number
  customers: number
}

export class PDFGenerator {
  private pdf: jsPDF
  private pageWidth: number
  private pageHeight: number
  private margin: number

  constructor() {
    this.pdf = new jsPDF('landscape', 'mm', 'a4')
    this.pageWidth = this.pdf.internal.pageSize.getWidth()
    this.pageHeight = this.pdf.internal.pageSize.getHeight()
    this.margin = 20
  }

  async generateReport(config: ReportConfig): Promise<void> {
    // Generate cover slide
    await this.createCoverSlide(config)

    // Generate selected sections
    if (config.includeOverview) {
      this.pdf.addPage()
      await this.createOverviewSlide()
      
      this.pdf.addPage()
      await this.createPerformanceChartsSlide()
    }

    if (config.includeFinancial) {
      this.pdf.addPage()
      await this.createFinancialSlide()
    }

    if (config.includeSales) {
      this.pdf.addPage()
      await this.createSalesSlide()
    }

    if (config.includeCashFlow) {
      this.pdf.addPage()
      await this.createCashFlowSlide()
    }

    // Save the PDF
    const fileName = `${config.companyName.replace(/\s+/g, '_')}_Report_${new Date().toISOString().split('T')[0]}.pdf`
    this.pdf.save(fileName)
  }

  private async createCoverSlide(config: ReportConfig): Promise<void> {
    // Background - left side image area (light gray), right side dark blue
    this.pdf.setFillColor(245, 245, 245) // Light gray for left side
    this.pdf.rect(0, 0, this.pageWidth * 0.6, this.pageHeight, 'F')
    
    this.pdf.setFillColor(52, 73, 94) // Dark blue for right side
    this.pdf.rect(this.pageWidth * 0.6, 0, this.pageWidth * 0.4, this.pageHeight, 'F')

    // Main title on the right side
    this.pdf.setTextColor(255, 255, 255)
    this.pdf.setFontSize(42)
    this.pdf.setFont('helvetica', 'bold')
    
    // Split title into lines if too long
    const titleLines = this.pdf.splitTextToSize(config.title.toUpperCase(), this.pageWidth * 0.35)
    const titleY = this.pageHeight * 0.3
    titleLines.forEach((line: string, index: number) => {
      this.pdf.text(line, this.pageWidth * 0.62, titleY + (index * 15))
    })

    // Company name
    this.pdf.setFontSize(24)
    this.pdf.setFont('helvetica', 'normal')
    this.pdf.text(config.companyName, this.pageWidth * 0.62, this.pageHeight * 0.5)

    // Report period
    this.pdf.setFontSize(18)
    this.pdf.text(config.reportPeriod, this.pageWidth * 0.62, this.pageHeight * 0.8)

    // Logo placeholder bottom right
    this.pdf.setFontSize(12)
    this.pdf.text('[COMPANY LOGO]', this.pageWidth - 60, this.pageHeight - 20)

    // Generated date small text
    this.pdf.setFontSize(10)
    this.pdf.text(`Generated: ${new Date().toLocaleDateString()}`, this.pageWidth * 0.62, this.pageHeight * 0.9)
  }

  private async createOverviewSlide(): Promise<void> {
    await this.addSlideHeader('Key Metrics Overview')
    
    const metrics = this.getCurrentMetrics()
    
    // Create 4x2 metrics grid - now using full width without comments
    const cardWidth = (this.pageWidth - 2 * this.margin - 30) / 4
    const cardHeight = 40
    const startY = 60

    const metricsArray = [
      { 
        title: 'MRR', 
        value: this.formatCurrency(metrics.mrr), 
        color: [16, 185, 129],
        subtitle: 'Monthly Recurring Revenue'
      },
      { 
        title: 'ARR', 
        value: this.formatCurrency(metrics.arr), 
        color: [59, 130, 246],
        subtitle: 'Annual Recurring Revenue'
      },
      { 
        title: 'Cash Balance', 
        value: this.formatCurrency(metrics.cashBalance), 
        color: metrics.cashBalance >= 0 ? [16, 185, 129] : [239, 68, 68],
        subtitle: 'Total cash on hand'
      },
      { 
        title: 'Net Burn', 
        value: `${this.formatCurrency(metrics.burnRate)}/mo`, 
        color: metrics.burnRate > 0 ? [239, 68, 68] : [16, 185, 129],
        subtitle: 'Monthly net cash burn'
      },
      { 
        title: 'Contracted', 
        value: this.formatCurrency(metrics.contracted), 
        color: [139, 92, 246],
        subtitle: 'Pipeline in negotiation/closed'
      },
      { 
        title: 'LTM Revenue', 
        value: this.formatCurrency(metrics.ltmRevenue), 
        color: [99, 102, 241],
        subtitle: 'Last 12 months avg monthly'
      },
      { 
        title: 'Net Margin', 
        value: `${metrics.netMargin}%`, 
        color: metrics.netMargin > 20 ? [16, 185, 129] : [245, 158, 11],
        subtitle: 'Revenue after all expenses'
      },
      { 
        title: 'Customers', 
        value: metrics.customers.toString(), 
        color: [59, 130, 246],
        subtitle: 'Active customer count'
      }
    ]

    metricsArray.forEach((metric, index) => {
      const col = index % 4
      const row = Math.floor(index / 4)
      const x = this.margin + col * (cardWidth + 10)
      const y = startY + row * (cardHeight + 15)

      // Card background
      this.pdf.setFillColor(249, 250, 251)
      this.pdf.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'F')

      // Card border
      this.pdf.setDrawColor(229, 231, 235)
      this.pdf.setLineWidth(0.5)
      this.pdf.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'S')

      // Title
      this.pdf.setTextColor(75, 85, 99)
      this.pdf.setFontSize(11)
      this.pdf.setFont('helvetica', 'bold')
      this.pdf.text(metric.title, x + 5, y + 12)

      // Value
      this.pdf.setTextColor(metric.color[0], metric.color[1], metric.color[2])
      this.pdf.setFontSize(18)
      this.pdf.setFont('helvetica', 'bold')
      this.pdf.text(metric.value, x + 5, y + 25)

      // Subtitle
      this.pdf.setTextColor(107, 114, 128)
      this.pdf.setFontSize(8)
      this.pdf.setFont('helvetica', 'normal')
      const subtitleLines = this.pdf.splitTextToSize(metric.subtitle, cardWidth - 10)
      this.pdf.text(subtitleLines, x + 5, y + 35)
    })

    // No comments section for this slide - full focus on metrics
  }

  private async createPerformanceChartsSlide(): Promise<void> {
    await this.addSlideHeader('Performance Charts')
    
    // Larger chart areas with smaller comments section
    const chartWidth = (this.pageWidth - 2 * this.margin - 80) * 0.75 / 2
    const chartHeight = 100

    // MRR vs Plan chart placeholder
    this.pdf.setFillColor(248, 250, 252)
    this.pdf.rect(this.margin, 60, chartWidth, chartHeight, 'F')
    this.pdf.setDrawColor(203, 213, 225)
    this.pdf.rect(this.margin, 60, chartWidth, chartHeight, 'S')

    this.pdf.setTextColor(51, 65, 85)
    this.pdf.setFontSize(12)
    this.pdf.setFont('helvetica', 'bold')
    this.pdf.text('MRR vs Plan Comparison', this.margin + 5, 75)
    
    this.pdf.setFont('helvetica', 'normal')
    this.pdf.setFontSize(10)
    this.pdf.text('• Current MRR performance vs targets', this.margin + 5, 85)
    this.pdf.text('• Month-over-month growth trends', this.margin + 5, 95)
    this.pdf.text('• LTM average comparison', this.margin + 5, 105)
    this.pdf.text('[Chart will be rendered here]', this.margin + 5, 145)

    // Burn Rate chart placeholder
    this.pdf.setFillColor(248, 250, 252)
    this.pdf.rect(this.margin + chartWidth + 15, 60, chartWidth, chartHeight, 'F')
    this.pdf.setDrawColor(203, 213, 225)
    this.pdf.rect(this.margin + chartWidth + 15, 60, chartWidth, chartHeight, 'S')

    this.pdf.setTextColor(51, 65, 85)
    this.pdf.setFontSize(12)
    this.pdf.setFont('helvetica', 'bold')
    this.pdf.text('Monthly Burn Rate Analysis', this.margin + chartWidth + 20, 75)
    
    this.pdf.setFont('helvetica', 'normal')
    this.pdf.setFontSize(10)
    this.pdf.text('• Revenue vs expense trends', this.margin + chartWidth + 20, 85)
    this.pdf.text('• Net burn rate progression', this.margin + chartWidth + 20, 95)
    this.pdf.text('• Efficiency improvements', this.margin + chartWidth + 20, 105)
    this.pdf.text('[Chart will be rendered here]', this.margin + chartWidth + 20, 145)

    await this.addSmallerCommentsSection('Performance shows consistent growth with controlled burn rate.')
  }

  private async createFinancialSlide(): Promise<void> {
    await this.addSlideHeader('Financial Analysis')
    
    // Larger chart area with smaller comments
    const chartWidth = (this.pageWidth - 2 * this.margin - 80) * 0.8
    const chartHeight = 100

    this.pdf.setFillColor(248, 250, 252)
    this.pdf.rect(this.margin, 60, chartWidth, chartHeight, 'F')
    this.pdf.setDrawColor(203, 213, 225)
    this.pdf.rect(this.margin, 60, chartWidth, chartHeight, 'S')

    this.pdf.setTextColor(51, 65, 85)
    this.pdf.setFontSize(14)
    this.pdf.setFont('helvetica', 'bold')
    this.pdf.text('Financial Performance Overview', this.margin + 10, 80)

    // Key financial metrics
    const metrics = this.getCurrentMetrics()
    this.pdf.setFontSize(10)
    this.pdf.setFont('helvetica', 'normal')
    this.pdf.text(`• Net Margin: ${metrics.netMargin}%`, this.margin + 10, 95)
    this.pdf.text(`• Monthly Revenue: ${this.formatCurrency(metrics.mrr)}`, this.margin + 10, 105)
    this.pdf.text(`• Cash Runway: ${this.calculateRunway(metrics)} months`, this.margin + 10, 115)
    this.pdf.text('• Income statement breakdown', this.margin + 10, 125)
    this.pdf.text('• Variance analysis vs budget', this.margin + 10, 135)
    this.pdf.text('[Financial charts will be rendered here]', this.margin + 10, 150)

    await this.addSmallerCommentsSection('Strong financial position with healthy margins.')
  }

  private async createSalesSlide(): Promise<void> {
    await this.addSlideHeader('Sales Pipeline Analysis')
    
    // Larger chart area
    const chartWidth = (this.pageWidth - 2 * this.margin - 80) * 0.8
    const chartHeight = 100

    this.pdf.setFillColor(248, 250, 252)
    this.pdf.rect(this.margin, 60, chartWidth, chartHeight, 'F')
    this.pdf.setDrawColor(203, 213, 225)
    this.pdf.rect(this.margin, 60, chartWidth, chartHeight, 'S')

    this.pdf.setTextColor(51, 65, 85)
    this.pdf.setFontSize(14)
    this.pdf.setFont('helvetica', 'bold')
    this.pdf.text('Sales Funnel & Pipeline Performance', this.margin + 10, 80)

    const metrics = this.getCurrentMetrics()
    this.pdf.setFontSize(10)
    this.pdf.setFont('helvetica', 'normal')
    this.pdf.text(`• Contracted Revenue: ${this.formatCurrency(metrics.contracted)}`, this.margin + 10, 95)
    this.pdf.text('• Sales funnel conversion rates', this.margin + 10, 105)
    this.pdf.text('• Pipeline forecast by closing date', this.margin + 10, 115)
    this.pdf.text('• Top deals by product category', this.margin + 10, 125)
    this.pdf.text('• Win rate and sales cycle analysis', this.margin + 10, 135)
    this.pdf.text('[Sales charts will be rendered here]', this.margin + 10, 150)

    await this.addSmallerCommentsSection('Strong pipeline momentum with healthy conversion rates.')
  }

  private async createCashFlowSlide(): Promise<void> {
    await this.addSlideHeader('Cash Flow Analysis')
    
    // Larger chart area
    const chartWidth = (this.pageWidth - 2 * this.margin - 80) * 0.8
    const chartHeight = 100

    this.pdf.setFillColor(248, 250, 252)
    this.pdf.rect(this.margin, 60, chartWidth, chartHeight, 'F')
    this.pdf.setDrawColor(203, 213, 225)
    this.pdf.rect(this.margin, 60, chartWidth, chartHeight, 'S')

    this.pdf.setTextColor(51, 65, 85)
    this.pdf.setFontSize(14)
    this.pdf.setFont('helvetica', 'bold')
    this.pdf.text('Cash Flow & Runway Analysis', this.margin + 10, 80)

    const metrics = this.getCurrentMetrics()
    const runway = this.calculateRunway(metrics)
    
    this.pdf.setFontSize(10)
    this.pdf.setFont('helvetica', 'normal')
    this.pdf.text(`• Current Cash Balance: ${this.formatCurrency(metrics.cashBalance)}`, this.margin + 10, 95)
    this.pdf.text(`• Monthly Burn Rate: ${this.formatCurrency(metrics.burnRate)}`, this.margin + 10, 105)
    this.pdf.text(`• Cash Runway: ${runway} months`, this.margin + 10, 115)
    this.pdf.text('• Cash balance trends over time', this.margin + 10, 125)
    this.pdf.text('• Category-wise cash flow breakdown', this.margin + 10, 135)
    this.pdf.text('[Cash flow charts will be rendered here]', this.margin + 10, 150)

    await this.addSmallerCommentsSection(`Cash runway of ${runway} months provides adequate buffer.`)
  }

  private async addSlideHeader(title: string): Promise<void> {
    // Dark blue header background
    this.pdf.setFillColor(52, 73, 94)
    this.pdf.rect(0, 0, this.pageWidth, 40, 'F')

    // Title
    this.pdf.setTextColor(255, 255, 255)
    this.pdf.setFontSize(20)
    this.pdf.setFont('helvetica', 'bold')
    this.pdf.text(title, this.margin, 25)

    // Logo placeholder
    this.pdf.setFontSize(10)
    this.pdf.text('[LOGO]', this.pageWidth - 40, 25)
  }

  private async addCommentsSection(comment: string): Promise<void> {
    const commentsX = this.pageWidth - 120
    const commentsWidth = 100

    // Comments box background
    this.pdf.setFillColor(249, 250, 251)
    this.pdf.rect(commentsX, 60, commentsWidth, 90, 'F')
    
    // Comments box border
    this.pdf.setDrawColor(209, 213, 219)
    this.pdf.setLineWidth(0.5)
    this.pdf.rect(commentsX, 60, commentsWidth, 90, 'S')

    // Comments header
    this.pdf.setTextColor(75, 85, 99)
    this.pdf.setFontSize(12)
    this.pdf.setFont('helvetica', 'bold')
    this.pdf.text('Key Insights', commentsX + 5, 75)

    // Comments text
    this.pdf.setFont('helvetica', 'normal')
    this.pdf.setFontSize(9)
    const lines = this.pdf.splitTextToSize(comment, commentsWidth - 10)
    this.pdf.text(lines, commentsX + 5, 85)
  }

  private async addSmallerCommentsSection(comment: string): Promise<void> {
    const commentsX = this.pageWidth - 80
    const commentsWidth = 60

    // Smaller comments box background
    this.pdf.setFillColor(249, 250, 251)
    this.pdf.rect(commentsX, 60, commentsWidth, 70, 'F')
    
    // Comments box border
    this.pdf.setDrawColor(209, 213, 219)
    this.pdf.setLineWidth(0.5)
    this.pdf.rect(commentsX, 60, commentsWidth, 70, 'S')

    // Comments header
    this.pdf.setTextColor(75, 85, 99)
    this.pdf.setFontSize(10)
    this.pdf.setFont('helvetica', 'bold')
    this.pdf.text('Key Insights', commentsX + 3, 72)

    // Comments text
    this.pdf.setFont('helvetica', 'normal')
    this.pdf.setFontSize(8)
    const lines = this.pdf.splitTextToSize(comment, commentsWidth - 6)
    this.pdf.text(lines, commentsX + 3, 82)
  }

  private getCurrentMetrics(): MetricsData {
    // Get metrics from localStorage
    const transactions = localStorage.getItem('transactions')
    const deals = localStorage.getItem('crmDeals')
    
    if (!transactions) {
      return {
        mrr: 0,
        arr: 0,
        cashBalance: 0,
        burnRate: 0,
        contracted: 0,
        ltmRevenue: 0,
        netMargin: 0,
        customers: 0
      }
    }
    
    const transactionData = JSON.parse(transactions)
    const dealData = deals ? JSON.parse(deals) : []
    
    const currentMonth = new Date()
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
    
    const currentMonthTx = transactionData.filter((t: any) => {
      const date = new Date(t['Date'] || t.date)
      return date >= monthStart && date <= monthEnd
    })
    
    const mrr = currentMonthTx
      .filter((t: any) => (t['Category'] || t.category) === 'Subscription' && (t['Amount'] || t.amount) > 0)
      .reduce((sum: number, t: any) => sum + (t['Amount'] || t.amount), 0)
    
    const cashBalance = transactionData.reduce((sum: number, t: any) => sum + (t['Amount'] || t.amount), 0)
    
    const monthlyRevenue = currentMonthTx
      .filter((t: any) => (t['Amount'] || t.amount) > 0)
      .reduce((sum: number, t: any) => sum + (t['Amount'] || t.amount), 0)
    
    const monthlyExpenses = Math.abs(currentMonthTx
      .filter((t: any) => (t['Amount'] || t.amount) < 0)
      .reduce((sum: number, t: any) => sum + (t['Amount'] || t.amount), 0))
    
    const netMargin = monthlyRevenue > 0 ? ((monthlyRevenue - monthlyExpenses) / monthlyRevenue * 100) : 0
    
    const contracted = dealData
      .filter((d: any) => (d.phase || '').toLowerCase().includes('negotiation') || (d.phase || '').toLowerCase().includes('closed'))
      .reduce((sum: number, d: any) => sum + (d.amount || 0), 0)
    
    const customers = new Set(dealData.map((d: any) => d.clientName).filter(Boolean)).size

    return {
      mrr: Math.round(mrr),
      arr: Math.round(mrr * 12),
      cashBalance: Math.round(cashBalance),
      burnRate: Math.round(Math.max(0, monthlyExpenses - monthlyRevenue)),
      contracted: Math.round(contracted),
      ltmRevenue: Math.round(mrr), // Simplified
      netMargin: Math.round(netMargin),
      customers: customers
    }
  }

  private formatCurrency(value: number): string {
    const absValue = Math.abs(value)
    if (absValue >= 1000000) {
      return `€${(value / 1000000).toFixed(1)}M`
    } else if (absValue >= 1000) {
      return `€${(value / 1000).toFixed(1)}k`
    }
    return `€${value.toFixed(0)}`
  }

  private calculateRunway(metrics: MetricsData): number {
    if (metrics.burnRate <= 0) return 999
    return Math.round(metrics.cashBalance / metrics.burnRate)
  }
}