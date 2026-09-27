import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import RegistrationForm from './RegistrationForm'
import { STUDENT_APP_APK_URL } from '@/lib/student-app'

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
      <p className="auth-intro">Enter the details from your offline admission and choose your preferred slot and entry time. Choose your seat when you submit a monthly payment; it will be allocated after the payment is confirmed.</p>
      <p className="auth-note">
        Prefer Android?{' '}
        <a href={STUDENT_APP_APK_URL} className="primary-button" download>
          Download the student app
        </a>
      </p>
      <RegistrationForm
        userId={user.id}
        fullName={String(user.user_metadata?.full_name ?? '')}
        email={user.email ?? ''}
        phone={String(user.user_metadata?.phone ?? '')}
      />
    </section>
  </main>
}

