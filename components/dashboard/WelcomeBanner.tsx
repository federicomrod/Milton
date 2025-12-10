'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

export default function WelcomeBanner() {
  const search = useSearchParams()
  const router = useRouter()
  const [hasModel, setHasModel] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const welcome = search.get('welcome')

  useEffect(() => {
    router.prefetch('/dashboard/model') // Prefetch for instant navigation

    try {
      const raw = localStorage.getItem('milton-model')
      const isDismissed = localStorage.getItem('milton-banner-dismissed') === 'true'
      if (isDismissed) setDismissed(true)
      if (raw && JSON.parse(raw)) setHasModel(true)
    } catch {
      // ignore JSON parse errors
    }
  }, [router])

  if (dismissed || (!welcome && !hasModel)) return null

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem('milton-banner-dismissed', 'true')
  }

  return (
    <div className="mb-4 rounded-lg border bg-blue-50 p-4 flex items-center justify-between">
      <div>
        <div className="font-semibold">Your workspace is ready</div>
        <div className="text-sm text-blue-900/80">
          We generated a data model tailored to your business. Review it and adjust relationships.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/model"
          className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          Review AI Data Model
        </Link>
        <button
          onClick={handleDismiss}
          className="text-xs text-blue-800/80 hover:text-blue-950 underline"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}