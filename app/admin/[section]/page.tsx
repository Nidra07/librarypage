import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminOperations from '../AdminOperations'

const sections = ['students', 'bookings', 'attendance', 'payments', 'seats', 'slots', 'settings', 'audit'] as const

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  if (!sections.includes(section as typeof sections[number])) notFound()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  if (user.app_metadata?.role !== 'admin') redirect('/protected')
  return <AdminOperations section={section as typeof sections[number]} />
}
