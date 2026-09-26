import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import RegistrationForm from './RegistrationForm'

export default async function StudentRegistrationPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  if (user.app_metadata?.role === 'admin') redirect('/admin')

  const { data: registration } = await supabase
    .from('student_registrations')
    .select('student_id')
    .eq('student_id', user.id)
    .maybeSingle()

  if (registration) redirect('/student')

  return <main className="auth-page">
    <section className="auth-card registration-card">
      <div className="auth-brand"><span className="brand-mark"><BookOpen /></span><span><strong>The Peaceful Pages</strong><small>LIBRARY</small></span></div>
      <div className="eyebrow">Student registration</div>
      <h1>Complete your registration.</h1>
      <p className="auth-intro">Enter the details from your offline admission and choose your preferred slot, entry time, and seat. This one-time registration is followed by the ₹100 registration payment.</p>
      <RegistrationForm
        userId={user.id}
        fullName={String(user.user_metadata?.full_name ?? '')}
        email={user.email ?? ''}
        phone={String(user.user_metadata?.phone ?? '')}
      />
    </section>
  </main>
}
