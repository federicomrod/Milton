'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface MiltonChatProps {
  onFinish: (answers: {
    industry: string
    employees: string
    goals: string
    revenue: string
    dataSources: string
    systems: string
    businessDescription: string
  }) => void
  messages: { from: 'milton' | 'user'; text: string }[]
  setMessages: React.Dispatch<React.SetStateAction<{ from: 'milton' | 'user'; text: string }[]>>
}

export default function MiltonChat({ onFinish, messages, setMessages }: MiltonChatProps) {
  const [step, setStep] = useState<'intro' | 'industry' | 'employees' | 'goals' | 'revenue' | 'data' | 'systems' | 'confirm' | 'done'>('intro')
  const [input, setInput] = useState('')
  const [answers, setAnswers] = useState<{
    industry?: string
    employees?: string
    goals?: string
    revenue?: string
    dataSources?: string
    systems?: string
    businessDescription?: string
  }>({})
  const hasFinishedRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        { from: 'milton', text: "Hi, I'm Milton 👋 — your AI finance copilot." },
        { from: 'milton', text: "Can I ask you a few quick questions to set up your workspace?" }
      ])
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function sendUserMessage(text: string) {
    setMessages((prev) => [...prev, { from: 'user', text }])
    setInput('')
  }

  function nextStep() {
    if (step === 'intro') {
      setStep('industry')
      setMessages((prev) => [...prev, { from: 'milton', text: 'Great! What industry are you in?' }])
    } else if (step === 'industry') {
      setStep('employees')
      setMessages((prev) => [...prev, { from: 'milton', text: 'Got it. How many employees do you have?' }])
    } else if (step === 'employees') {
      setStep('goals')
      setMessages((prev) => [...prev, { from: 'milton', text: 'Perfect. What are your main financial goals right now?' }])
    } else if (step === 'goals') {
      setStep('revenue')
      setMessages((prev) => [...prev, { from: 'milton', text: 'How does your company generate revenue?' }])
    } else if (step === 'revenue') {
      setStep('data')
      setMessages((prev) => [...prev, { from: 'milton', text: 'What kind of data do you already track or have in files?' }])
    } else if (step === 'data') {
      setStep('systems')
      setMessages((prev) => [...prev, { from: 'milton', text: 'Do you use any software systems like a CRM, Stripe, or ERP?' }])
    } else if (step === 'systems') {
      setStep('confirm')
      setMessages((prev) => [...prev, { from: 'milton', text: 'Thanks! Let me summarize what I understood and prepare your workspace.' }])
    }
  }

  function finish(nextAnswers: any) {
    if (hasFinishedRef.current) return
    hasFinishedRef.current = true
  
    setStep('done')
    setMessages((prev) => [
      ...prev,
      { from: 'milton', text: 'Awesome! Let me process this and prepare your KPI suggestions and data model proposal.' },
      { from: 'milton', text: 'Please hold on while I prepare everything. You’ll be redirected shortly to your data model builder.' }
    ])
    try {
      console.log('✅ Final answers ready for onFinish:', nextAnswers)
      onFinish(nextAnswers)
    } catch (err) {
      console.error('Error finishing onboarding:', err)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    sendUserMessage(input)

    if (step === 'industry') setAnswers((a) => ({ ...a, industry: input }))
    else if (step === 'employees') setAnswers((a) => ({ ...a, employees: input }))
    else if (step === 'goals') setAnswers((a) => ({ ...a, goals: input }))
    else if (step === 'revenue') setAnswers((a) => ({ ...a, revenue: input }))
    else if (step === 'data') setAnswers((a) => ({ ...a, dataSources: input }))
    else if (step === 'systems') setAnswers((a) => ({ ...a, systems: input }))
    else if (step === 'confirm') {
      setAnswers((prev) => {
        const businessDescription = `Industry: ${prev.industry}, Employees: ${prev.employees}, Goals: ${prev.goals}, Revenue: ${prev.revenue}, Data: ${prev.dataSources}, Systems: ${prev.systems}`
        const next = { ...prev, businessDescription }
        setTimeout(() => finish(next), 600)
        return next
      })
      return
    }

    setTimeout(() => nextStep(), 600)
  }

  return (
    <div className="p-6 space-y-4">
      {messages.map((m, i) => (
        <div key={i} className={`flex ${m.from === 'milton' ? 'justify-start' : 'justify-end'}`}>
          <Card
            className={`p-3 max-w-xs text-sm ${
              m.from === 'milton' ? 'bg-blue-50 text-gray-700' : 'bg-green-50 text-gray-800'
            }`}
          >
            {m.text}
          </Card>
        </div>
      ))}
      <div ref={messagesEndRef} />

      {step !== 'done' && (
        <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
          <input
            type="text"
            className="border rounded p-2 flex-1"
            placeholder={
              step === 'intro'
                ? 'Click Next to start...'
                : step === 'industry'
                ? 'e.g., Yoga Studio'
                : step === 'employees'
                ? 'e.g., 5'
                : step === 'goals'
                ? 'e.g., Grow revenue, improve cash flow'
                : step === 'revenue'
                ? 'e.g., Subscription fees, product sales'
                : step === 'data'
                ? 'e.g., Excel sheets, Google Analytics'
                : step === 'systems'
                ? 'e.g., Salesforce, Stripe, NetSuite'
                : 'Confirm and send'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={step === 'intro'}
          />
          {step === 'intro' ? (
            <Button type="button" onClick={() => nextStep()}>Next</Button>
          ) : (
            <Button type="submit">Send</Button>
          )}
        </form>
      )}
    </div>
  )
}