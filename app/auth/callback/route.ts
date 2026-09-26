import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/auth/login', url.origin))

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(new URL('/auth/login?error=confirmation', url.origin))

  const { data: { user } } = await supabase.auth.getUser()
  const destination = user?.app_metadata?.role === 'admin' ? '/admin' : '/student/register'
  return NextResponse.redirect(new URL(destination, url.origin))
}
