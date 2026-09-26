import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function StudentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  return <main className="member-page"><div className="member-panel"><span className="eyebrow">Student portal</span><h1>Your peaceful study space.</h1><p>Signed in as {user.email}. Seat booking and membership details will live here.</p><Link href="/" className="primary-button">Back to library</Link></div></main>
}
