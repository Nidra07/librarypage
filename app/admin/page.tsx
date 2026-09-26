import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminOperations from './AdminOperations'

export default async function AdminPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  if (user.app_metadata?.role !== 'admin') {
    redirect('/student')
  }

  return <AdminOperations section="dashboard" />
}
