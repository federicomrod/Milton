'use client'
import React, { useState, useEffect, useRef } from 'react'
import { miltonEventsAPI } from '@/lib/milton-events'



export default function MiltonChat() {
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')
  const chatBodyRef = useRef<HTMLDivElement>(null)
  const hasPromptedRef = useRef(false)

  // ✅ Auto-scroll to bottom on new message
  useEffect(() => {
    const el = chatBodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // ✅ Listen once for dataset readiness → single prompt
  useEffect(() => {
    const unsubscribe = miltonEventsAPI.subscribe('datasets.linked', () => {
      if (hasPromptedRef.current) return
      hasPromptedRef.current = true
      setMessages(prev => [
        ...prev,
        { id: Date.now(), from: 'milton', text: '✅ All data sources are linked. Would you like me to generate insights?', type: 'prompt' },
      ])
    })
    return () => unsubscribe()
  }, [])

  // ✅ Listen for dashboard data ready
  useEffect(() => {
    const unsubscribeDashboard = miltonEventsAPI.subscribe('dashboard.data.ready', (payload) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          from: 'milton',
          text: `✅ Dashboard ready! I've generated visuals for your key KPIs under the ${payload.businessModel.replace('_', ' ')} model.`,
        },
      ])
    })
    return () => unsubscribeDashboard()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    setMessages(prev => [...prev, { id: Date.now(), from: 'user', text: input.trim() }])
    setInput('')
  }

  return (
    <div className="flex flex-col h-full">
      <div
        ref={chatBodyRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50"
        style={{ scrollBehavior: 'smooth' }}
      >
        {messages.map(msg => (
          <div key={msg.id} className={msg.from === 'milton' ? 'text-blue-900' : 'text-gray-800'}>
            {msg.text}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t bg-white flex items-center gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask Milton about your data..."
          className="flex-1 resize-none border rounded px-3 py-2 text-sm focus:ring focus:ring-blue-500"
          rows={1}
        />
        <button
          type="submit"
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Send
        </button>
      </form>
    </div>
  )
}