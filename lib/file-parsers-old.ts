import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { SupabaseClient } from '@supabase/supabase-js'

export async function parseCSV(file: File, companyId: string, supabase: SupabaseClient) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        try {
          // Process the CSV data
          const data = results.data as any[]
          
          // TODO: Implement logic to identify transaction types and extract financial data
          // For now, we'll just log the data
          console.log('CSV Data:', data)
          
          // Example: If this is a bank statement, extract transactions
          // const transactions = data.map(row => ({
          //   date: row.Date,
          //   description: row.Description,
          //   amount: parseFloat(row.Amount),
          //   type: parseFloat(row.Amount) > 0 ? 'income' : 'expense'
          // }))
          
          resolve(data)
        } catch (error) {
          reject(error)
        }
      },
      error: (error) => {
        reject(error)
      }
    })
  })
}

export async function parseExcel(file: File, companyId: string, supabase: SupabaseClient) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = async (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, { type: 'array' })
        
        // Get the first sheet
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet)
        
        // TODO: Implement logic to identify data types and extract financial data
        console.log('Excel Data:', jsonData)
        
        resolve(jsonData)
      } catch (error) {
        reject(error)
      }
    }
    
    reader.onerror = (error) => reject(error)
    reader.readAsArrayBuffer(file)
  })
}