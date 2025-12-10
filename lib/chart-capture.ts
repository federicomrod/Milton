// lib/chart-capture.ts
import html2canvas from 'html2canvas'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FinancialCharts } from '@/components/dashboard/financial-charts'
import { SalesPipeline } from '@/components/dashboard/sales-pipeline'
import { CashFlowAnalysis } from '@/components/dashboard/cash-flow-analysis'

export interface ChartCaptureOptions {
  width?: number
  height?: number
  quality?: number
  backgroundColor?: string
}

export class ChartCaptureService {
  private static instance: ChartCaptureService
  private container: HTMLDivElement | null = null

  static getInstance(): ChartCaptureService {
    // Only create instance in browser environment
    if (typeof window === 'undefined') {
      throw new Error('ChartCaptureService can only be used in browser environment')
    }
    
    if (!ChartCaptureService.instance) {
      ChartCaptureService.instance = new ChartCaptureService()
    }
    return ChartCaptureService.instance
  }

  private constructor() {
    // Don't initialize immediately - wait until needed
  }

  private initializeContainer() {
    // Check if we're in browser environment
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return
    }
    
    // Create a hidden container for rendering charts
    this.container = document.createElement('div')
    this.container.style.position = 'absolute'
    this.container.style.left = '-9999px'
    this.container.style.top = '-9999px'
    this.container.style.width = '800px'
    this.container.style.height = '600px'
    this.container.style.backgroundColor = 'white'
    this.container.style.padding = '20px'
    this.container.style.visibility = 'hidden'
    document.body.appendChild(this.container)
  }

  private ensureContainer() {
    if (!this.container && typeof document !== 'undefined') {
      this.initializeContainer()
    }
  }

  private async renderComponent(component: React.ReactElement, options: ChartCaptureOptions = {}): Promise<string> {
    // Ensure we're in browser environment
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('Chart capture requires browser environment')
    }
    
    // Ensure container is created
    this.ensureContainer()
    
    if (!this.container) {
      throw new Error('Chart capture container not initialized')
    }

    return new Promise((resolve, reject) => {
      try {
        // Set container size based on options
        if (options.width) {
          this.container!.style.width = `${options.width}px`
        }
        if (options.height) {
          this.container!.style.height = `${options.height}px`
        }

        // Create React root and render component
        if (!this.container) {
          throw new Error('Container not initialized')
        }
        const root = createRoot(this.container)
        root.render(component)

        // Wait a bit for the component to render completely
        setTimeout(async () => {
          try {
            // Capture the rendered component with better options
            const canvas = await html2canvas(this.container!, {
              backgroundColor: options.backgroundColor || 'white',
              width: options.width || 800,
              height: options.height || 600,
              scale: options.quality || 1,
              useCORS: true,
              allowTaint: true,
              logging: false,
              ignoreElements: (element) => {
                // Skip elements that might cause issues
                return element.tagName === 'SCRIPT' || element.tagName === 'STYLE'
              },
              onclone: (clonedDoc) => {
                // Fix problematic CSS properties in the cloned document
                const styles = clonedDoc.querySelectorAll('*')
                styles.forEach((el: any) => {
                  const computedStyle = getComputedStyle(el)
                  
                  // Replace oklch colors with fallback hex colors
                  if (computedStyle.color && computedStyle.color.includes('oklch')) {
                    el.style.color = '#000000' // Fallback to black
                  }
                  if (computedStyle.backgroundColor && computedStyle.backgroundColor.includes('oklch')) {
                    el.style.backgroundColor = '#ffffff' // Fallback to white
                  }
                  if (computedStyle.borderColor && computedStyle.borderColor.includes('oklch')) {
                    el.style.borderColor = '#e5e7eb' // Fallback to gray
                  }
                  
                  // Also handle other modern CSS functions that might cause issues
                  const problematicProps = ['color', 'backgroundColor', 'borderColor', 'fill', 'stroke']
                  problematicProps.forEach(prop => {
                    const value = el.style[prop]
                    if (value && (value.includes('oklch') || value.includes('lab') || value.includes('lch'))) {
                      // Set safe fallback colors
                      if (prop === 'color') el.style[prop] = '#000000'
                      else if (prop === 'backgroundColor') el.style[prop] = '#ffffff'
                      else el.style[prop] = '#e5e7eb'
                    }
                  })
                })
              }
            })

            // Convert to base64
            const base64Image = canvas.toDataURL('image/png', 0.9)

            // Clean up
            root.unmount()
            
            resolve(base64Image)
          } catch (error) {
            console.error('html2canvas failed, trying fallback method:', error)
            
            // Fallback: try with minimal options
            try {
              const fallbackCanvas = await html2canvas(this.container!, {
                backgroundColor: 'white',
                logging: false,
                scale: 1,
                useCORS: false,
                allowTaint: false
              })
              
              const fallbackBase64 = fallbackCanvas.toDataURL('image/png', 0.8)
              root.unmount()
              resolve(fallbackBase64)
            } catch (fallbackError) {
              console.error('Fallback capture also failed:', fallbackError)
              root.unmount()
              reject(new Error(`Chart capture failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`))
            }
          }
        }, 2000) // Give enough time for charts to render
      } catch (error) {
        reject(error)
      }
    })
  }

  async captureFinancialChart(
    type: 'mrr-vs-plan' | 'burn-rate' | 'income-statement' | 'variance-analysis' | 'ytd-performance',
    options: ChartCaptureOptions = {}
  ): Promise<string> {
    const component = createElement(FinancialCharts, { type })
    return this.renderComponent(component, {
      width: 760,
      height: 400,
      ...options
    })
  }

  async captureSalesPipeline(options: ChartCaptureOptions = {}): Promise<string> {
    const component = createElement(SalesPipeline)
    return this.renderComponent(component, {
      width: 760,
      height: 500,
      ...options
    })
  }

  async captureCashFlowAnalysis(options: ChartCaptureOptions = {}): Promise<string> {
    const component = createElement(CashFlowAnalysis)
    return this.renderComponent(component, {
      width: 760,
      height: 500,
      ...options
    })
  }

  // Specific capture methods for different chart sections
  async captureMRRChart(options: ChartCaptureOptions = {}): Promise<string> {
    return this.captureFinancialChart('mrr-vs-plan', {
      width: 380,
      height: 300,
      ...options
    })
  }

  async captureBurnRateChart(options: ChartCaptureOptions = {}): Promise<string> {
    return this.captureFinancialChart('burn-rate', {
      width: 380,
      height: 300,
      ...options
    })
  }

  async captureIncomeStatementChart(options: ChartCaptureOptions = {}): Promise<string> {
    return this.captureFinancialChart('income-statement', {
      width: 760,
      height: 400,
      ...options
    })
  }

  async captureVarianceAnalysisChart(options: ChartCaptureOptions = {}): Promise<string> {
    return this.captureFinancialChart('variance-analysis', {
      width: 760,
      height: 400,
      ...options
    })
  }

  async captureYTDPerformanceChart(options: ChartCaptureOptions = {}): Promise<string> {
    return this.captureFinancialChart('ytd-performance', {
      width: 760,
      height: 400,
      ...options
    })
  }

  // Method to capture multiple charts for a specific slide
  async captureChartsForSlide(slideType: 'overview' | 'financial' | 'sales' | 'cashflow'): Promise<{ [key: string]: string }> {
    const charts: { [key: string]: string } = {}

    try {
      switch (slideType) {
        case 'overview':
          charts.mrrChart = await this.captureMRRChart()
          charts.burnRateChart = await this.captureBurnRateChart()
          break

        case 'financial':
          charts.incomeStatement = await this.captureIncomeStatementChart()
          charts.varianceAnalysis = await this.captureVarianceAnalysisChart()
          charts.ytdPerformance = await this.captureYTDPerformanceChart()
          break

        case 'sales':
          charts.salesPipeline = await this.captureSalesPipeline()
          break

        case 'cashflow':
          charts.cashFlowAnalysis = await this.captureCashFlowAnalysis()
          break
      }
    } catch (error) {
      console.error(`Error capturing charts for ${slideType}:`, error)
      throw error
    }

    return charts
  }

  // Cleanup method
  cleanup() {
    if (this.container && this.container.parentNode && typeof document !== 'undefined') {
      this.container.parentNode.removeChild(this.container)
      this.container = null
    }
  }
}

// Safe chart capture service getter
export function getChartCaptureService(): ChartCaptureService | null {
  if (typeof window === 'undefined') {
    return null
  }
  return ChartCaptureService.getInstance()
}

// Helper function to preload charts for faster PDF generation
export async function preloadChartsForReport(config: any): Promise<{ [key: string]: string }> {
  // Ensure we're in browser environment
  const service = getChartCaptureService()
  if (!service) {
    throw new Error('Chart preloading requires browser environment')
  }
  
  const allCharts: { [key: string]: string } = {}

  if (config.includeOverview) {
    const overviewCharts = await service.captureChartsForSlide('overview')
    Object.assign(allCharts, overviewCharts)
  }

  if (config.includeFinancial) {
    const financialCharts = await service.captureChartsForSlide('financial')
    Object.assign(allCharts, financialCharts)
  }

  if (config.includeSales) {
    const salesCharts = await service.captureChartsForSlide('sales')
    Object.assign(allCharts, salesCharts)
  }

  if (config.includeCashFlow) {
    const cashFlowCharts = await service.captureChartsForSlide('cashflow')
    Object.assign(allCharts, cashFlowCharts)
  }

  return allCharts
}