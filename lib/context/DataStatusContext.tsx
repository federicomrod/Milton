'use client'

import React, { createContext, useContext } from 'react'

interface DataStatusContextType {
  refreshDataStatus: () => Promise<void>
}

const DataStatusContext = createContext<DataStatusContextType | undefined>(undefined)

export function useDataStatus() {
  const context = useContext(DataStatusContext)
  if (!context) {
    throw new Error('useDataStatus must be used within a DataStatusProvider')
  }
  return context
}

export const DataStatusProvider = DataStatusContext.Provider

