import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StudentPortal from '../../student/StudentPortal'

const sections = ['book', 'bookings', 'attendance', 'payments', 'profile'] as const

export default async function ProtectedSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  if (!sections.includes(section as typeof sections[number])) notFound()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  if (user.app_metadata?.role === 'admin') redirect('/admin')
  const { data: registration } = await supabase.from('student_registrations').select('student_id').eq('student_id', user.id).maybeSingle()
  if (!registration) redirect('/student/register')
  return <StudentPortal userId={user.id} section={section as typeof sections[number]} />
}
