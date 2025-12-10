"use client"

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"

interface UserPreferences {
  currency: string
  date_format: string
  number_format: string
  timezone: string
  theme: string
}

interface UserPreferencesContextType {
  prefs: UserPreferences
  setPrefs: (prefs: UserPreferences) => void
  refreshPrefs: () => Promise<void>
  loading: boolean
}

const UserPreferencesContext = createContext<UserPreferencesContextType | null>(null)

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>({
    currency: "EUR",
    date_format: "DD/MM/YYYY",
    number_format: "1,000.00",
    timezone: "Europe/Berlin",
    theme: "light",
  })
  const [loading, setLoading] = useState(true)

  const fetchPrefs = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("currency, date_format, number_format, timezone, theme")
        .eq("user_id", user.id)
        .single()

      if (error) {
        console.error("Error loading user preferences:", error)
      }

      if (data) {
        setPrefs(prev => ({
          currency: data.currency || prev.currency,
          date_format: data.date_format || prev.date_format,
          number_format: data.number_format || prev.number_format,
          timezone: data.timezone || prev.timezone,
          theme: data.theme || prev.theme,
        }))
      }
    } catch (error) {
      console.error("Failed to fetch preferences:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrefs()

    // ✅ Live subscription to profile changes in Supabase
    const supabase = createClient()
    
    const setupSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const channel = supabase
        .channel("profile-updates")
        .on(
          'postgres_changes',
          { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'profiles',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            console.log('📡 Profile updated in real-time:', payload.new)
            if (payload.new) {
              setPrefs(prev => ({
                currency: payload.new.currency || prev.currency,
                date_format: payload.new.date_format || prev.date_format,
                number_format: payload.new.number_format || prev.number_format,
                timezone: payload.new.timezone || prev.timezone,
                theme: payload.new.theme || prev.theme,
              }))
            }
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    const cleanup = setupSubscription()

    return () => {
      cleanup.then(cleanupFn => cleanupFn?.())
    }
  }, [fetchPrefs])

  return (
    <UserPreferencesContext.Provider value={{ prefs, setPrefs, refreshPrefs: fetchPrefs, loading }}>
      {children}
    </UserPreferencesContext.Provider>
  )
}

export function useUserPreferences() {
  const context = useContext(UserPreferencesContext)
  if (!context) {
    throw new Error("useUserPreferences must be used within UserPreferencesProvider")
  }
  return context
}
