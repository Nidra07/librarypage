'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function SignUpPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone },
        emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? window.location.origin + '/auth/callback',
      },
    })
    if (error) {
      setMessage('Unable to create account. Please check your details and try again.')
      setSaving(false)
      return
    }
    if (data.session) {
      router.replace('/student/register')
      router.refresh()
      return
    }
    setMessage('Your account is created. Confirm your email, then you will continue to student registration.')
    setSaving(false)
  }

  return <main className="auth-page"><Link href="/auth/login" className="auth-back"><ArrowLeft /> Back to sign in</Link><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><BookOpen /></span><span><strong>The Peaceful Pages</strong><small>LIBRARY</small></span></div><div className="eyebrow">Join the community</div><h1>Make space for focus.</h1><p className="auth-intro">Create your student account. After email confirmation, complete your one-time library registration.</p><form onSubmit={submit} className="auth-form"><label>Full name<input value={fullName} onChange={event => setFullName(event.target.value)} autoComplete="name" required /></label><label>Phone number<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" /></label><label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label><button className="primary-button auth-submit" type="submit" disabled={saving}>{saving ? 'Creating account…' : <>Create account <ArrowLeft className="rotate-180" /></>}</button></form>{message && <p className="auth-note" role="status">{message}</p>}<p className="auth-foot">Already a member? <Link href="/auth/login">Sign in</Link></p></section></main>
}
