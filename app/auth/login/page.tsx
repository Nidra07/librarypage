'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getAuthErrorMessage, getAuthRetryAfterSeconds } from '@/lib/supabase/auth-errors'
import { getAuthRedirectUrl } from '@/lib/supabase/auth-redirect'

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [canResend, setCanResend] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    if (query.get('error') === 'confirmation') {
      setError('That confirmation link may have expired or already been used. Enter your email below and request a fresh link.')
      setCanResend(true)
    }
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')

    try {
      const { data, error } = await createClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        setError(error.code === 'invalid_credentials' ? 'Invalid email or password.' : getAuthErrorMessage(error, 'Something went wrong. Please try again.'))
        if (error.code === 'email_not_confirmed') setCanResend(true)
        setLoading(false)
        return
      }

      const role = data.user?.app_metadata?.role
      router.replace(role === 'admin' ? '/admin' : '/student/register')
      router.refresh()
    } catch (error) {
      setError(getAuthErrorMessage({ message: error instanceof Error ? error.message : '' }, 'Unable to sign in. Check your connection and try again.'))
      setLoading(false)
    }
  }

  async function resendConfirmation() {
    if (resending || cooldown > 0) return
    if (!email.trim()) {
      setError('Enter your email address first, then request a confirmation email.')
      return
    }

    setResending(true)
    setError('')
    setNotice('')

    try {
      const { error } = await createClient().auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: getAuthRedirectUrl() },
      })

      if (error) {
        setError(getAuthErrorMessage(error, 'Unable to resend the confirmation email. Please try again later.'))
        if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
          setCooldown(getAuthRetryAfterSeconds(error))
        }
      } else {
        setNotice('If this email has a pending account, a fresh confirmation link has been sent. Check your inbox and spam folder, and use the newest link once.')
        setCooldown(60)
      }
    } catch (error) {
      setError(getAuthErrorMessage({ message: error instanceof Error ? error.message : '' }, 'Unable to resend the confirmation email. Check your connection and try again.'))
    } finally {
      setResending(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link href="/" className="auth-brand">
          The Peaceful Pages <span>LIBRARY</span>
        </Link>

        <p className="eyebrow">Welcome back</p>
        <h1>Find your focus.</h1>
        <p className="auth-copy">
          Log in to manage your seat bookings and library membership.
        </p>

        <form onSubmit={submit}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Your password"
          />

          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-success" role="status">{notice}</p>}

          <button className="primary-button auth-submit" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {canResend && <button className="auth-resend" type="button" onClick={resendConfirmation} disabled={resending || cooldown > 0}>
          {resending ? 'Sending…' : cooldown > 0 ? `Resend confirmation in ${cooldown}s` : 'Resend confirmation email'}
        </button>}

        <p className="auth-footer">
          New to Peaceful Pages?{' '}
          <Link href="/auth/sign-up">Create a student account</Link>
        </p>

        <p className="admin-note">
          Library administrators use the same sign-in.
          Admin access is assigned securely by the library team.
        </p>
      </div>
    </main>
  )
}
