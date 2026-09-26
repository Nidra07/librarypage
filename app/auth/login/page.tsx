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
    event.preventDefault()

    setLoading(true)
    setError('')

    const supabase = createClient()

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      if (error.code === 'email_not_confirmed') {
        setError('Please confirm your email address first.')
      } else if (error.code === 'invalid_credentials') {
        setError('Invalid email or password.')
      } else {
        setError(error.message || 'Something went wrong. Please try again.')
      }

      setLoading(false)
      return
    }

    const role = data.user?.app_metadata?.role

    if (role === 'admin') {
      router.replace('/admin')
    } else {
      router.replace('/protected')
    }

    router.refresh()
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

          <label htmlFor="email">
            Email address
          </label>

          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />

          <label htmlFor="password">
            Password
          </label>

          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Your password"
          />

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

        </form>

        <p className="auth-footer">
          New to Peaceful Pages?{' '}
          <Link href="/auth/sign-up">
            Create a student account
          </Link>
        </p>

        <p className="admin-note">
          Library administrators use the same sign-in.
          Admin access is assigned securely by the library team.
        </p>

      </div>
    </main>
  )
}
