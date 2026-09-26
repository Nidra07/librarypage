'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('')
    const { data, error } = await createClient().auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.code === 'email_not_confirmed' ? 'Please confirm your email address first.' : error.code === 'invalid_credentials' ? 'Invalid email or password.' : 'Something went wrong. Please try again.')
      setLoading(false); return
    }
    router.push(data.user?.app_metadata?.role === 'admin' ? '/admin' : '/protected')
    router.refresh()
  }

  return <main className="auth-page"><div className="auth-card"><Link href="/" className="auth-brand">The Peaceful Pages <span>LIBRARY</span></Link><p className="eyebrow">Welcome back</p><h1>Find your focus.</h1><p className="auth-copy">Log in to manage your seat bookings and library membership.</p><form onSubmit={submit}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button></form><p className="auth-footer">New to Peaceful Pages? <Link href="/auth/sign-up">Create a student account</Link></p><p className="admin-note">Library administrators use the same sign-in. Your admin access is assigned securely by the library team.</p></div></main>
}
