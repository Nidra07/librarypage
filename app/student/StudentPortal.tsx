'use client'

import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Profile = { full_name: string; status: 'active' | 'inactive' }
type Slot = { id: string; label: string; starts_at: string; ends_at: string }
type Booking = { id: string; slot_id: string; booking_date: string; status: 'booked' | 'cancelled' | 'completed' }
type Attendance = { booking_id: string; attended_on: string; checked_in_at: string; status: 'present' | 'absent' }

function localDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function StudentPortal({ userId }: { userId: string }) {
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [bookingDate, setBookingDate] = useState(localDate())
  const [slotId, setSlotId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const [profileResult, slotResult, bookingResult, attendanceResult] = await Promise.all([
      supabase.from('student_profiles').select('full_name,status').eq('id', userId).maybeSingle(),
      supabase.from('study_slots').select('id,label,starts_at,ends_at').eq('active', true).order('starts_at'),
      supabase.from('bookings').select('id,slot_id,booking_date,status').eq('student_id', userId).order('booking_date', { ascending: false }),
      supabase.from('attendance').select('booking_id,attended_on,checked_in_at,status').eq('student_id', userId).order('attended_on', { ascending: false }),
    ])
    const error = profileResult.error ?? slotResult.error ?? bookingResult.error ?? attendanceResult.error
    setMessage(error?.message ?? '')
    setProfile(profileResult.data as Profile | null)
    setSlots((slotResult.data ?? []) as Slot[])
    setBookings((bookingResult.data ?? []) as Booking[])
    setAttendance((attendanceResult.data ?? []) as Attendance[])
    setSlotId((current) => current || slotResult.data?.[0]?.id || '')
    setLoading(false)
  }

  useEffect(() => { void load() }, [userId])

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    const { error } = await supabase.from('bookings').insert({ student_id: userId, slot_id: slotId, booking_date: bookingDate })
    setMessage(error?.message ?? 'Your booking is confirmed.')
    if (!error) await load()
    setSaving(false)
  }

  async function checkIn(booking: Booking) {
    setMessage('')
    const { error } = await supabase.from('attendance').insert({ student_id: userId, booking_id: booking.id, attended_on: booking.booking_date, status: 'present' })
    setMessage(error?.message ?? 'Attendance checked in.')
    if (!error) await load()
  }

  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  const attendanceByBooking = new Map(attendance.map((record) => [record.booking_id, record]))

  return <div className="student-dashboard">
    <section className="student-card"><div className="student-card-heading"><div><h2>Book a study visit</h2><p>Choose an open time slot for your visit.</p></div><span className={`status-pill ${profile?.status === 'active' ? 'active' : 'inactive'}`}>{profile?.status || 'profile pending'}</span></div>
      {profile?.status === 'inactive' ? <p className="manage-message">Your membership is inactive. Please contact the library administrator to book a visit.</p> : <form className="student-book-form" onSubmit={book}><label>Visit date<input type="date" min={localDate()} value={bookingDate} onChange={(event) => setBookingDate(event.target.value)} required /></label><label>Time slot<select value={slotId} onChange={(event) => setSlotId(event.target.value)} required>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label} · {slot.starts_at.slice(0, 5)}–{slot.ends_at.slice(0, 5)}</option>)}</select></label><button className="primary-button" type="submit" disabled={saving || loading || !slotId || profile?.status !== 'active'}>{saving ? 'Booking…' : 'Book visit'}</button></form>}
    </section>

    {message && <p className="manage-message" role="status">{message}</p>}
    <div className="student-columns"><section className="student-card"><h2>Your bookings</h2>{loading ? <p className="admin-empty">Loading bookings…</p> : bookings.length ? <div className="student-record-list">{bookings.map((booking) => { const slot = slotById.get(booking.slot_id); const record = attendanceByBooking.get(booking.id); return <article className="student-record" key={booking.id}><div><strong>{booking.booking_date}</strong><span>{slot ? `${slot.label} · ${slot.starts_at.slice(0, 5)}–${slot.ends_at.slice(0, 5)}` : 'Slot unavailable'}</span><small>Booking: {booking.status}{record ? ` · Attendance: ${record.status}` : ''}</small></div>{booking.booking_date === localDate() && booking.status === 'booked' && !record && profile?.status === 'active' && <button type="button" className="manage-action" onClick={() => void checkIn(booking)}>Check in</button>}</article> })}</div> : <p className="admin-empty">You have no bookings yet.</p>}</section>
      <section className="student-card"><h2>Attendance history</h2>{loading ? <p className="admin-empty">Loading attendance…</p> : attendance.length ? <div className="student-record-list">{attendance.map((record) => { const booking = bookings.find((item) => item.id === record.booking_id); const slot = booking ? slotById.get(booking.slot_id) : null; return <article className="student-record" key={record.booking_id}><div><strong>{record.attended_on}</strong><span>{slot?.label || 'Library visit'}</span><small>Checked in {new Date(record.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div><span className={`status-pill ${record.status === 'present' ? 'active' : 'inactive'}`}>{record.status}</span></article> })}</div> : <p className="admin-empty">Your attendance records will appear here.</p>}</section></div>
    {!loading && slots.length === 0 && profile?.status === 'active' && <p className="manage-message">There are no active booking slots. Please check back later.</p>}
  </div>
}
