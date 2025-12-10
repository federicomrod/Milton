# Chart Data Mapping Documentation

## Overview
This document explains how transaction categories are mapped and what data keys the charts expect for proper functionality.

## Category Mapping

### Revenue Categories
The enhanced data processor maps various revenue categories to standardized names using comprehensive accounting definitions:

| Input Categories | Mapped To | Description |
|------------------|-----------|-------------|
| **German**: trainings, coaching, programme, abonnement | Revenue | German revenue categories |
| **English**: revenue, income, sales, subscription | Revenue | General revenue categories |
| consulting, service, fee | Revenue | Service-based revenue |

### Expense Categories
The enhanced data processor maps various expense categories to standardized names:

| Input Categories | Mapped To | Description |
|------------------|-----------|-------------|
| **German**: gehälter, gehalt, lohn | Salaries | German salary categories |
| **English**: salary, wage, payroll | Salaries | Employee compensation |
| marketing, werbung | Marketing | Marketing expenses |
| miete, rent, lease | Rent | Office/space costs |
| software, lizenz | Software | Software licenses |
| sonstiges, other, expense | Other OpEx | General operating expenses |

## Chart Data Expectations

### 1. Income Statement Overview (Waterfall Chart)
**Expected Categories:**
- Revenue categories: `Revenue` (mapped from German/English terms)
- Expense categories: `Salaries`, `Marketing`, `Rent`, `Software`, `Other OpEx`

**Data Processing:**
- Groups transactions by category for current month
- Sums positive amounts as revenue
- Sums negative amounts as expenses
- Creates waterfall chart with Revenue → Expenses → Net Income
- **Flexible**: Works with any category names found in data

### 2. Budget Variance Analysis
**Expected Budget Keys:**
- Revenue: `budget['MRR']`, `budget['mrr']`, `budget['Monthly Revenue']`, `budget['Revenue']`
- Expenses: `budget['OPEX Total']`, `budget['Total FC']`, `budget['Total Costs']`, `budget['Expenses']`

**Expected Month Format:**
- Month keys: `'Jan 2025'`, `'Feb 2025'`, `'Jan-25'`, `'2025-01'`, etc.
- **Flexible**: Automatically detects month format from budget data

**Data Processing:**
- Compares actual revenue vs budget revenue (tries multiple key formats)
- Compares actual expenses vs budget expenses (tries multiple key formats)
- Calculates variance percentages
- **Robust**: Works with various budget structures

### 3. Year-to-Date Performance
**Expected Budget Keys:**
- Revenue: `budget['MRR']`, `budget['mrr']`, `budget['Monthly Revenue']`, `budget['Revenue']`

**Data Processing:**
- Calculates cumulative actual vs budget for each month
- Uses budget revenue values for planned revenue (tries multiple key formats)
- Shows YTD progression over the year
- **Fallback**: Uses average monthly revenue if no budget data available

## Sample Data Structure

### Transactions
```javascript
{
  id: 'tx_123',
  date: '2025-01-15',
  description: 'Subscription Revenue',
  amount: 3000,
  category: 'Subscription', // Mapped from 'revenue'
  reference: 'PAY-001'
}
```

### Budget
```javascript
{
  months: ['Jan', 'Feb', 'Mar', ...],
  'MRR': {
    'Jan 2025': 5000,
    'Feb 2025': 5500,
    // ...
  },
  'OPEX Total': {
    'Jan 2025': -3000,
    'Feb 2025': -3200,
    // ...
  }
}
```

## File Upload Testing

### Test File: `test-transactions.csv`
```csv
Date,Description,Amount,Category,Reference
2024-01-15,Office Supplies,-150.00,COGS,INV-001
2024-01-16,Client Payment,2500.00,Subscription,PAY-001
2024-01-17,Internet Bill,-89.99,Other OpEx,BILL-001
2024-01-18,Consulting Fee,1800.00,One-time Service,CONS-001
2024-01-19,Software License,-299.00,Marketing,LIC-001
```

## Implementation Notes

### Enhanced Data Processor
- **`categorizeTransaction()`** function uses comprehensive accounting definitions
- **German & English support**: Maps German categories (trainings, gehälter, miete) to standard names
- **Smart categorization**: Uses transaction description, amount, and original category
- **Fallback logic**: Defaults to Revenue for positive amounts, Other OpEx for negative amounts

### Chart Flexibility
- **Dynamic category handling**: Charts work with any category names found in data
- **Flexible budget keys**: Tries multiple key formats (`MRR`, `mrr`, `Monthly Revenue`, etc.)
- **Robust month formats**: Supports `Jan 2025`, `Jan-25`, `2025-01` formats
- **Fallback calculations**: Uses average monthly revenue if no budget data available

### Accounting Definitions
- **Comprehensive categorization**: 6 revenue categories, 6 expense categories
- **Multi-language support**: German and English terms for each category
- **Financial metrics**: Clear definitions for Revenue, Expenses, Net Income, Burn Rate, MRR
- **Budget structure**: Flexible key detection for various budget formats

### Sample Data
- Dashboard includes comprehensive sample data for testing
- Covers multiple months for burn rate charts
- Includes current month data for income statement
- Provides budget data for variance analysis and YTD performance

## Troubleshooting

### Empty Charts
1. Check that transactions have the expected categories
2. Verify budget data has correct keys (`MRR`, `OPEX Total`)
3. Ensure month format matches expected format (`'Jan 2025'`)
4. Check browser console for data processing logs

### Category Mapping Issues
1. Verify `mapCategory()` method in `enhanced-data-processor.ts`
2. Check that uploaded files are being processed correctly
3. Ensure AI mapping is working for new file uploads

### Budget Data Issues
1. Verify budget structure matches expected format
2. Check that month keys use correct format
3. Ensure budget values are numeric (not strings) 