"use client"

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { getUserProfile, upsertUserProfile } from '@/lib/profile-service'
import { useUserPreferences } from '@/lib/context/UserPreferencesContext'
import { Globe, DollarSign, Calendar, Hash, Palette, Building2 } from 'lucide-react'

const currencies = ['EUR', 'USD', 'GBP', 'CHF']
const dateFormats = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']
const numberFormats = ['1,000.00', '1.000,00']
const themes = ['light', 'dark', 'system']

export default function SettingsPage() {
  const { setPrefs, refreshPrefs } = useUserPreferences()
  const [form, setForm] = useState({
    company_name: '',
    industry: '',
    timezone: 'Europe/Berlin',
    currency: 'EUR',
    date_format: 'DD/MM/YYYY',
    number_format: '1,000.00',
    theme: 'light'
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getUserProfile()
        if (profile) {
          setForm({
            company_name: profile.company_name || '',
            industry: profile.industry || '',
            timezone: profile.timezone || 'Europe/Berlin',
            currency: profile.currency || 'EUR',
            date_format: profile.date_format || 'DD/MM/YYYY',
            number_format: profile.number_format || '1,000.00',
            theme: profile.theme || 'light'
          })
        }
      } catch (error) {
        console.error('Failed to load profile:', error)
      } finally {
        setLoading(false)
      }
    }
    loadProfile()
  }, [])

  const handleChange = (key: string, value: string) => {
    setForm({ ...form, [key]: value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      await upsertUserProfile(form)
      
      // ✅ Refresh preferences from Supabase - triggers live update across all components
      await refreshPrefs()
      
      setMessage('Preferences updated successfully!')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      setMessage('Failed to update preferences. Please try again.')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Manage your company profile and preferences</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Company Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Company Information
            </CardTitle>
            <CardDescription>Basic details about your organization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company_name">Company Name</Label>
              <Input
                id="company_name"
                name="company_name"
                placeholder="Enter company name"
                value={form.company_name || ''}
                onChange={(e) => handleChange('company_name', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                name="industry"
                placeholder="e.g., SaaS, E-commerce, Fintech"
                value={form.industry || ''}
                onChange={(e) => handleChange('industry', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Regional & Format Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Regional & Format Preferences
            </CardTitle>
            <CardDescription>Customize how data is displayed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="timezone" className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Timezone
              </Label>
              <Select value={form.timezone} onValueChange={(v) => handleChange('timezone', v)}>
                <SelectTrigger id="timezone">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {Intl.supportedValuesOf('timeZone').map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Currency
              </Label>
              <Select value={form.currency} onValueChange={(v) => handleChange('currency', v)}>
                <SelectTrigger id="currency">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c} - {getCurrencySymbol(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date_format" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Date Format
              </Label>
              <Select value={form.date_format} onValueChange={(v) => handleChange('date_format', v)}>
                <SelectTrigger id="date_format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dateFormats.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f} <span className="text-gray-400 ml-2">({formatDateExample(f)})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="number_format" className="flex items-center gap-2">
                <Hash className="h-4 w-4" />
                Number Format
              </Label>
              <Select value={form.number_format} onValueChange={(v) => handleChange('number_format', v)}>
                <SelectTrigger id="number_format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {numberFormats.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Appearance
            </CardTitle>
            <CardDescription>Customize the look and feel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="theme">Theme</Label>
              <Select value={form.theme} onValueChange={(v) => handleChange('theme', v)}>
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                {form.theme === 'system' && 'Automatically switch between light and dark mode based on system settings'}
                {form.theme === 'light' && 'Use light mode throughout the application'}
                {form.theme === 'dark' && 'Use dark mode throughout the application'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Success/Error Message */}
        {message && (
          <div className={`p-4 rounded-lg ${message.includes('success') ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {message}
          </div>
        )}

        {/* Submit Button */}
        <Button type="submit" disabled={saving} className="w-full" size="lg">
          {saving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </form>
    </div>
  )
}

// Helper functions
function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    EUR: '€',
    USD: '$',
    GBP: '£',
    CHF: 'CHF'
  }
  return symbols[currency] || currency
}

function formatDateExample(format: string): string {
  const date = new Date(2024, 0, 15) // January 15, 2024
  switch (format) {
    case 'DD/MM/YYYY':
      return '15/01/2024'
    case 'MM/DD/YYYY':
      return '01/15/2024'
    case 'YYYY-MM-DD':
      return '2024-01-15'
    default:
      return ''
  }
}
