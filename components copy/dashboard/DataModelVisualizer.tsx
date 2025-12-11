'use client'
import React, { useEffect, useState } from 'react'

import { proposalToGraph, ModelProposal } from '@/lib/model/transform'

// Note: This component requires 'reactflow' to be installed
// Run: npm install reactflow
let ReactFlow: any = null
let MiniMap: any = null
let Controls: any = null
let Background: any = null

// Define types for ReactFlow nodes and edges
type ReactFlowNode = {
  id: string
  data: { label: React.ReactNode }
  position: { x: number; y: number }
  style?: Record<string, any>
}

type ReactFlowEdge = {
  id: string
  source: string
  target: string
  animated?: boolean
  style?: Record<string, any>
}

try {
  const reactflowModule = require('reactflow')
  ReactFlow = reactflowModule.default || reactflowModule.ReactFlow
  MiniMap = reactflowModule.MiniMap
  Controls = reactflowModule.Controls
  Background = reactflowModule.Background
  // Also try to import the CSS if available
  require('reactflow/dist/style.css')
} catch (e) {
  console.warn('reactflow not installed. Run: npm install reactflow')
}


export default function DataModelVisualizer({ model: propModel, linkedDatasets = [] }: { model?: ModelProposal, linkedDatasets?: any[] }) {
  const [model, setModel] = useState<ModelProposal | null>(propModel || null)
  const [nodes, setNodes] = useState<ReactFlowNode[]>([])
  const [edges, setEdges] = useState<ReactFlowEdge[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Try to load from localStorage first
    const stored = localStorage.getItem('milton-model')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (typeof parsed === 'object' && parsed) {
          setModel(parsed.proposal || parsed)
        } else {
          console.warn('Invalid model structure in localStorage.')
        }
      } catch (err) {
        console.error('Failed to parse milton-model:', err)
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!model) return;
    const graph = proposalToGraph(model);
    
    // Highlight linked nodes
    const generatedNodes = graph.nodes.map((n) => {
      // Normalize dataset names for matching
      const normalizedLabel = n.label.toLowerCase()
      const matchDataset = linkedDatasets.find((d) => {
        const sheet = d.source_meta?.sheetName?.toLowerCase?.()
        const detected = d.source_meta?.detectedTable?.toLowerCase?.()
        const aiDetected =
          d.source_meta?.aiClassification?.detectedTable?.toLowerCase?.()
        return (
          sheet === normalizedLabel ||
          detected === normalizedLabel ||
          aiDetected === normalizedLabel
        )
      })

      const isLinked = !!matchDataset

      return {
        id: n.id,
        data: {
          label: (
            <div
              className={`p-2 rounded shadow text-xs min-w-[150px] relative group transition-all duration-300 ${
                isLinked
                  ? 'bg-green-50 border-green-500 animate-pulse-once'
                  : 'bg-white border-gray-200'
              }`}
              title={
                isLinked
                  ? `Linked: ${
                      matchDataset?.dataset_name || 'Unknown Dataset'
                    } (AI detected: ${
                      matchDataset?.source_meta?.aiClassification
                        ?.detectedTable || 'n/a'
                    })`
                  : undefined
              }
            >
              <strong>{n.label}</strong>
              {isLinked && (
                <div className="text-green-600 text-xs font-medium mt-1">
                  ✓ Linked
                </div>
              )}
              <ul className="mt-1 list-disc ml-4">
                {n.fields.slice(0, 6).map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
                {n.fields.length > 6 && (
                  <li className="italic text-gray-400">
                    +{n.fields.length - 6} more
                  </li>
                )}
              </ul>
              {isLinked && (
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-gray-800 text-white text-xs p-1 rounded shadow-md z-50">
                  Linked to {matchDataset?.dataset_name}
                </div>
              )}
            </div>
          ),
        },
        position: n.position || { x: 0, y: 0 },
        style: isLinked
          ? {
              border: '2px solid #22c55e',
              borderRadius: 6,
              background: '#e8ffe8',
              boxShadow: '0 0 12px 2px rgba(34,197,94,0.6)',
            }
          : {
              border: '1px solid #ddd',
              borderRadius: 6,
              background: '#f9fafb',
            },
      }
    })
    const generatedEdges = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: '#2563eb' },
    }));
    setNodes(generatedNodes);
    setEdges(generatedEdges);
  }, [model, linkedDatasets]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center text-gray-500 h-full p-10">
        <p>Loading model...</p>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="flex flex-col items-center justify-center text-gray-500 h-full p-10">
        <p>No model found. Please complete onboarding first.</p>
      </div>
    )
  }

  if (!ReactFlow) {
    return (
      <div className="flex flex-col items-center justify-center text-gray-500 h-full p-10">
        <p>ReactFlow is not installed. Run: npm install reactflow</p>
      </div>
    )
  }

  return (
    <div className="w-full h-[80vh] bg-gray-50 rounded-lg border">
      <style>{`
        @keyframes pulse-once {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
          70% { box-shadow: 0 0 10px 4px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }
        .animate-pulse-once {
          animation: pulse-once 1.5s ease-out 1;
        }
      `}</style>
      <div className="p-3 border-b bg-white flex justify-between items-center">
        <h2 className="text-sm font-semibold">
          AI-Proposed Data Model — {model.businessType || 'Unknown Business'}
        </h2>
        <button
          className="text-xs bg-blue-500 text-white px-2 py-1 rounded"
          onClick={() => {
            localStorage.removeItem('milton-model')
            setModel(null)
            setNodes([])
            setEdges([])
          }}
        >
          Clear Model
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        zoomOnScroll
        panOnDrag
      >
        <MiniMap />
        <Controls />
        <Background color="#aaa" gap={12} />
      </ReactFlow>
    </div>
  )
}