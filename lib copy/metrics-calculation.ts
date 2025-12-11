// lib/metrics-calculation.ts

export interface MetricsData {
    mrr: number
    arr: number
    cashBalance: number
    burnRate: number
    contracted: number
    ltmRevenue: number
    grossMargin: number
    customers: number
    cac: number
    ltv: number
    churn: number
    nps: number
    runway: number
    quickRatio: number
  }
  
  export interface Transaction {
    id: string
    date: string
    description: string
    amount: number
    reference: string
    category: string
  }
  
  export interface Deal {
    id: string
    dealName: string
    phase: string
    amount: number
    clientName: string
    date: string
    product: string
  }
  
  export class MetricsCalculationService {
    
    // Category mappings for better classification
    private categoryMappings = {
      revenue: {
        subscription: ['subscription', 'recurring', 'monthly', 'yearly', 'abonnement', 'wiederkehrend'],
        oneTime: ['one-time', 'service', 'consulting', 'einmalig', 'beratung', 'projekt'],
        other: ['sales', 'revenue', 'income', 'umsatz', 'einnahmen']
      },
      cogs: {
        direct: ['cogs', 'cost of goods', 'herstellungskosten', 'wareneinsatz', 'direct cost', 'material'],
        production: ['production', 'manufacturing', 'produktion', 'fertigung']
      },
      expenses: {
        salaries: ['salary', 'wage', 'payroll', 'gehalt', 'lohn', 'personal'],
        marketing: ['marketing', 'advertising', 'ads', 'werbung', 'promotion'],
        software: ['software', 'saas', 'subscription', 'tools', 'licenses'],
        rent: ['rent', 'office', 'lease', 'miete', 'büro'],
        travel: ['travel', 'transport', 'fuel', 'reise', 'fahrt', 'sprit'],
        other: ['other', 'misc', 'general', 'sonstige', 'verschiedenes']
      }
    }
  
    calculateAllMetrics(): MetricsData {
      const transactions = this.getTransactions()
      const deals = this.getDeals()
      
      return {
        mrr: this.calculateMRR(transactions),
        arr: this.calculateARR(transactions),
        cashBalance: this.calculateCashBalance(transactions),
        burnRate: this.calculateBurnRate(transactions),
        contracted: this.calculateContracted(deals),
        ltmRevenue: this.calculateLTMRevenue(transactions),
        grossMargin: this.calculateGrossMargin(transactions),
        customers: this.calculateCustomers(transactions, deals),
        cac: this.calculateCAC(transactions, deals),
        ltv: this.calculateLTV(transactions, deals),
        churn: this.calculateChurn(deals),
        nps: this.calculateNPS(),
        runway: this.calculateRunway(transactions),
        quickRatio: this.calculateQuickRatio(transactions)
      }
    }
  
    private getTransactions(): Transaction[] {
      const data = localStorage.getItem('transactions')
      return data ? JSON.parse(data) : []
    }
  
    private getDeals(): Deal[] {
      const data = localStorage.getItem('crmDeals')
      return data ? JSON.parse(data) : []
    }
  
    private classifyTransaction(transaction: Transaction): { type: 'revenue' | 'cogs' | 'expense', subtype: string } {
      const category = transaction.category?.toLowerCase() || ''
      const description = transaction.description?.toLowerCase() || ''
      const amount = transaction.amount
  
      // Check if it's revenue (positive amount usually)
      if (amount > 0) {
        // Check for subscription revenue
        if (this.categoryMappings.revenue.subscription.some(keyword => 
          category.includes(keyword) || description.includes(keyword)
        )) {
          return { type: 'revenue', subtype: 'subscription' }
        }
        
        // Check for one-time revenue
        if (this.categoryMappings.revenue.oneTime.some(keyword => 
          category.includes(keyword) || description.includes(keyword)
        )) {
          return { type: 'revenue', subtype: 'oneTime' }
        }
        
        return { type: 'revenue', subtype: 'other' }
      }
  
      // For negative amounts, classify as COGS or expenses
      if (amount < 0) {
        // Check for COGS
        if (this.categoryMappings.cogs.direct.some(keyword => 
          category.includes(keyword) || description.includes(keyword)
        )) {
          return { type: 'cogs', subtype: 'direct' }
        }
  
        // Check for specific expense types
        for (const [expenseType, keywords] of Object.entries(this.categoryMappings.expenses)) {
          if (keywords.some(keyword => category.includes(keyword) || description.includes(keyword))) {
            return { type: 'expense', subtype: expenseType }
          }
        }
        
        return { type: 'expense', subtype: 'other' }
      }
  
      return { type: 'expense', subtype: 'other' }
    }
  
    private calculateMRR(transactions: Transaction[]): number {
      const currentMonth = new Date()
      const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
      const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
  
      const monthlyRevenue = transactions
        .filter(tx => {
          const txDate = new Date(tx.date)
          return txDate >= monthStart && txDate <= monthEnd
        })
        .filter(tx => {
          const classification = this.classifyTransaction(tx)
          return classification.type === 'revenue' && classification.subtype === 'subscription'
        })
        .reduce((sum, tx) => sum + tx.amount, 0)
  
      return Math.round(monthlyRevenue)
    }
  
    private calculateARR(transactions: Transaction[]): number {
      const mrr = this.calculateMRR(transactions)
      return mrr * 12
    }
  
    private calculateCashBalance(transactions: Transaction[]): number {
      const sortedTransactions = [...transactions].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      )
  
      return Math.round(sortedTransactions.reduce((balance, tx) => balance + tx.amount, 0))
    }
  
    private calculateBurnRate(transactions: Transaction[]): number {
      // Calculate average monthly burn for last 3 months
      const months = []
      
      for (let i = 0; i < 3; i++) {
        const date = new Date()
        date.setMonth(date.getMonth() - i)
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  
        const monthlyExpenses = transactions
          .filter(tx => {
            const txDate = new Date(tx.date)
            return txDate >= monthStart && txDate <= monthEnd && tx.amount < 0
          })
          .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  
        const monthlyRevenue = transactions
          .filter(tx => {
            const txDate = new Date(tx.date)
            return txDate >= monthStart && txDate <= monthEnd && tx.amount > 0
          })
          .reduce((sum, tx) => sum + tx.amount, 0)
  
        months.push(monthlyExpenses - monthlyRevenue)
      }
  
      const avgBurn = months.length > 0 ? months.reduce((sum, burn) => sum + burn, 0) / months.length : 0
      return Math.round(Math.max(0, avgBurn)) // Ensure non-negative
    }
  
    private calculateContracted(deals: Deal[]): number {
      const contractedDeals = deals.filter(deal => 
        deal.phase?.toLowerCase().includes('negotiation') || 
        deal.phase?.toLowerCase().includes('closed') ||
        deal.phase?.toLowerCase().includes('contract') ||
        deal.phase?.toLowerCase().includes('verhandlung') ||
        deal.phase?.toLowerCase().includes('abgeschlossen')
      )
  
      return Math.round(contractedDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0))
    }
  
    private calculateLTMRevenue(transactions: Transaction[]): number {
      const yearAgo = new Date()
      yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  
      const ltmRevenue = transactions
        .filter(tx => {
          const txDate = new Date(tx.date)
          return txDate > yearAgo && tx.amount > 0
        })
        .filter(tx => {
          const classification = this.classifyTransaction(tx)
          return classification.type === 'revenue'
        })
        .reduce((sum, tx) => sum + tx.amount, 0)
  
      return Math.round(ltmRevenue / 12) // Average monthly
    }
  
    private calculateGrossMargin(transactions: Transaction[]): number {
      const currentYear = new Date().getFullYear()
      const yearTransactions = transactions.filter(tx => 
        new Date(tx.date).getFullYear() === currentYear
      )
  
      const totalRevenue = yearTransactions
        .filter(tx => {
          const classification = this.classifyTransaction(tx)
          return classification.type === 'revenue'
        })
        .reduce((sum, tx) => sum + tx.amount, 0)
  
      const totalCOGS = yearTransactions
        .filter(tx => {
          const classification = this.classifyTransaction(tx)
          return classification.type === 'cogs'
        })
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  
      if (totalRevenue === 0) return 0
  
      const grossProfit = totalRevenue - totalCOGS
      const grossMarginPercent = (grossProfit / totalRevenue) * 100
  
      return Math.round(Math.max(0, grossMarginPercent)) // Ensure non-negative percentage
    }
  
    private calculateCustomers(transactions: Transaction[], deals: Deal[]): number {
      // Get unique customers from both transactions and deals
      const customerSet = new Set<string>()
  
      // From transactions (using description as customer identifier)
      transactions
        .filter(tx => tx.amount > 0) // Only revenue transactions
        .forEach(tx => {
          if (tx.description) {
            customerSet.add(tx.description.toLowerCase().trim())
          }
        })
  
      // From deals
      deals.forEach(deal => {
        if (deal.clientName) {
          customerSet.add(deal.clientName.toLowerCase().trim())
        }
      })
  
      return customerSet.size
    }
  
    private calculateCAC(transactions: Transaction[], deals: Deal[]): number {
      const currentMonth = new Date()
      const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
  
      // Calculate marketing expenses for current month
      const marketingExpenses = transactions
        .filter(tx => {
          const txDate = new Date(tx.date)
          const classification = this.classifyTransaction(tx)
          return txDate >= monthStart && 
                 classification.type === 'expense' && 
                 classification.subtype === 'marketing'
        })
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  
      // Count new customers this month (from deals)
      const newCustomers = deals.filter(deal => {
        const dealDate = new Date(deal.date)
        return dealDate >= monthStart && deal.phase?.toLowerCase().includes('closed')
      }).length
  
      return newCustomers > 0 ? Math.round(marketingExpenses / newCustomers) : 0
    }
  
    private calculateLTV(transactions: Transaction[], deals: Deal[]): number {
      const customers = this.calculateCustomers(transactions, deals)
      const mrr = this.calculateMRR(transactions)
      const churnRate = this.calculateChurn(deals) / 100
  
      if (churnRate === 0 || customers === 0) return 0
  
      const avgCustomerMRR = mrr / customers
      const avgCustomerLifespan = 1 / churnRate // in months
      
      return Math.round(avgCustomerMRR * avgCustomerLifespan)
    }
  
    private calculateChurn(deals: Deal[]): number {
      // Simple churn calculation based on deal phases
      const totalCustomers = deals.length
      const lostCustomers = deals.filter(deal => 
        deal.phase?.toLowerCase().includes('lost') ||
        deal.phase?.toLowerCase().includes('cancelled') ||
        deal.phase?.toLowerCase().includes('verloren')
      ).length
  
      return totalCustomers > 0 ? Math.round((lostCustomers / totalCustomers) * 100) : 0
    }
  
    private calculateNPS(): number {
      // Placeholder - would need survey data
      return 0
    }
  
    private calculateRunway(transactions: Transaction[]): number {
      const cashBalance = this.calculateCashBalance(transactions)
      const burnRate = this.calculateBurnRate(transactions)
  
      if (burnRate <= 0) return 999 // Infinite runway
  
      return Math.round(cashBalance / burnRate)
    }
  
    private calculateQuickRatio(transactions: Transaction[]): number {
      const mrr = this.calculateMRR(transactions)
      const churnRate = this.calculateBurnRate(transactions)
  
      if (churnRate === 0) return 999
  
      return Math.round((mrr / churnRate) * 100) / 100 // Round to 2 decimal places
    }
  
    // Method to get a specific metric
    getMetric(metricName: keyof MetricsData): number {
      const allMetrics = this.calculateAllMetrics()
      return allMetrics[metricName]
    }
  
    // Method to get metrics for specific time period
    getMetricsForPeriod(startDate: Date, endDate: Date): Partial<MetricsData> {
      const transactions = this.getTransactions().filter(tx => {
        const txDate = new Date(tx.date)
        return txDate >= startDate && txDate <= endDate
      })
  
      // Calculate period-specific metrics
      return {
        cashBalance: this.calculateCashBalance(transactions),
        // Add other period-specific calculations as needed
      }
    }
  }