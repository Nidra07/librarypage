'use client'

import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Student = { id: string; full_name: string; email: string; phone: string | null; status: 'active' | 'inactive'; created_at: string }
type Registration = {
  student_id: string
  full_name: string
  admission_number: string
  phone: string
  email: string
  address: string
  slot_id: string
  entry_time: string
  exit_time: string
  exit_day_offset: number
  seat_number: string
}
type Slot = { id: string; label: string; duration_hours: number; active: boolean }
type Booking = { id: string; student_id: string; slot_id: string; booking_date: string; status: 'booked' | 'cancelled' | 'completed' }
type Attendance = { id: string; student_id: string; booking_id: string; attended_on: string; status: 'present' | 'absent' }
type Tab = 'students' | 'bookings' | 'slots' | 'attendance'

const durationOptions = [4, 6, 8, 12]
const tabs: { id: Tab; label: string }[] = [
  { id: 'students', label: 'Students' }, { id: 'bookings', label: 'Bookings' },
  { id: 'slots', label: 'Booking slots' }, { id: 'attendance', label: 'Attendance' },
]

function displayTime(value: string, dayOffset = 0) {
  return new Date('2000-01-01T' + value.slice(0, 5) + ':00').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (dayOffset ? ' (next day)' : '')
}

export default function StudentManagement() {
  const supabase = createClient()
  const [tab, setTab] = useState<Tab>('students')
  const [students, setStudents] = useState<Student[]>([])
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [durationHours, setDurationHours] = useState('')

  async function load() {
    setLoading(true)
    const [studentResult, registrationResult, slotResult, bookingResult, attendanceResult] = await Promise.all([
      supabase.from('student_profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('student_registrations').select('*').order('created_at', { ascending: false }),
      supabase.from('study_slots').select('*').order('duration_hours'),
      supabase.from('bookings').select('*').order('booking_date', { ascending: false }),
      supabase.from('attendance').select('*').order('attended_on', { ascending: false }),
    ])
    const error = studentResult.error ?? registrationResult.error ?? slotResult.error ?? bookingResult.error ?? attendanceResult.error
    setMessage(error?.message ?? '')
    setStudents((studentResult.data ?? []) as Student[])
    setRegistrations((registrationResult.data ?? []) as Registration[])
    setSlots((slotResult.data ?? []) as Slot[])
    setBookings((bookingResult.data ?? []) as Booking[])
    setAttendance((attendanceResult.data ?? []) as Attendance[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function changeStudentStatus(student: Student) {
    const nextStatus = student.status === 'active' ? 'inactive' : 'active'
    const { error } = await supabase.from('student_profiles').update({ status: nextStatus }).eq('id', student.id)
    setMessage(error?.message ?? (student.full_name || student.email) + ' is now ' + nextStatus + '.')
    if (!error) await load()
  }

  async function changeBooking(booking: Booking, values: Partial<Booking>) {
    const { error } = await supabase.from('bookings').update(values).eq('id', booking.id)
    setMessage(error?.message ?? 'Booking updated.')
    if (!error) await load()
  }

  async function saveSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const hours = Number(durationHours || availableDurations[0] || 0)
    if (!durationOptions.includes(hours) || slots.some((slot) => slot.duration_hours === hours)) {
      setMessage('That booking duration already exists or is not supported.')
      return
    }
    const { error } = await supabase.from('study_slots').insert({ label: hours + '-hour slot', duration_hours: hours })
    setMessage(error?.message ?? hours + '-hour booking slot added.')
    if (!error) { setDurationHours(''); await load() }
  }

  async function toggleSlot(slot: Slot) {
    const { error } = await supabase.from('study_slots').update({ active: !slot.active }).eq('id', slot.id)
    setMessage(error?.message ?? ('Slot ' + (slot.active ? 'deactivated' : 'activated') + '.'))
    if (!error) await load()
  }

  async function markAttendance(booking: Booking, status: 'present' | 'absent') {
    const { error } = await supabase.from('attendance').upsert({
      student_id: booking.student_id, booking_id: booking.id,
      attended_on: booking.booking_date, status, marked_by: (await supabase.auth.getUser()).data.user?.id,
    }, { onConflict: 'booking_id' })
    setMessage(error?.message ?? 'Attendance marked ' + status + '.')
    if (!error) await load()
  }

  const studentById = new Map(students.map((student) => [student.id, student]))
  const registrationByStudentId = new Map(registrations.map((registration) => [registration.student_id, registration]))
  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  const attendanceByBooking = new Map(attendance.map((record) => [record.booking_id, record]))
  const availableDurations = durationOptions.filter((hours) => !slots.some((slot) => slot.duration_hours === hours))

  return (
    <section className="manage-panel" aria-label="Student and booking management">
      <div className="manage-heading">
        <div><span className="eyebrow">Library operations</span><h2>Student management</h2><p>Review registrations, memberships, bookings, time slots, and attendance.</p></div>
      </div>
      <div className="manage-tabs" role="tablist" aria-label="Management sections">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>
      {message && <p className="manage-message" role="status">{message}</p>}
      {loading ? <p className="admin-empty">Loading library records…</p> : (
        <div className="manage-content">
          {tab === 'students' && <div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Admission and seat</th><th>Contact and address</th><th>Registered visit</th><th>Joined</th><th>Status</th><th>Action</th></tr></thead><tbody>
            {students.map((student) => { const registration = registrationByStudentId.get(student.id); const slot = registration ? slotById.get(registration.slot_id) : undefined; return <tr key={student.id}><td><strong>{registration?.full_name || student.full_name || 'Name not provided'}</strong></td><td>{registration ? <><strong>{registration.admission_number}</strong><small>Seat {registration.seat_number}</small></> : <span>Registration pending</span>}</td><td>{registration?.email || student.email}<small>{registration?.phone || student.phone || 'No phone number'}</small><small>{registration?.address || ''}</small></td><td>{registration ? <>{slot?.label || (slot?.duration_hours ? slot.duration_hours + '-hour slot' : 'Slot unavailable')}<small>Entry {displayTime(registration.entry_time)} · Exit {displayTime(registration.exit_time, registration.exit_day_offset)}</small></> : 'Not registered'}</td><td>{new Date(student.created_at).toLocaleDateString()}</td><td><span className={'status-pill ' + student.status}>{student.status}</span></td><td><button className="manage-action" type="button" onClick={() => void changeStudentStatus(student)}>{student.status === 'active' ? 'Set inactive' : 'Set active'}</button></td></tr> })}</tbody></table>{students.length === 0 && <p className="admin-empty">No student profiles found.</p>}</div>}

          {tab === 'bookings' && <div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Date</th><th>Slot</th><th>Booking status</th></tr></thead><tbody>
            {bookings.map((booking) => { const registration = registrationByStudentId.get(booking.student_id); const student = studentById.get(booking.student_id); const slot = slotById.get(booking.slot_id); return <tr key={booking.id}><td>{registration?.full_name || student?.full_name || student?.email || 'Student'}<small>{registration?.admission_number || registration?.email || student?.email}</small><small>{registration ? 'Seat ' + registration.seat_number : 'Registration pending'}</small></td><td><input aria-label="Booking date" type="date" value={booking.booking_date} onChange={(event) => void changeBooking(booking, { booking_date: event.target.value })} /></td><td><select aria-label="Booking slot" value={booking.slot_id} onChange={(event) => void changeBooking(booking, { slot_id: event.target.value })}>{slots.map((item) => <option key={item.id} value={item.id} disabled={!item.active && item.id !== booking.slot_id}>{item.label} ({item.duration_hours} hours){item.active ? '' : ' · inactive'}</option>)}</select>{registration && <small>Registered: {displayTime(registration.entry_time)}–{displayTime(registration.exit_time, registration.exit_day_offset)}</small>}<small>Current: {slot?.label || 'Unknown slot'}</small></td><td><select aria-label="Booking status" value={booking.status} onChange={(event) => void changeBooking(booking, { status: event.target.value as Booking['status'] })}><option value="booked">Booked</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></td></tr> })}</tbody></table>{bookings.length === 0 && <p className="admin-empty">No bookings yet.</p>}</div>}

          {tab === 'slots' && <div className="manage-slots"><form className="slot-form" onSubmit={saveSlot}><h3>Add a booking slot</h3><p>Students choose their entry time during registration. The exit time is calculated from this duration.</p>{availableDurations.length ? <><label>Slot duration<select value={durationHours || String(availableDurations[0])} onChange={(event) => setDurationHours(event.target.value)} required>{availableDurations.map((hours) => <option key={hours} value={hours}>{hours} hours</option>)}</select></label><button className="primary-button" type="submit">Add duration</button></> : <p>All supported durations are set up. Deactivate a duration below if it should no longer be selected.</p>}</form><div className="slot-list"><h3>Available booking durations</h3>{slots.map((slot) => <article className="slot-row" key={slot.id}><div><strong>{slot.duration_hours} hours</strong><span>Students provide an entry time during registration</span></div><span className={'status-pill ' + (slot.active ? 'active' : 'inactive')}>{slot.active ? 'active' : 'inactive'}</span><button className="manage-action" type="button" onClick={() => void toggleSlot(slot)}>{slot.active ? 'Deactivate' : 'Activate'}</button></article>)}{slots.length === 0 && <p className="admin-empty">Add the first booking duration.</p>}</div></div>}

          {tab === 'attendance' && <div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Booking date</th><th>Slot and seat</th><th>Attendance</th><th>Update</th></tr></thead><tbody>
            {bookings.map((booking) => { const record = attendanceByBooking.get(booking.id); const student = studentById.get(booking.student_id); const registration = registrationByStudentId.get(booking.student_id); const slot = slotById.get(booking.slot_id); return <tr key={booking.id}><td>{registration?.full_name || student?.full_name || student?.email || 'Student'}<small>{registration?.admission_number || registration?.email || student?.email}</small></td><td>{booking.booking_date}</td><td>{slot ? slot.duration_hours + ' hours' : 'Unknown slot'}<small>{registration ? 'Seat ' + registration.seat_number + ' · Entry ' + displayTime(registration.entry_time) : 'Registration pending'}</small></td><td><span className={'status-pill ' + (record?.status === 'present' ? 'active' : record?.status === 'absent' ? 'inactive' : 'pending')}>{record?.status || 'not marked'}</span></td><td><button className="manage-action" type="button" onClick={() => void markAttendance(booking, 'present')}>Present</button><button className="manage-action" type="button" onClick={() => void markAttendance(booking, 'absent')}>Absent</button></td></tr> })}</tbody></table>{bookings.length === 0 && <p className="admin-empty">Attendance will appear after bookings are created.</p>}</div>}
        </div>
      )}
    </section>
  )
}
