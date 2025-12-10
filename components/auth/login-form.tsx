'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Check for email confirmation success
  useEffect(() => {
    const confirmed = searchParams.get('confirmed')
    const type = searchParams.get('type')
    const code = searchParams.get('code')
    const token = searchParams.get('token')
    
    // Check URL hash for Supabase redirects (sometimes Supabase uses hash fragments)
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    const hasHashParams = hash.includes('type=') || hash.includes('access_token=')
    
    // Check localStorage for pending confirmation flag
    const pendingConfirmation = typeof window !== 'undefined' 
      ? localStorage.getItem('email_confirmation_pending') === 'true'
      : false
    
    // Check if user just confirmed their email
    if (confirmed === 'true' || type === 'signup' || code || token || hasHashParams || pendingConfirmation) {
      setSuccess(true)
      // Clear the pending flag
      if (typeof window !== 'undefined') {
        localStorage.removeItem('email_confirmation_pending')
      }
      // Clean up URL by removing query params and hash after a brief delay
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', '/auth/login')
        }
      }, 100)
    }
  }, [searchParams, router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Log in to your Startup CFO account</CardDescription>
      </CardHeader>
      <form onSubmit={handleLogin}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert variant="success">
              <AlertDescription>
                🎉 Email confirmed successfully! You can now log in to your account.
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Don't have an account?{' '}
            <Link href="/auth/signup" className="text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}