'use client'

import * as React from 'react'

type Toast = {
  id?: string
  title?: string
  description?: string
  variant?: 'default' | 'destructive'
}

type ToastContextValue = {
  toasts: Toast[]
  addToast: (toast: Toast) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = (toast: Toast) => {
    const id = toast.id || Math.random().toString(36).substring(2)
    setToasts((current) => [...current, { ...toast, id }])
    setTimeout(() => removeToast(id), 4000)
  }

  const removeToast = (id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-3 rounded text-white text-sm shadow-md ${
              toast.variant === 'destructive' ? 'bg-red-600' : 'bg-green-600'
            }`}
          >
            <strong>{toast.title}</strong>
            {toast.description && <div className="mt-1 opacity-90">{toast.description}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return {
    toast: ctx.addToast,
  }
}