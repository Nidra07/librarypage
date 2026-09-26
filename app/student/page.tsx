import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StudentPortal from './StudentPortal'

export default async function StudentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return <main className="member-page student-page"><div className="student-wrap">
    <header className="student-header"><div><span className="eyebrow">Student portal</span><h1>Your study visits</h1><p>Signed in as {user.email}</p></div><Link href="/" className="text-button">Back to library →</Link></header>
    <StudentPortal userId={user.id} />
  </div></main>
}
