import * as XLSX from 'xlsx'
import Papa from 'papaparse'

export interface ParsedFile {
  headers: string[]
  rows: Record<string, any>[]
}

export class FileParser {
  static async parse(file: File): Promise<ParsedFile> {
    if (file.name.endsWith('.csv')) {
      return await this.parseCSV(file)
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      return await this.parseExcel(file)
    } else {
      throw new Error('Unsupported file type')
    }
  }

  static async parseCSV(file: File): Promise<ParsedFile> {
    const text = await file.text()
    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true
    })

    return {
      headers: result.meta.fields || [],
      rows: result.data as Record<string, any>[]
    }
  }

  static async parseExcel(file: File): Promise<ParsedFile> {
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[]

    const headers = rows.length > 0 ? Object.keys(rows[0]) : []

    return {
      headers,
      rows
    }
  }
}