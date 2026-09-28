import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function signInRedirect(request: Request) {
  return NextResponse.redirect(new URL('/auth/login?error=confirmation', request.url), 303)
}

export async function POST(request: Request) {
  const form = await request.formData()
  const tokenHash = form.get('token_hash')
  const type = form.get('type')

  if (typeof tokenHash !== 'string' || tokenHash.length === 0 || type !== 'email') {
    return signInRedirect(request)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
  if (error) return signInRedirect(request)

  const { data: { user } } = await supabase.auth.getUser()
  const destination = user?.app_metadata?.role === 'admin' ? '/admin' : '/student/register'
  return NextResponse.redirect(new URL(destination, request.url), 303)
}

