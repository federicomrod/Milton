import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const cookieStore = await cookies()
  const supabase = await createClient(cookieStore)

  // Check if user is authenticated (middleware should have processed the session)
  const { data: { user } } = await supabase.auth.getUser()
  
  if (user) {
    // User just confirmed email - create profile and company if they don't exist
    const companyName = user.user_metadata?.company_name

    if (companyName) {
      // Check if profile exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single()

      if (!existingProfile) {
        // Create profile
        await supabase
          .from('profiles')
          .insert({
            id: user.id,
            company_name: companyName,
          })
      }

      // Check if company exists
      const { data: existingCompany } = await supabase
        .from('companies')
        .select('id')
        .eq('created_by', user.id)
        .eq('name', companyName)
        .single()

      if (!existingCompany) {
        // Create company
        await supabase
          .from('companies')
          .insert({
            name: companyName,
            created_by: user.id,
          })
      }
    }

    // Redirect to login with success message
    return NextResponse.redirect(new URL('/auth/login?confirmed=true', requestUrl.origin))
  }

  // Default: redirect to login
  return NextResponse.redirect(new URL('/auth/login', requestUrl.origin))
}

