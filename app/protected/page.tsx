import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import StudentPortal from '../student/StudentPortal'

export default async function ProtectedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  if (user.app_metadata?.role === 'admin') redirect('/admin')
  const { data: registration } = await supabase.from('student_registrations').select('student_id').eq('student_id', user.id).maybeSingle()
  if (!registration) redirect('/student/register')
  return <StudentPortal userId={user.id} section="dashboard" />
}
