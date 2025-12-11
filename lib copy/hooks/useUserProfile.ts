"use client"

import { useState, useEffect } from 'react'
import { getUserProfile, upsertUserProfile, UserProfile } from '../profile-service'

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<any>(null)

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await getUserProfile()
        setProfile(data)
      } catch (err) {
        console.error('Failed to load user profile:', err)
        setError(err)
      } finally {
        setLoading(false)
      }
    }
    loadProfile()
  }, [])

  const saveProfile = async (updated: Partial<UserProfile>) => {
    try {
      await upsertUserProfile(updated)
      setProfile({ ...profile, ...updated } as UserProfile)
    } catch (err) {
      console.error('Failed to update user profile:', err)
      setError(err)
    }
  }

  return { profile, saveProfile, loading, error }
}
