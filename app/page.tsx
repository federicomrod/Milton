import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, BarChart3, Brain, FileText, Zap, Shield, TrendingUp } from 'lucide-react'

async function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Navigation */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <span className="text-2xl font-bold text-gray-900">Milton</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/auth/login">
                <Button variant="ghost">Log in</Button>
              </Link>
              <Link href="/auth/signup">
                <Button>Get started</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Your AI Finance Co-Pilot
            <span className="block text-blue-600 mt-2">for Startups</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
            Milton transforms your financial data into actionable insights. Upload your transactions, 
            CRM data, and budgets—get instant dashboards and AI-powered analysis that helps you 
            make better decisions, faster.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth/signup">
              <Button size="lg" className="text-lg px-8 py-6">
                Get started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/auth/login">
              <Button size="lg" variant="outline" className="text-lg px-8 py-6">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Everything you need to master your finances
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Built for founders who need clarity, not complexity
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          <div className="p-6 rounded-lg border border-gray-200 bg-white hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
              <Brain className="h-6 w-6 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">AI-Powered Insights</h3>
            <p className="text-gray-600">
              Milton analyzes your financial data and provides intelligent insights, 
              helping you understand trends and opportunities.
            </p>
          </div>

          <div className="p-6 rounded-lg border border-gray-200 bg-white hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <BarChart3 className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Instant Dashboards</h3>
            <p className="text-gray-600">
              Upload your data and get real-time visualizations. Cash flow, revenue, 
              expenses—all in one place, automatically organized.
            </p>
          </div>

          <div className="p-6 rounded-lg border border-gray-200 bg-white hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <Zap className="h-6 w-6 text-purple-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Lightning Fast</h3>
            <p className="text-gray-600">
              No complex setup. Upload your files and start getting insights in minutes, 
              not days.
            </p>
          </div>

          <div className="p-6 rounded-lg border border-gray-200 bg-white hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
              <FileText className="h-6 w-6 text-orange-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Smart Data Import</h3>
            <p className="text-gray-600">
              Works with bank statements, CRM exports, spreadsheets. Milton automatically 
              recognizes and categorizes your data.
            </p>
          </div>

          <div className="p-6 rounded-lg border border-gray-200 bg-white hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
              <TrendingUp className="h-6 w-6 text-red-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">KPI Tracking</h3>
            <p className="text-gray-600">
              Monitor your key metrics in real-time. Revenue, burn rate, runway—all 
              calculated and visualized automatically.
            </p>
          </div>

          <div className="p-6 rounded-lg border border-gray-200 bg-white hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
              <Shield className="h-6 w-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Investor Ready</h3>
            <p className="text-gray-600">
              Generate professional reports and presentations. Keep your investors 
              informed with data-driven insights.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-12 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Ready to take control of your finances?
          </h2>
          <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
            Join startups that trust Milton to make smarter financial decisions
          </p>
          <Link href="/auth/signup">
            <Button size="lg" className="text-lg px-8 py-6 bg-blue-600 hover:bg-blue-700">
              Get started
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-4 md:mb-0">
              <span className="text-xl font-bold text-gray-900">Milton</span>
              <p className="text-sm text-gray-600 mt-2">Your AI Finance Co-Pilot</p>
            </div>
            <div className="flex gap-6">
              <Link href="/auth/login" className="text-sm text-gray-600 hover:text-gray-900">
                Log in
              </Link>
              <Link href="/auth/signup" className="text-sm text-gray-600 hover:text-gray-900">
                Sign up
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default async function HomePage() {
  const supabase = await createClient()
  const headersList = await headers()
  const referer = headersList.get('referer') || ''
  
  // Check if user just came from Supabase email verification
  const isFromSupabaseVerify = referer.includes('supabase.co') && referer.includes('/auth/v1/verify')
  
  const { data: { user } } = await supabase.auth.getUser()
  
  // If user just confirmed email (coming from Supabase verify), show success message
  if (isFromSupabaseVerify) {
    if (user) {
      // User is authenticated, redirect to login to show success then they can proceed
      redirect('/auth/login?confirmed=true')
    } else {
      // Not authenticated yet, but came from verify - might be processing
      redirect('/auth/login?confirmed=true')
    }
  }
  
  // Show landing page for unauthenticated users
  if (!user) {
    return <LandingPage />
  }

  // Redirect authenticated users to dashboard
  redirect('/dashboard')
}
