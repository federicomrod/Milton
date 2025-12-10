'use client'
import React from 'react'
import { miltonEventsAPI } from '@/lib/milton-events'

type Dataset = {
  id: string
  dataset_type?: 'transactions' | 'crm_deals' | 'budgets' | string
  source_meta?: { linkedTable?: string; [k: string]: any }
  [k: string]: any
}

type Props = {
  datasets: Dataset[]
  onPreview: (dataset: Dataset) => void
  onReplace: (dataset: Dataset) => void
  onDelete: (dataset: Dataset) => void
  onClear?: () => void
}

export default function LinkedUploadsSidebar({
  datasets,
  onPreview,
  onReplace,
  onDelete,
  onClear,
}: Props) {
  const [collapsed, setCollapsed] = React.useState(false)

  // Guard to prevent duplicate emits per session
  const hasEmittedRef = React.useRef(false)

  React.useEffect(() => {
    const required = ['transactions', 'crm_deals', 'budgets']
    const byType: Record<string, Dataset | undefined> = {}

    for (const ds of datasets) {
      if (ds.dataset_type && required.includes(ds.dataset_type)) {
        byType[ds.dataset_type] = ds
      }
    }

    const allLinked = required.every(
      (type) => byType[type] && byType[type]?.source_meta?.linkedTable
    )

    if (allLinked && !hasEmittedRef.current) {
      hasEmittedRef.current = true
      const payload = { datasets, timestamp: Date.now() }
      console.log('[LinkedUploadsSidebar] Emitting datasets.linked once', payload)
      miltonEventsAPI.publish('datasets.linked', payload)
    }
  }, [datasets])

  return (
    <>
      <div
        className={`transition-transform duration-300 fixed right-0 top-16 h-[calc(100vh-4rem)] w-80 bg-white border-l border-gray-200 shadow-lg overflow-y-auto transform ${
          collapsed ? 'translate-x-full' : 'translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-700 text-sm">
            Linked Uploads
          </h3>
          <button
            onClick={() => setCollapsed(true)}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Collapse sidebar"
          >
            ◀
          </button>
        </div>

        <div className="p-4 space-y-3">
          {datasets.length > 0 ? (
            datasets.map((ds) => (
              <div
                key={ds.id}
                className="border border-gray-200 rounded-md p-2 shadow-sm hover:shadow-md transition"
              >
                <p className="text-sm font-medium text-gray-800 truncate">
                  {ds.dataset_name || 'Unknown File'}
                </p>
                <p className="text-xs text-gray-500">
                  Linked to:{' '}
                  {ds.source_meta?.linkedTable
                    ? ds.source_meta.linkedTable
                    : ds.source_meta?.sheetName
                    ? ds.source_meta.sheetName
                    : ds.dataset_type || 'Unlinked'}
                </p>
                <p className="text-xs text-gray-400 mb-1">
                  {new Date(ds.created_at).toLocaleDateString()}
                </p>
                <div className="flex space-x-2 mt-1">
                  <button
                    onClick={() => onPreview(ds)}
                    className="px-2 py-0.5 text-xs bg-gray-100 rounded hover:bg-gray-200"
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => onReplace(ds)}
                    className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Replace
                  </button>
                  <button
                    onClick={() => onDelete(ds)}
                    className="px-2 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-400 italic">
              No datasets uploaded yet.
            </p>
          )}
        </div>
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed right-0 top-16 h-12 w-6 bg-white border border-gray-200 border-l-0 rounded-l-md shadow-md flex items-center justify-center text-gray-500 hover:text-gray-700"
          aria-label="Expand sidebar"
        >
          ▶
        </button>
      )}
    </>
  )
}
