import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import StudentPortal from './StudentPortal'

export default async function StudentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  if (user.app_metadata?.role === 'admin') redirect('/admin')

  const { data: registration } = await supabase
    .from('student_registrations')
    .select('student_id')
    .eq('student_id', user.id)
    .maybeSingle()
  if (!registration) redirect('/student/register')

  return <main className="member-page student-page"><div className="student-wrap">
    <header className="student-header"><div><span className="eyebrow">Student portal</span><h1>Your study visits</h1><p>Signed in as {user.email}</p></div><Link href="/" className="text-button">Back to library →</Link></header>
    <StudentPortal userId={user.id} />
  </div></main>
}
