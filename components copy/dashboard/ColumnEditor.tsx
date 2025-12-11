'use client'
import React from 'react'
import { Select, SelectItem, SelectTrigger, SelectValue, SelectContent } from '@/components/ui/select'

export interface ColumnEditorProps {
  columns: { name: string; type: string }[]
  types?: string[]
  onRename: (index: number, newName: string) => void
  onTypeChange: (index: number, newType: string) => void
  onDelete: (index: number) => void
}

const DEFAULT_TYPES = ['string', 'number', 'date', 'boolean', 'currency']

export const ColumnEditor: React.FC<ColumnEditorProps> = ({
  columns,
  types = DEFAULT_TYPES,
  onRename,
  onTypeChange,
  onDelete
}) => {
  return (
    <>
      {columns.map((col, i) => (
        <div key={i} className="p-2 border-b min-w-[120px]">
          <input
            value={col.name}
            onChange={e => onRename(i, e.target.value)}
            className="border rounded px-1 py-0.5 w-24"
          />
          <Select onValueChange={v => onTypeChange(i, v)} value={col.type}>
            <SelectTrigger className="mt-1 w-24">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {types.map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => onDelete(i)}
            className="ml-2 text-xs text-red-600 hover:text-red-700 underline"
            aria-label={`Delete column ${col.name}`}
          >
            Delete
          </button>
        </div>
      ))}
    </>
  )
}

export default ColumnEditor

