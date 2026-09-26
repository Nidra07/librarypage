import LibraryHome, { type Achiever } from '@/components/library-home'
import { createClient } from '@/lib/supabase/server'

export default async function Page() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('government_job_achievers')
    .select('id, student_name, photo_url, job_title, organization, department, exam_name, selection_year, preparation_duration, testimonial, success_story')
    .eq('published', true)
    .eq('student_consent', true)
    .order('display_order', { ascending: true })
    .order('selection_year', { ascending: false })

  const { data: publicInfo } = await supabase.rpc('get_public_library_info')
  const libraryInfo = Array.isArray(publicInfo) ? publicInfo[0] : null

  return <LibraryHome
    achievers={(data ?? []) as Achiever[]}
    seatCount={Number(libraryInfo?.seat_count ?? 43)}
    monthlyFee={libraryInfo?.monthly_fee ? Number(libraryInfo.monthly_fee) : null}
  />
}
