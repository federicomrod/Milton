'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useToast } from '../ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import {
  proposalToGraph,
  ModelProposal,
  addField,
  removeField,
  renameField,
  addRelationship,
  removeRelationship,
  upsertFileMapping,
  linkParsedSheetToModel,
  autoLinkDatasetsToModel,
} from '@/lib/model/transform'
import { upsertCustomDataset, listCustomDatasets, deleteCustomDataset, updateDatasetClassification } from '@/lib/model/dataset-service'
import ColumnEditor from '@/components/dashboard/ColumnEditor'
import DataPreviewModal from '@/components/dashboard/DataPreviewModal'
import LinkedUploadsSidebar from '@/components/dashboard/LinkedUploadsSidebar'

import { miltonEventsAPI } from '@/lib/milton-events'

// Helper to mark a table as linked in the model
function markTableLinked(m: any, tableName: string, datasetId: string, datasetName: string) {
  const clone = JSON.parse(JSON.stringify(m));
  const idx = clone.recommendedTables?.findIndex(
    (t: any) => t && typeof t.name === 'string' && t.name.toLowerCase() === tableName.toLowerCase()
  ) ?? -1;
  if (idx >= 0) {
    const tbl = clone.recommendedTables[idx];
    tbl.isLinked = true;
    tbl.linkedDatasetId = datasetId ?? tbl.linkedDatasetId;
    tbl.linkedMeta = {
      ...(tbl.linkedMeta || {}),
      datasetId: datasetId ?? tbl.linkedMeta?.datasetId,
      datasetName: datasetName ?? tbl.linkedMeta?.datasetName,
    };
    clone.recommendedTables[idx] = tbl;
  }
  return clone;
}

// Temporary type aliases to satisfy TypeScript when using dynamic require for ReactFlow
type Node = any
type Edge = any
type Connection = any

// Optional ReactFlow imports - gracefully handle missing package
let ReactFlow: any = null
let Background: any = null
let Controls: any = null
let MiniMap: any = null
let addEdge: any = null
let applyNodeChanges: any = null
let applyEdgeChanges: any = null

try {
  const reactflowModule = require('reactflow')
  ReactFlow = reactflowModule.default || reactflowModule.ReactFlow
  Background = reactflowModule.Background
  Controls = reactflowModule.Controls
  MiniMap = reactflowModule.MiniMap
  addEdge = reactflowModule.addEdge
  applyNodeChanges = reactflowModule.applyNodeChanges
  applyEdgeChanges = reactflowModule.applyEdgeChanges
  require('reactflow/dist/style.css')
} catch (e) {
  console.warn('reactflow not installed. Run: npm install reactflow')
}

