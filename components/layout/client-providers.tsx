"use client"

import { UserPreferencesProvider } from '@/lib/context/UserPreferencesContext'
import { BusinessProvider } from '@/lib/business-context'
import { ReactNode } from 'react'

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <UserPreferencesProvider>
      <BusinessProvider>
        {children}
      </BusinessProvider>
    </UserPreferencesProvider>
  )
}

