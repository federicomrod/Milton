"use client"

import { UserPreferencesProvider } from '@/lib/context/UserPreferencesContext'
import { ReactNode } from 'react'

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <UserPreferencesProvider>
      {children}
    </UserPreferencesProvider>
  )
}

