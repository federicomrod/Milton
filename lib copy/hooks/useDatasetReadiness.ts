// lib/hooks/useDatasetReadiness.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { miltonEventsAPI } from '@/lib/milton-events'

type Readiness = 'pending' | 'linked' | 'insightable'

export function useDatasetReadiness(tableName: string) {
  const [state, setState] = useState<Readiness>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const supabase = useMemo(() => createClient(), [])
  const mountedRef = useRef(true)
  const lastStateRef = useRef<Readiness>('pending')

  useEffect(() => {
    mountedRef.current = true
    const fetchOnce = async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('table_status')
          .select('readiness_state')
          .eq('table_name', tableName)
          .maybeSingle()

        if (!mountedRef.current) return
        if (error) {
          console.error('[useDatasetReadiness] fetch error', error)
          setError(error as any)
          setState('pending')
        } else if (data?.readiness_state) {
          const newState = data.readiness_state as Readiness
          if (newState !== state) {
            setState(newState)
            // When readiness becomes 'insightable', notify Milton
            if (newState === 'insightable' && lastStateRef.current !== 'insightable') {
              miltonEventsAPI.publish('dataset.ready', { tableName, state: newState })
            }
            lastStateRef.current = newState
          }
        } else {
          setState('pending')
        }
      } catch (e) {
        if (!mountedRef.current) return
        setError(e as Error)
        setState('pending')
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    }

    fetchOnce()

    // Lightweight polling (15s) so UI updates without manual refresh
    const pollId = setInterval(fetchOnce, 15000)

    // Optional realtime: update on Postgres changes (non-breaking if not configured)
    const channel = supabase
      .channel('table_status_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_status', filter: `table_name=eq.${tableName}` },
        (payload) => {
          if (!mountedRef.current) return
          const next = (payload.new as any)?.readiness_state as Readiness | undefined
          if (next && next !== state) {
            setState(next)
            if (next === 'insightable' && lastStateRef.current !== 'insightable') {
              miltonEventsAPI.publish('dataset.ready', { tableName, state: next })
            }
            lastStateRef.current = next
          }
        }
      )
      .subscribe()

    return () => {
      mountedRef.current = false
      clearInterval(pollId)
      try {
        supabase.removeChannel(channel)
      } catch {}
    }
  }, [tableName, supabase])

  return { state, loading, error }
}
