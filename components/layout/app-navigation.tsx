'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LogoutButton } from '@/components/dashboard/logout-button'
import { LayoutDashboard, BarChart, FileText, User, Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function AppNavigation() {
  const pathname = usePathname()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      setIsAuthenticated(!!user)
      setLoading(false)
    }
    checkAuth()
  }, [pathname])

  // Don't show navigation on auth pages or while loading
  if (loading || pathname?.startsWith('/auth/') || !isAuthenticated) {
    return null
  }

  const isActive = (path: string) => {
    if (path === '/dashboard' && pathname === '/dashboard') return true
    if (path !== '/dashboard' && pathname?.startsWith(path)) return true
    return false
  }

  return (
    <header className="bg-white shadow-sm border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-6">
            <Link href="/dashboard">
              <h1 className="text-xl font-semibold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors">
                CFO Platform
              </h1>
            </Link>
            
            {/* Main Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              <Link href="/dashboard">
                <Button 
                  variant={isActive('/dashboard') && pathname === '/dashboard' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-2"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Button>
              </Link>
              <Link href="/dashboard/analytics">
                <Button 
                  variant={isActive('/dashboard/analytics') ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-2"
                >
                  <BarChart className="h-4 w-4" />
                  Analytics
                </Button>
              </Link>
              <Link href="/dashboard/reporting">
                <Button 
                  variant={isActive('/dashboard/reporting') ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Reporting
                </Button>
              </Link>
            </nav>
          </div>
          
          <div className="flex items-center gap-2">
            <Link href="/dashboard/account">
              <Button 
                variant={isActive('/dashboard/account') ? 'default' : 'ghost'}
                size="sm"
                className="gap-2"
              >
                <User className="h-4 w-4" />
                Account
              </Button>
            </Link>
            <Link href="/dashboard/settings">
              <Button 
                variant={isActive('/dashboard/settings') ? 'default' : 'ghost'}
                size="sm"
                className="gap-2"
              >
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </Link>
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  )
}