export default function DataModelBuilder() {
  const [model, setModel] = useState<ModelProposal | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [datasets, setDatasets] = useState<any[]>([])

  const [previewData, setPreviewData] = useState<any | null>(null)
  const [selectedSheet, setSelectedSheet] = useState<any | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'edit' | 'readonly'>('edit')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [datasetBeingReplaced, setDatasetBeingReplaced] = useState<any | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>(
    typeof window !== 'undefined' ? localStorage.getItem('businessModel') || '' : ''
  )

  const { toast } = useToast()

  const handleModelChange = (value: string) => {
    setSelectedModel(value)
    if (typeof window !== 'undefined') {
      localStorage.setItem('businessModel', value)
    }
    console.log('[DataModelBuilder] Selected business model:', value)
  }

  const handleGenerateDashboard = () => {
    const model = localStorage.getItem('businessModel') || ''
    miltonEventsAPI.publish('dashboard.generate', { businessModel: model })
    console.log('[DataModelBuilder] Dashboard generation requested for', model)
  }

  const handleUploadData = () => {
    setDatasetBeingReplaced(null)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/files/parse', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (res.ok && data.sheets && data.sheets.length > 0) {
        setPreviewData(data)
        // Auto-select first sheet
        setSelectedSheet(data.sheets[0])
        setIsPreviewOpen(true)
      } else {
        console.error('File parse error:', data.error)
        toast({
          title: 'Upload failed',
          description: data?.error || 'The file could not be parsed.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      console.error('Upload failed:', err)
      toast({
        title: 'Upload failed',
        description: (err as Error)?.message || 'Network or server error while uploading.',
        variant: 'destructive',
      })
    } finally {
      e.target.value = ''
    }
  }

  const handleSaveParsedSheet = async (payload: {
    fileName: string
    sheetName: string
    columns: string[]
    sampleRows: Record<string, unknown>[]
  }) => {
    if (!model) {
      toast({
        title: 'Error linking file',
        description: 'Model not found. Please try again.',
        variant: 'destructive',
      })
      return
    }

    try {
      // 1) Update in-memory model
      const baseModel = JSON.parse(JSON.stringify(model));
      const { updatedModel, targetTable } = linkParsedSheetToModel(baseModel, {
        columns: payload.columns,
        sheetName: payload.sheetName,
      })

      let nextModel = updatedModel
      let linkedModel = updatedModel
      // 1a) Hoist AI classification variable for later use
      let aiClassification: any = null;
      let datasetResult: any = null;

      // 2) Persist model back to Supabase
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Upsert model for user by user_id
        const { error: upsertError } = await supabase
          .from('business_models')
          .upsert({ user_id: user.id, model_json: updatedModel }, { onConflict: 'user_id' })
        if (upsertError) throw upsertError

        // Upsert custom dataset using user.id as key
        datasetResult = await upsertCustomDataset(
          user.id,
          {
            fileName: payload.fileName,
            sheetName: payload.sheetName,
            columns: payload.columns,
            sampleRows: payload.sampleRows,
          },
          datasetBeingReplaced?.id
        )

        // Attach linked table name to dataset metadata for sidebar display
        if (datasetResult?.source_meta) {
          datasetResult.source_meta.linkedTable = targetTable;
        } else {
          datasetResult.source_meta = { linkedTable: targetTable };
        }

        // Mark table as linked in the model with the new dataset info
        linkedModel = markTableLinked(updatedModel, targetTable, datasetResult?.id, datasetResult?.dataset_name);

        // AI classification (background, non-blocking)
        try {
          const classificationResponse = await fetch('/api/ai/dataset-classifier', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              datasetName: payload.fileName,
              columns: payload.columns,
              sampleRows: payload.sampleRows,
              businessContext: model?.businessType || 'general startup'
            })
          })

          if (classificationResponse.ok && datasetResult?.id) {
            const classification = await classificationResponse.json()
            aiClassification = classification
            // Update dataset with AI classification results
            await updateDatasetClassification(datasetResult.id, {
              ...payload,
              aiClassification: classification
            })
          }
        } catch (err) {
          console.warn('Dataset classification skipped:', err)
        }

        // Ensure we fetch latest datasets and auto-link using freshest model
        try {
          await refreshDatasets()
          const dsList = await listCustomDatasets(user.id)
          linkedModel = autoLinkDatasetsToModel(linkedModel, dsList)
        } catch (err) {
          console.warn('Auto-linking skipped:', err)
        }

        // Update model_json for the existing business_model row, using the linked model
        const { error } = await supabase
          .from('business_models')
          .update({ model_json: linkedModel })
          .eq('user_id', user.id)

        if (error) throw error

        // --- Begin Strict Sequencing: refreshDatasets first, then setModel, event, toast, emits ---
        await refreshDatasets()
        setModel(linkedModel)
        window.dispatchEvent(new Event('model:updated'))
        // Emit Milton chat event after a short delay to ensure component is mounted
        setTimeout(() => {
          console.log('[Milton] emitting post-refresh chat event');
          miltonEventsAPI.publish('chat', { role: 'milton', content: `Your ${targetTable} data is ready and linked.` });
        }, 500);
        toast({
          title: 'Dataset linked',
          description: `Milton linked ${payload.fileName} to the ${targetTable} table successfully.`,
        })
        miltonEventsAPI.publish('datasets.linked', { targetTable, datasetName: datasetResult?.dataset_name })
        miltonEventsAPI.publish('chat', { role: 'milton', content: `I linked ${payload.sheetName || payload.fileName} to ${targetTable}.` })
        // --- End Strict Sequencing ---
        nextModel = linkedModel
      }

      // 3) Notify and refresh
      localStorage.setItem('milton-model', JSON.stringify(nextModel))
      setIsPreviewOpen(false)
      setPreviewData(null)
      setSelectedSheet(null)
      setPreviewMode('edit')
      setDatasetBeingReplaced(null)
      // (No duplicate refreshDatasets or emits here)
    } catch (err: any) {
      // Ensure we log but do not interrupt uploads
      console.error('Error in handleSaveParsedSheet:', err)
      toast({
        title: 'Error linking file',
        description: err?.message || 'An unexpected error occurred while saving your data.',
        variant: 'destructive',
      })
      setDatasetBeingReplaced(null)
    }
  }


  const refreshDatasets = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    try {
      const rows = await listCustomDatasets(user.id)
      setDatasets(rows)
    } catch (e) {
      console.error('Failed to load datasets:', e)
    }
  }

  const handlePreviewDataset = (ds: any) => {
    setDatasetBeingReplaced(null)
    setPreviewData({
      fileName: ds.dataset_name,
      sheets: [{
        name: ds.source_meta?.sheetName || 'Sheet',
        columns: ds.schema_json,
        sampleRows: ds.rows_json
      }]
    })
    setSelectedSheet({
      name: ds.source_meta?.sheetName || 'Sheet',
      columns: ds.schema_json,
      sampleRows: ds.rows_json
    })
    setPreviewMode('readonly')
    setIsPreviewOpen(true)
  }

  const handleReplaceDataset = (ds: any) => {
    setDatasetBeingReplaced(ds)
    setIsPreviewOpen(false)
    fileInputRef.current?.click()
  }

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedTable(node.data.label)
  }, [])

  // Load model from Supabase or localStorage
  useEffect(() => {
    async function loadModel() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      let loaded: ModelProposal | null = null
      if (user) {
        const { data } = await supabase
          .from('business_models')
          .select('user_id, model_json')
          .eq('user_id', user.id)
          .single()
        loaded = data?.model_json ?? null
      }

      if (!loaded) {
        const local = localStorage.getItem('milton-model')
        if (local) {
          try {
            loaded = JSON.parse(local)
          } catch (e) {
            console.error('Failed to parse localStorage model JSON', e)
          }
        }
      }

      if (loaded) setModel(loaded)
      refreshDatasets()
    }
    loadModel()
  }, [])

  // Listen for model updates
  useEffect(() => {
    const onUpdated = () => refreshDatasets()
    window.addEventListener('model:updated', onUpdated)
    return () => window.removeEventListener('model:updated', onUpdated)
  }, [])

  // Convert proposal to graph
  useEffect(() => {
    if (!model) return
    const graph = proposalToGraph(model)
    // Highlight linked nodes
    // const linkedBySheet = new Set(
    //   datasets
    //     .map((d) => d.source_meta?.sheetName?.toLowerCase())
    //     .filter(Boolean)
    // )
    const linkedTableMeta = new Map<string, { datasetId?: string; datasetName?: string }>()
    model.recommendedTables?.forEach((tbl) => {
      const normalizedName = typeof tbl.name === 'string' ? tbl.name.toLowerCase() : ''
      if ((tbl as any).isLinked && normalizedName) {
        linkedTableMeta.set(normalizedName, { 
          datasetId: (tbl as any).linkedDatasetId,
          datasetName: (tbl as any).linkedMeta?.datasetName
        })
      }
    })
    // const datasetById = new Map(datasets.map((d) => [d.id, d]))
    // const recentLinked = (typeof window !== 'undefined' && (window as any).__recentLinkedTable) ? String((window as any).__recentLinkedTable) : ''
    const mappedNodes: Node[] = graph.nodes.map((n) => {
      const normalizedLabel = n.label.toLowerCase()
      // Find the corresponding table in the model
      const tbl = model.recommendedTables?.find(
        (t) => typeof t.name === 'string' && t.name.toLowerCase() === normalizedLabel
      ) as any
      const metadata = tbl?.linkedMeta
      // New logic: isLinked and tooltipText derive directly from model data
      const isLinked = !!tbl?.isLinked;
      const tooltipText = tbl?.linkedMeta?.datasetName || metadata?.datasetName;
      const isSelected = selectedTable === n.table
      return {
        id: n.id,
        data: {
          label: (
            <div className="relative group text-sm">
              <span className="flex items-center">
                {n.label}
                {isLinked && <span className="ml-1">📎</span>}
              </span>
              {isLinked && (
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-gray-800 text-white text-xs p-1 rounded shadow-md z-50">
                  Linked: {tooltipText || 'Dataset'}
                </div>
              )}
            </div>
          ),
        },
        position: n.position || { x: 0, y: 0 },
        style: {
          background: isSelected ? '#dbeafe' : (isLinked ? '#e8ffe8' : '#fff'),
          border: isLinked ? '2px solid #22c55e' : '1px solid #ccc',
          borderRadius: 6,
          padding: 4,
          fontSize: 12,
          boxShadow: isLinked ? '0 0 12px rgba(34,197,94,0.5)' : 'none',
          transition: 'all 0.4s ease-in-out',
        },
      }
    })
    const mappedEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: '#2563eb' },
    }))
    setNodes(mappedNodes)
    setEdges(mappedEdges)
  }, [model, selectedTable])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!model) return
      const fromTable = nodes.find((n) => n.id === connection.source)?.data.label
      const toTable = nodes.find((n) => n.id === connection.target)?.data.label
      if (fromTable && toTable) {
        const updated = addRelationship(model, {
          from: `${fromTable}.id`,
          to: `${toTable}.id`,
          type: 'one-to-many',
        })
        setModel(updated)
      }
    },
    [model, nodes]
  )

  const onNodesChange = useCallback((changes: any) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const onEdgesChange = useCallback((changes: any) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  const handleSave = async () => {
    if (!model) return
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { error } = await supabase
          .from('business_models')
          .update({ model_json: model })
          .eq('user_id', user.id)
        if (error) {
          console.error('Failed to save model to Supabase:', error)
        }
      }
      localStorage.setItem('milton-model', JSON.stringify(model))
      window.dispatchEvent(new Event('model:updated'))
      toast({
        title: 'Model saved',
        description: 'Your data model was saved successfully.',
      })
    } finally {
      setSaving(false)
    }
  }

  // Auto-save on model changes (debounced)
  useEffect(() => {
    if (!model) return
    const timer = setTimeout(async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { error } = await supabase
            .from('business_models')
            .update({ model_json: model })
            .eq('user_id', user.id)
          if (error) {
            console.error('Auto-save failed:', error)
          }
        }
        localStorage.setItem('milton-model', JSON.stringify(model))
        // Silent auto-save: no toasts or banners
      } catch (e) {
        console.error('Auto-save failed', e)
      }
    }, 1500) // 1.5s debounce
    return () => clearTimeout(timer)
  }, [model])

  if (!model || !model.recommendedTables || model.recommendedTables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
        <p>No tables detected yet.</p>
        <p className="mt-2">Upload your data files to start building your dashboards.</p>
      </div>
    )
  }

  if (!ReactFlow) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        <div className="text-center">
          <p className="mb-2">ReactFlow is not installed.</p>
          <p className="text-xs">Run: <code className="bg-gray-100 px-2 py-1 rounded">npm install reactflow</code></p>
        </div>
      </div>
    )
  }


  return (
    <div className="relative h-[85vh] w-full flex flex-col bg-white rounded-md shadow-sm">
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      {/* Header with business model select + buttons */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <div>
          <h2 className="text-lg font-semibold mb-1">Your Data Model</h2>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            className="border p-1 rounded text-gray-800 text-sm max-w-xs inline-block"
          >
            <option value="">Select business model</option>
            <option value="b2b_startup">B2B Startup</option>
            <option value="sports_studio">Sports Studio</option>
          </select>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleUploadData}
            className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Upload Data Files
          </button>
          <button
            onClick={() =>
              miltonEventsAPI.publish('dashboard.generate', { businessModel: selectedModel })
            }
            className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Generate Dashboard
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-3 py-1 text-white rounded ${
              saving ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {saving ? 'Saving…' : 'Save Model'}
          </button>
        </div>
      </div>

      {/* Main visual data model canvas */}
      <div className="flex-1 relative overflow-visible">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          onNodeClick={onNodeClick}
          className="h-full"
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
      {/* Linked Uploads Sidebar - restored to last fully working version with collapsibility and header */}
      <div className="absolute left-0 top-0 h-full z-30">
        <LinkedUploadsSidebar
          datasets={datasets}
          onPreview={handlePreviewDataset}
          onReplace={handleReplaceDataset}
          onDelete={async (ds) => {
            try {
              await deleteCustomDataset(ds.id)
              toast({
                title: 'Dataset deleted',
                description: `${ds.dataset_name} was removed.`
              })
              await refreshDatasets()
            } catch (err) {
              toast({
                title: 'Error deleting dataset',
                description: 'Failed to remove dataset. Please try again.',
                variant: 'destructive',
              })
            }
          }}
        />
      </div>
      {/* Table field sidebar */}
      {selectedTable && (
        <div className="absolute right-0 top-0 h-full w-80 bg-white border-l border-gray-200 shadow-lg p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-700 text-sm">{selectedTable} Fields</h3>
            <button
              className="text-xs text-gray-500 hover:text-gray-800"
              onClick={() => setSelectedTable(null)}
            >
              ✕
            </button>
          </div>
          {(() => {
            const table = model?.recommendedTables.find((t) => t.name === selectedTable)
            if (!table) return <p className="text-xs text-gray-400">No table found.</p>
            const handleRename = (index: number, newName: string) => {
              const oldName = table!.fields[index].name
              setModel(renameField(model!, selectedTable!, oldName, newName))
            }
            const handleTypeChange = (index: number, newType: string) => {
              const t = { ...model! }
              const tblIndex = t.recommendedTables.findIndex((tt) => tt.name === selectedTable)
              if (tblIndex === -1) return
              const tbl = { ...t.recommendedTables[tblIndex] }
              const fields = [...tbl.fields]
              fields[index] = { ...fields[index], type: newType }
              tbl.fields = fields
              const recommendedTables = [...t.recommendedTables]
              recommendedTables[tblIndex] = tbl
              setModel({ ...t, recommendedTables })
            }
            const handleDelete = (index: number) => {
              const fieldName = table!.fields[index].name
              setModel(removeField(model!, selectedTable!, fieldName))
            }
            const handleAddField = () => {
              const newField = { name: `new_field_${table!.fields.length + 1}`, type: 'string' }
              setModel(addField(model!, selectedTable!, newField))
            }
            return (
              <div>
                <ColumnEditor
                  columns={table!.fields.map((f) => ({ name: f.name, type: f.type || 'string' }))}
                  onRename={handleRename}
                  onTypeChange={handleTypeChange}
                  onDelete={handleDelete}
                />
                <button
                  onClick={handleAddField}
                  className="mt-3 w-full py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  + Add Field
                </button>
              </div>
            )
          })()}
        </div>
      )}
      {/* Preview Modal */}
      {isPreviewOpen && selectedSheet && (
        <DataPreviewModal
          open={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false)
            setPreviewData(null)
            setSelectedSheet(null)
            setPreviewMode('edit')
            setDatasetBeingReplaced(null)
          }}
          fileName={previewData?.fileName || ''}
          sheetName={selectedSheet.name}
          columns={selectedSheet.columns}
          sampleRows={selectedSheet.sampleRows}
          onSave={previewMode === 'edit' ? handleSaveParsedSheet : undefined}
          readOnly={previewMode === 'readonly'}
        />
      )}
    </div>
  )
}
