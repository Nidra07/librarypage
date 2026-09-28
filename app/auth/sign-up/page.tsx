'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getAuthErrorMessage, getAuthRetryAfterSeconds } from '@/lib/supabase/auth-errors'
import { getAuthRedirectUrl } from '@/lib/supabase/auth-redirect'

export default function SignUpPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState<'error' | 'success'>('success')
  const [saving, setSaving] = useState(false)
  const [resending, setResending] = useState(false)
  const [canResend, setCanResend] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  function showError(text: string) {
    setMessage(text)
    setMessageKind('error')
  }

  async function resendConfirmation() {
    if (resending || cooldown > 0) return
    if (!email.trim()) {
      showError('Enter your email address first, then request a confirmation email.')
      return
    }

    setResending(true)
    setMessage('')
    const supabase = createClient()
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: getAuthRedirectUrl() },
      })

      if (error) {
        showError(getAuthErrorMessage(error, 'Unable to resend the confirmation email. Please try again later.'))
        if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
          setCooldown(getAuthRetryAfterSeconds(error))
        }
      } else {
        setMessage('If this email has a pending account, a fresh confirmation link has been sent. Check your inbox and spam folder, and use the newest link once.')
        setMessageKind('success')
        setCooldown(60)
      }
    } catch (error) {
      showError(getAuthErrorMessage({ message: error instanceof Error ? error.message : '' }, 'Unable to resend the confirmation email. Check your connection and try again.'))
    } finally {
      setResending(false)
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || cooldown > 0) return

    setSaving(true)
    setMessage('')
    const supabase = createClient()
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim(), phone: phone.trim() },
          emailRedirectTo: getAuthRedirectUrl(),
        },
      })

      if (error) {
        showError(getAuthErrorMessage(error, 'Unable to create the account. Please review the details and try again.'))
        if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
          setCanResend(true)
          setCooldown(getAuthRetryAfterSeconds(error))
        } else if (error.code === 'user_already_exists' || error.code === 'email_exists') {
          setCanResend(true)
          setMessage('An account may already exist for this email. Sign in, or request a fresh confirmation link below.')
        }
        return
      }

      if (data.session) {
        router.replace('/student/register')
        router.refresh()
        return
      }

      setMessage('Your account was created. Confirm your email to continue to student registration. Check your inbox and spam folder, and use the newest confirmation link once.')
      setMessageKind('success')
      setCanResend(true)
      setCooldown(60)
    } catch (error) {
      showError(getAuthErrorMessage({ message: error instanceof Error ? error.message : '' }, 'Unable to create the account. Check your connection and try again.'))
    } finally {
      setSaving(false)
    }
  }

  return <main className="auth-page"><Link href="/auth/login" className="auth-back"><ArrowLeft /> Back to sign in</Link><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><BookOpen /></span><span><strong>The Peaceful Pages</strong><small>LIBRARY</small></span></div><div className="eyebrow">Join the community</div><h1>Make space for focus.</h1><p className="auth-intro">Create your student account. After email confirmation, complete your one-time library registration.</p><form onSubmit={submit} className="auth-form"><label>Full name<input value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="name" required /></label><label>Phone number<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" /></label><label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label><button className="primary-button auth-submit" type="submit" disabled={saving || cooldown > 0}>{saving ? 'Creating account…' : cooldown > 0 ? `Please wait ${cooldown}s…` : <>Create account <ArrowLeft className="rotate-180" /> </>}</button></form>{message && <p className={messageKind === 'error' ? 'auth-error' : 'auth-success'} role={messageKind === 'error' ? 'alert' : 'status'}>{message}</p>}{canResend && <button className="auth-resend" type="button" onClick={resendConfirmation} disabled={resending || cooldown > 0}>{resending ? 'Sending…' : cooldown > 0 ? `Resend confirmation in ${cooldown}s` : 'Resend confirmation email'}</button>}<p className="auth-foot">Already a member? <Link href="/auth/login">Sign in</Link></p></section></main>
}
