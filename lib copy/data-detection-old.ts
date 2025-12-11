// lib/data-detection.ts
export interface ColumnMapping {
    original: string
    standardField: string
    confidence: number
    detected: boolean
  }
  
  export interface DataStructure {
    type: 'single-category' | 'multi-category' | 'unknown'
    language: 'en' | 'de' | 'unknown'
    dateFormat: string
    currencySymbol: string
    amountColumn: string
    dateColumn: string
    descriptionColumn: string
    categoryMapping: ColumnMapping[]
  }
  
  export interface DetectionResult {
    structure: DataStructure
    sampleData: any[]
    suggestedMappings: ColumnMapping[]
    needsUserConfirmation: boolean
  }
  
  export class DataDetectionService {
    
    // Standard field categories we want to map to
    private standardFields = {
      date: ['date', 'datum', 'transaction_date', 'booking_date'],
      amount: ['amount', 'betrag', 'value', 'summe', 'total'],
      description: ['description', 'beschreibung', 'name', 'verwendungszweck', 'reference'],
      category: ['category', 'kategorie', 'type', 'art']
    }
  
    // Standard chart of accounts categories
    private standardCategories = {
      revenue: [
        'subscription', 'recurring', 'mrr', 'abonnement',
        'service', 'consulting', 'beratung', 'dienstleistung',
        'sales', 'umsatz', 'einnahmen', 'revenue'
      ],
      cogs: [
        'cogs', 'cost of goods', 'herstellungskosten', 'wareneinsatz',
        'direct costs', 'direkte kosten', 'production', 'produktion'
      ],
      expenses: {
        salaries: ['salary', 'gehalt', 'lohn', 'personal', 'payroll'],
        marketing: ['marketing', 'advertising', 'werbung', 'promotion'],
        rent: ['rent', 'miete', 'office', 'büro'],
        software: ['software', 'saas', 'tools', 'subscriptions'],
        travel: ['travel', 'reise', 'transport', 'fahrt'],
        other: ['other', 'sonstige', 'misc', 'verschiedenes']
      }
    }
  
    async detectDataStructure(data: any[], fileName: string): Promise<DetectionResult> {
      if (!data || data.length === 0) {
        throw new Error('No data provided for detection')
      }
  
      const headers = Object.keys(data[0])
      const sampleData = data.slice(0, 10)
      
      // Detect basic structure
      const structure: DataStructure = {
        type: this.detectCategoryStructure(headers, sampleData),
        language: this.detectLanguage(headers),
        dateFormat: this.detectDateFormat(sampleData, headers),
        currencySymbol: this.detectCurrencySymbol(sampleData, headers),
        amountColumn: this.detectAmountColumn(headers),
        dateColumn: this.detectDateColumn(headers),
        descriptionColumn: this.detectDescriptionColumn(headers),
        categoryMapping: []
      }
  
      // Create column mappings
      const suggestedMappings = this.createColumnMappings(headers, sampleData, structure)
      
      // Determine if user confirmation is needed
      const needsUserConfirmation = this.shouldRequestConfirmation(suggestedMappings, structure)
  
      return {
        structure,
        sampleData,
        suggestedMappings,
        needsUserConfirmation
      }
    }
  
    private detectCategoryStructure(headers: string[], data: any[]): 'single-category' | 'multi-category' | 'unknown' {
      // Check if there's a single category column
      const hasSingleCategory = headers.some(h => 
        this.standardFields.category.some(cat => 
          h.toLowerCase().includes(cat.toLowerCase())
        )
      )
  
      if (hasSingleCategory) {
        return 'single-category'
      }
  
      // Check if multiple columns might represent categories (like your German example)
      const potentialCategoryColumns = headers.filter(h => {
        // Look for columns that might be category names
        return Object.values(this.standardCategories.expenses).flat()
          .concat(this.standardCategories.revenue)
          .concat(this.standardCategories.cogs)
          .some(cat => h.toLowerCase().includes(cat.toLowerCase()))
      })
  
      if (potentialCategoryColumns.length > 2) {
        return 'multi-category'
      }
  
      return 'unknown'
    }
  
    private detectLanguage(headers: string[]): 'en' | 'de' | 'unknown' {
      const germanWords = ['betrag', 'datum', 'beschreibung', 'kategorie', 'verwendungszweck']
      const englishWords = ['amount', 'date', 'description', 'category', 'reference']
  
      const germanCount = headers.filter(h => 
        germanWords.some(word => h.toLowerCase().includes(word))
      ).length
  
      const englishCount = headers.filter(h => 
        englishWords.some(word => h.toLowerCase().includes(word))
      ).length
  
      if (germanCount > englishCount) return 'de'
      if (englishCount > germanCount) return 'en'
      return 'unknown'
    }
  
    private detectDateFormat(data: any[], headers: string[]): string {
      const dateColumn = this.detectDateColumn(headers)
      if (!dateColumn || !data[0]?.[dateColumn]) return 'unknown'
  
      const dateValue = data[0][dateColumn]
      
      // Common patterns
      if (typeof dateValue === 'string') {
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) return 'YYYY-MM-DD'
        if (dateValue.match(/^\d{2}\.\d{2}\.\d{4}$/)) return 'DD.MM.YYYY'
        if (dateValue.match(/^\d{2}\/\d{2}\/\d{4}$/)) return 'MM/DD/YYYY'
        if (dateValue.match(/^\d{2}-\d{2}-\d{4}$/)) return 'DD-MM-YYYY'
      }
      
      return 'unknown'
    }
  
    private detectCurrencySymbol(data: any[], headers: string[]): string {
      const amountColumn = this.detectAmountColumn(headers)
      if (!amountColumn) return '€'
  
      // Check if amounts are stored as strings with currency symbols
      const amountValues = data.slice(0, 5).map(row => row[amountColumn])
      
      for (const value of amountValues) {
        if (typeof value === 'string') {
          if (value.includes('€')) return '€'
          if (value.includes('$')) return '$'
          if (value.includes('£')) return '£'
        }
      }
  
      return '€' // Default for European clients
    }
  
    private detectAmountColumn(headers: string[]): string {
      return headers.find(h => 
        this.standardFields.amount.some(pattern => 
          h.toLowerCase().includes(pattern.toLowerCase())
        )
      ) || ''
    }
  
    private detectDateColumn(headers: string[]): string {
      return headers.find(h => 
        this.standardFields.date.some(pattern => 
          h.toLowerCase().includes(pattern.toLowerCase())
        )
      ) || ''
    }
  
    private detectDescriptionColumn(headers: string[]): string {
      return headers.find(h => 
        this.standardFields.description.some(pattern => 
          h.toLowerCase().includes(pattern.toLowerCase())
        )
      ) || ''
    }
  
    private createColumnMappings(headers: string[], data: any[], structure: DataStructure): ColumnMapping[] {
      const mappings: ColumnMapping[] = []
  
      // Map core fields
      mappings.push({
        original: structure.dateColumn,
        standardField: 'date',
        confidence: structure.dateColumn ? 0.9 : 0.1,
        detected: !!structure.dateColumn
      })
  
      mappings.push({
        original: structure.amountColumn,
        standardField: 'amount',
        confidence: structure.amountColumn ? 0.9 : 0.1,
        detected: !!structure.amountColumn
      })
  
      mappings.push({
        original: structure.descriptionColumn,
        standardField: 'description',
        confidence: structure.descriptionColumn ? 0.8 : 0.1,
        detected: !!structure.descriptionColumn
      })
  
      // Handle category mapping based on structure type
      if (structure.type === 'single-category') {
        const categoryColumn = headers.find(h => 
          this.standardFields.category.some(cat => 
            h.toLowerCase().includes(cat.toLowerCase())
          )
        )
        
        if (categoryColumn) {
          mappings.push({
            original: categoryColumn,
            standardField: 'category',
            confidence: 0.8,
            detected: true
          })
        }
      } else if (structure.type === 'multi-category') {
        // For multi-category, we'll need to identify which columns represent categories
        const categoryColumns = headers.filter(h => {
          return Object.values(this.standardCategories.expenses).flat()
            .concat(this.standardCategories.revenue)
            .concat(this.standardCategories.cogs)
            .some(cat => h.toLowerCase().includes(cat.toLowerCase()))
        })
  
        categoryColumns.forEach(col => {
          const standardCategory = this.mapToStandardCategory(col)
          mappings.push({
            original: col,
            standardField: `category_${standardCategory}`,
            confidence: 0.7,
            detected: true
          })
        })
      }
  
      return mappings.filter(m => m.original) // Remove empty mappings
    }
  
    private mapToStandardCategory(columnName: string): string {
      const lowerCol = columnName.toLowerCase()
      
      // Check revenue categories
      if (this.standardCategories.revenue.some(cat => lowerCol.includes(cat))) {
        return 'revenue'
      }
      
      // Check COGS
      if (this.standardCategories.cogs.some(cat => lowerCol.includes(cat))) {
        return 'cogs'
      }
      
      // Check expense subcategories
      for (const [subcat, keywords] of Object.entries(this.standardCategories.expenses)) {
        if (keywords.some(keyword => lowerCol.includes(keyword))) {
          return subcat
        }
      }
      
      return 'other'
    }
  
    private shouldRequestConfirmation(mappings: ColumnMapping[], structure: DataStructure): boolean {
      // Request confirmation if:
      // 1. Any core field has low confidence
      const coreFields = mappings.filter(m => ['date', 'amount', 'description'].includes(m.standardField))
      const lowConfidenceCore = coreFields.some(m => m.confidence < 0.8)
      
      // 2. Language detection is uncertain
      const languageUncertain = structure.language === 'unknown'
      
      // 3. Category structure is unknown
      const categoryUncertain = structure.type === 'unknown'
      
      // 4. Less than 3 core fields detected
      const insufficientFields = coreFields.filter(m => m.detected).length < 3
  
      return lowConfidenceCore || languageUncertain || categoryUncertain || insufficientFields
    }
  
    // Helper method to normalize data after user confirmation
    normalizeData(rawData: any[], confirmedMappings: ColumnMapping[], structure: DataStructure): any[] {
      return rawData.map(row => {
        const normalizedRow: any = {}
        
        confirmedMappings.forEach(mapping => {
          if (mapping.standardField === 'amount') {
            normalizedRow.amount = this.normalizeAmount(row[mapping.original], structure.currencySymbol)
          } else if (mapping.standardField === 'date') {
            normalizedRow.date = this.normalizeDate(row[mapping.original], structure.dateFormat)
          } else if (mapping.standardField === 'category') {
            normalizedRow.category = this.normalizeCategory(row[mapping.original])
          } else if (mapping.standardField.startsWith('category_')) {
            // Handle multi-category structure
            const categoryType = mapping.standardField.replace('category_', '')
            if (row[mapping.original]) {
              normalizedRow.category = categoryType
            }
          } else {
            normalizedRow[mapping.standardField] = row[mapping.original]
          }
        })
  
        // Generate ID if not present
        if (!normalizedRow.id) {
          normalizedRow.id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }
  
        return normalizedRow
      }).filter(row => row.amount !== undefined && row.date) // Remove invalid rows
    }
  
    private normalizeAmount(value: any, currencySymbol: string): number {
      if (typeof value === 'number') return value
      
      if (typeof value === 'string') {
        // Remove currency symbols and spaces
        let cleanValue = value.replace(/[€$£\s]/g, '')
        
        // Handle different decimal separators
        if (cleanValue.includes(',') && cleanValue.includes('.')) {
          // European format: 1.234,56
          cleanValue = cleanValue.replace(/\./g, '').replace(',', '.')
        } else if (cleanValue.includes(',')) {
          // Could be European decimal or US thousands separator
          const parts = cleanValue.split(',')
          if (parts.length === 2 && parts[1].length <= 2) {
            // European decimal: 1234,56
            cleanValue = cleanValue.replace(',', '.')
          } else {
            // US thousands: 1,234
            cleanValue = cleanValue.replace(/,/g, '')
          }
        }
        
        return parseFloat(cleanValue) || 0
      }
      
      return 0
    }
  
    private normalizeDate(value: any, format: string): string {
      if (!value) return ''
      
      try {
        let date: Date
        
        if (format === 'DD.MM.YYYY' && typeof value === 'string') {
          const [day, month, year] = value.split('.')
          date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
        } else if (format === 'MM/DD/YYYY' && typeof value === 'string') {
          const [month, day, year] = value.split('/')
          date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
        } else {
          date = new Date(value)
        }
        
        return date.toISOString().split('T')[0] // Return YYYY-MM-DD format
      } catch {
        return value.toString()
      }
    }
  
    private normalizeCategory(value: any): string {
      if (!value) return 'Other'
      return value.toString().trim()
    }
  }