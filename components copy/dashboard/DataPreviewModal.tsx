'use client'
import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'

export type PreviewSheetPayload = {
  fileName: string
  sheetName: string
  columns: string[]
  sampleRows: Record<string, unknown>[]
}

interface Props {
  open: boolean
  onClose: () => void
  fileName: string
  sheetName: string
  columns: string[]
  sampleRows: Record<string, any>[]
  onSave?: (payload: PreviewSheetPayload) => void
  readOnly?: boolean
}

const DataPreviewModal: React.FC<Props> = ({ open, onClose, fileName, sheetName, columns: initialColumns, sampleRows, onSave, readOnly = false }) => {
  const [columns, setColumns] = useState<string[]>(initialColumns)
  const [rows, setRows] = useState<Record<string, unknown>[]>(sampleRows.map(row => ({ ...row })))

  useEffect(() => {
    setColumns(initialColumns)
  }, [initialColumns])

  const handleHeaderChange = (index: number, newName: string) => {
    const updated = [...columns]
    updated[index] = newName
    setColumns(updated)
  }

  const handleDeleteColumn = (index: number) => {
    const name = columns[index]
    const updatedCols = columns.filter((_, i) => i !== index)
    setColumns(updatedCols)
    setRows(prev =>
      prev.map(row => {
        const { [name]: _discard, ...rest } = row
        return rest
      })
    )
  }

  const handleSave = () => {
    if (onSave) {
      onSave({
        fileName,
        sheetName,
        columns,
        sampleRows: rows,
      })
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded shadow-lg w-[98vw] h-[80vh] flex flex-col p-4">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Preview & Transform — {fileName} ({sheetName})</h2>
        </div>

        <div className="overflow-auto flex-grow border rounded bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                {columns.map((col, i) => (
                  <th key={i} className="p-2 border-b">
                    <div className="flex items-center gap-2">
                      {readOnly ? (
                        <span className="text-gray-700 font-medium">{col}</span>
                      ) : (
                        <input
                          className="w-48 px-2 py-1 border rounded"
                          value={col}
                          onChange={(e) => handleHeaderChange(i, e.target.value)}
                        />
                      )}
                      {!readOnly && (
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => handleDeleteColumn(i)}
                          type="button"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((row, rIdx) => (
                <tr key={rIdx} className="border-b hover:bg-gray-50">
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className="p-2 whitespace-nowrap">
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && onSave && (
            <Button
              onClick={handleSave}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Save & Link to Model
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default DataPreviewModal