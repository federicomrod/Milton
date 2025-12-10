import { UseCase, getUseCase } from '@/types/use-cases'

export const generateAIPromptForUseCase = (useCaseId: string, fileName: string, headers: string[], sampleData: any[]) => {
  const useCase = getUseCase(useCaseId)
  
  if (!useCase) {
    throw new Error(`Use case not found: ${useCaseId}`)
  }

  return `
You are an expert financial data analyst for ${useCase.name} businesses.

BUSINESS CONTEXT: ${useCase.aiPromptContext}

REQUIRED METRICS FOR THIS BUSINESS TYPE:
${useCase.requiredMetrics.map(metric => `
- ${metric.name}: ${metric.description}
  Required inputs: ${metric.requiredInputs.map(input => input.field).join(', ')}
  Calculation: ${metric.calculation.formula}
`).join('')}

FILE ANALYSIS:
- File: ${fileName}
- Headers: ${JSON.stringify(headers)}
- Sample data: ${JSON.stringify(sampleData.slice(0, 3))}

Your task is to map the file columns to the standard schema fields needed for calculating the metrics above.

RESPONSE FORMAT (JSON only):
{
  "fileType": "transactions|crm|budget",
  "confidence": 0.8-1.0,
  "reasoning": "explanation of your analysis",
  "columnMappings": [
    {
      "originalHeader": "exact header name",
      "suggestedField": "standard field name",
      "confidence": 0.8-1.0,
      "aiReasoning": "why this mapping makes sense"
    }
  ],
  "businessInsights": {
    "revenueColumns": ["columns that contain revenue"],
    "expenseColumns": ["columns that contain expenses"],
    "recurringRevenue": ["columns with recurring revenue patterns"],
    "primaryAmountColumn": "main amount column",
    "dateFormat": "detected date format",
    "numberFormat": "detected number format"
  }
}
`
}