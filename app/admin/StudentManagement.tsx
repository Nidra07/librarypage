'use client'

import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Student = { id: string; full_name: string; email: string; phone: string | null; status: 'active' | 'inactive'; created_at: string }
type Slot = { id: string; label: string; starts_at: string; ends_at: string; active: boolean }
type Booking = { id: string; student_id: string; slot_id: string; booking_date: string; status: 'booked' | 'cancelled' | 'completed' }
type Attendance = { id: string; student_id: string; booking_id: string; attended_on: string; status: 'present' | 'absent' }
type Tab = 'students' | 'bookings' | 'slots' | 'attendance'

const tabs: { id: Tab; label: string }[] = [
  { id: 'students', label: 'Students' }, { id: 'bookings', label: 'Bookings' },
  { id: 'slots', label: 'Booking slots' }, { id: 'attendance', label: 'Attendance' },
]

export default function StudentManagement() {
  const supabase = createClient()
  const [tab, setTab] = useState<Tab>('students')
  const [students, setStudents] = useState<Student[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [slotForm, setSlotForm] = useState({ label: '', starts_at: '', ends_at: '' })

  async function load() {
    setLoading(true)
    const [studentResult, slotResult, bookingResult, attendanceResult] = await Promise.all([
      supabase.from('student_profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('study_slots').select('*').order('starts_at'),
      supabase.from('bookings').select('*').order('booking_date', { ascending: false }),
      supabase.from('attendance').select('*').order('attended_on', { ascending: false }),
    ])
    const error = studentResult.error ?? slotResult.error ?? bookingResult.error ?? attendanceResult.error
    setMessage(error?.message ?? '')
    setStudents((studentResult.data ?? []) as Student[])
    setSlots((slotResult.data ?? []) as Slot[])
    setBookings((bookingResult.data ?? []) as Booking[])
    setAttendance((attendanceResult.data ?? []) as Attendance[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function changeStudentStatus(student: Student) {
    const nextStatus = student.status === 'active' ? 'inactive' : 'active'
    const { error } = await supabase.from('student_profiles').update({ status: nextStatus }).eq('id', student.id)
    setMessage(error?.message ?? `${student.full_name || student.email} is now ${nextStatus}.`)
    if (!error) await load()
  }

  async function changeBooking(booking: Booking, values: Partial<Booking>) {
    const { error } = await supabase.from('bookings').update(values).eq('id', booking.id)
    setMessage(error?.message ?? 'Booking updated.')
    if (!error) await load()
  }

  async function saveSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { error } = await supabase.from('study_slots').insert(slotForm)
    setMessage(error?.message ?? 'Booking slot added.')
    if (!error) { setSlotForm({ label: '', starts_at: '', ends_at: '' }); await load() }
  }

  async function toggleSlot(slot: Slot) {
    const { error } = await supabase.from('study_slots').update({ active: !slot.active }).eq('id', slot.id)
    setMessage(error?.message ?? `Slot ${slot.active ? 'deactivated' : 'activated'}.`)
    if (!error) await load()
  }

  async function markAttendance(booking: Booking, status: 'present' | 'absent') {
    const { error } = await supabase.from('attendance').upsert({
      student_id: booking.student_id, booking_id: booking.id,
      attended_on: booking.booking_date, status, marked_by: (await supabase.auth.getUser()).data.user?.id,
    }, { onConflict: 'booking_id' })
    setMessage(error?.message ?? `Attendance marked ${status}.`)
    if (!error) await load()
  }

  const studentById = new Map(students.map((student) => [student.id, student]))
  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  const attendanceByBooking = new Map(attendance.map((record) => [record.booking_id, record]))

  return (
    <section className="manage-panel" aria-label="Student and booking management">
      <div className="manage-heading">
        <div><span className="eyebrow">Library operations</span><h2>Student management</h2><p>Review memberships, bookings, time slots, and attendance.</p></div>
      </div>
      <div className="manage-tabs" role="tablist" aria-label="Management sections">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>
      {message && <p className="manage-message" role="status">{message}</p>}
      {loading ? <p className="admin-empty">Loading library records…</p> : (
        <div className="manage-content">
          {tab === 'students' && <div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Contact</th><th>Joined</th><th>Status</th><th>Action</th></tr></thead><tbody>
            {students.map((student) => <tr key={student.id}><td><strong>{student.full_name || 'Name not provided'}</strong></td><td>{student.email}<small>{student.phone || 'No phone number'}</small></td><td>{new Date(student.created_at).toLocaleDateString()}</td><td><span className={`status-pill ${student.status}`}>{student.status}</span></td><td><button className="manage-action" type="button" onClick={() => void changeStudentStatus(student)}>{student.status === 'active' ? 'Set inactive' : 'Set active'}</button></td></tr>)}
          </tbody></table>{students.length === 0 && <p className="admin-empty">No student profiles found.</p>}</div>}

          {tab === 'bookings' && <div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Date</th><th>Slot</th><th>Booking status</th></tr></thead><tbody>
            {bookings.map((booking) => <tr key={booking.id}><td>{studentById.get(booking.student_id)?.full_name || studentById.get(booking.student_id)?.email || 'Student'}</td><td><input aria-label="Booking date" type="date" value={booking.booking_date} onChange={(event) => void changeBooking(booking, { booking_date: event.target.value })} /></td><td><select aria-label="Booking slot" value={booking.slot_id} onChange={(event) => void changeBooking(booking, { slot_id: event.target.value })}>{slots.map((slot) => <option key={slot.id} value={slot.id} disabled={!slot.active && slot.id !== booking.slot_id}>{slot.label} ({slot.starts_at.slice(0, 5)}–{slot.ends_at.slice(0, 5)}){slot.active ? '' : ' · inactive'}</option>)}</select><small>Current: {slotById.get(booking.slot_id)?.label || 'Unknown slot'}</small></td><td><select aria-label="Booking status" value={booking.status} onChange={(event) => void changeBooking(booking, { status: event.target.value as Booking['status'] })}><option value="booked">Booked</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></td></tr>)}
          </tbody></table>{bookings.length === 0 && <p className="admin-empty">No bookings yet.</p>}</div>}

          {tab === 'slots' && <div className="manage-slots"><form className="slot-form" onSubmit={saveSlot}><h3>Add a booking slot</h3><label>Slot name<input value={slotForm.label} onChange={(event) => setSlotForm({ ...slotForm, label: event.target.value })} placeholder="Morning" required /></label><div className="manage-two"><label>Starts<input type="time" value={slotForm.starts_at} onChange={(event) => setSlotForm({ ...slotForm, starts_at: event.target.value })} required /></label><label>Ends<input type="time" value={slotForm.ends_at} onChange={(event) => setSlotForm({ ...slotForm, ends_at: event.target.value })} required /></label></div><button className="primary-button" type="submit">Add slot</button></form><div className="slot-list"><h3>Available booking slots</h3>{slots.map((slot) => <article className="slot-row" key={slot.id}><div><strong>{slot.label}</strong><span>{slot.starts_at.slice(0, 5)}–{slot.ends_at.slice(0, 5)}</span></div><span className={`status-pill ${slot.active ? 'active' : 'inactive'}`}>{slot.active ? 'active' : 'inactive'}</span><button className="manage-action" type="button" onClick={() => void toggleSlot(slot)}>{slot.active ? 'Deactivate' : 'Activate'}</button></article>)}{slots.length === 0 && <p className="admin-empty">Add the first booking slot.</p>}</div></div>}

          {tab === 'attendance' && <div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Booking date</th><th>Slot</th><th>Attendance</th><th>Update</th></tr></thead><tbody>
            {bookings.map((booking) => { const record = attendanceByBooking.get(booking.id); const student = studentById.get(booking.student_id); const slot = slotById.get(booking.slot_id); return <tr key={booking.id}><td>{student?.full_name || student?.email || 'Student'}<small>{student?.email}</small></td><td>{booking.booking_date}</td><td>{slot?.label || 'Unknown slot'}</td><td><span className={`status-pill ${record?.status === 'present' ? 'active' : record?.status === 'absent' ? 'inactive' : 'pending'}`}>{record?.status || 'not marked'}</span></td><td><button className="manage-action" type="button" onClick={() => void markAttendance(booking, 'present')}>Present</button><button className="manage-action" type="button" onClick={() => void markAttendance(booking, 'absent')}>Absent</button></td></tr> })}
          </tbody></table>{bookings.length === 0 && <p className="admin-empty">Attendance will appear after bookings are created.</p>}</div>}
        </div>
      )}
    </section>
  )
}
