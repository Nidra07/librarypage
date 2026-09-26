import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ProtectedPage() {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  return <main className="auth-page"><div className="auth-card"><p className="eyebrow">Student space</p><h1>Welcome back.</h1><p className="auth-copy">You are signed in as {user.email}. Your seat bookings and membership details will live here.</p><form action={async () => { 'use server'; const client = await createClient(); await client.auth.signOut(); redirect('/') }}><button className="primary-button auth-submit">Sign out</button></form></div></main>
}
