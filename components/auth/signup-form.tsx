'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'

export function SignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      // Get redirect URL for email confirmation
      const getRedirectUrl = () => {
        if (typeof window !== 'undefined') {
          return `${window.location.origin}/auth/callback`
        }
        return process.env.NEXT_PUBLIC_SITE_URL 
          ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
          : 'https://milton-neon.vercel.app/auth/callback'
      }

      // Step 1: Sign up the user
      // Store company name in metadata so we can create it after email confirmation
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getRedirectUrl(),
          data: {
            company_name: companyName,
          },
        },
      })

      // Check if signup actually failed
      if (authError) {
        throw authError
      }

      // Check if user was created (even if email confirmation is pending)
      if (!authData.user) {
        throw new Error('No user data returned')
      }

      // Signup was successful! Now try to create profile and company
      // These might fail due to RLS policies if email confirmation is required,
      // but that's okay - we'll handle it after confirmation
      let profileCreated = false
      let companyCreated = false

      // Step 2 & 3: Try to create profile and company
      // These will likely fail due to RLS policies requiring email confirmation
      // We'll create them after email confirmation in the callback route
      // Store company name in user metadata for later use
      
      // Try to create profile (may fail silently due to RLS)
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          company_name: companyName,
        })
        .select()
        .single()

      if (!profileError) {
        profileCreated = true
      }

      // Try to create company (may fail silently due to RLS)
      const { error: companyError } = await supabase
        .from('companies')
        .insert({
          name: companyName,
          created_by: authData.user.id,
        })
        .select()
        .single()

      if (!companyError) {
        companyCreated = true
      }

      // Note: If these fail, they'll be created after email confirmation
      // The company name is stored in user metadata for that purpose

      // Success! User was created, show success message
      setSuccess(true)
      setLoading(false)

      // Set a flag in localStorage to indicate email confirmation is pending
      // This will be checked on the login page
      if (typeof window !== 'undefined') {
        localStorage.setItem('email_confirmation_pending', 'true')
      }

      // If email confirmation is not required and we have a session, redirect
      if (authData.session) {
        router.push('/dashboard')
        router.refresh()
      }

    } catch (err: any) {
      console.error('Signup error:', err)
      setError(err.message || 'An error occurred during signup')
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>Start your financial analytics journey</CardDescription>
      </CardHeader>
      <form onSubmit={handleSignup}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert variant="success">
              <AlertDescription>
                Account created successfully! Please check your email to confirm your account before signing in.
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="company">Company Name</Label>
            <Input
              id="company"
              type="text"
              placeholder="Acme Inc."
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </div>
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
              minLength={6}
            />
            <p className="text-xs text-muted-foreground mb-4">
              Minimum 6 characters
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-primary hover:underline">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}