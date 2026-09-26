import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  if (user.app_metadata?.role !== 'admin') redirect('/student')
  return <main className="member-page"><div className="member-panel"><span className="eyebrow">Admin portal</span><h1>Good morning, librarian.</h1><p>Signed in as {user.email}. Manage seats, members, and daily operations from here.</p><Link href="/" className="primary-button">Back to library</Link></div></main>
}
