'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Section = 'dashboard' | 'students' | 'bookings' | 'attendance' | 'payments' | 'seats' | 'slots' | 'settings' | 'audit'
type Student = { id: string; full_name: string; email: string; phone: string | null; address: string; status: 'active' | 'inactive' | 'suspended'; monthly_fee_override: number | null; registration_fee_discount: number; registration_fee_waived: boolean; created_at: string }
type Registration = { student_id: string; full_name: string; admission_number: string; phone: string; email: string; address: string; slot_id: string; entry_time: string; exit_time: string; seat_number: string }
type Slot = { id: string; label: string; duration_hours: number; starts_at: string; ends_at: string; active: boolean }
type Seat = { seat_number: number; label: string; status: 'available' | 'maintenance' | 'disabled' }
type Booking = { id: string; student_id: string; slot_id: string; booking_date: string; seat_number: number; entry_time: string; exit_time: string; exit_day_offset: number; status: 'confirmed' | 'cancelled' | 'completed' }
type Attendance = { id: string; student_id: string; booking_id: string; attended_on: string; checked_in_at: string; status: 'present' | 'absent' }
type Payment = { id: string; student_id: string; payment_type: 'registration' | 'monthly'; billing_month: string | null; amount: number; method: 'phonepe' | 'cash'; transaction_reference: string | null; status: 'pending' | 'verified' | 'rejected'; admin_note: string | null; submitted_at: string; reviewed_at: string | null }
type Audit = { id: number; actor_id: string | null; action: string; table_name: string; row_key: string; created_at: string }
type Settings = { monthly_fee: number | null; phonepe_upi_id: string; phonepe_instructions: string }
type BillingDraft = { monthly_fee_override: string; registration_fee_discount: string; registration_fee_waived: boolean }
type CollectionTotals = { total_received: number; month_total: number; quarter_total: number; year_total: number }
type DraftBooking = Pick<Booking, 'booking_date' | 'slot_id' | 'seat_number' | 'status'>

const nav: { id: Section; label: string; href: string }[] = [
  { id: 'dashboard', label: 'Overview', href: '/admin' },
  { id: 'students', label: 'Students', href: '/admin/students' },
  { id: 'bookings', label: 'Bookings', href: '/admin/bookings' },
  { id: 'attendance', label: 'Attendance', href: '/admin/attendance' },
  { id: 'payments', label: 'Payments', href: '/admin/payments' },
  { id: 'seats', label: 'Seats', href: '/admin/seats' },
  { id: 'slots', label: 'Time slots', href: '/admin/slots' },
  { id: 'settings', label: 'Fee settings', href: '/admin/settings' },
  { id: 'audit', label: 'Activity log', href: '/admin/audit' },
]

function prettyDate(value: string) { return new Date(value + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
function prettyTime(value: string, dayOffset = 0) { return new Date('2000-01-01T' + value.slice(0, 5) + ':00').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (dayOffset ? ' (next day)' : '') }
function formatRupees(value: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value) }

export default function AdminOperations({ section }: { section: Section }) {
  const supabase = createClient()
  const [students, setStudents] = useState<Student[]>([])
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [seats, setSeats] = useState<Seat[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [audit, setAudit] = useState<Audit[]>([])
  const [settings, setSettings] = useState<Settings>({ monthly_fee: null, phonepe_upi_id: '', phonepe_instructions: '' })
  const [settingDraft, setSettingDraft] = useState<Settings>({ monthly_fee: null, phonepe_upi_id: '', phonepe_instructions: '' })
  const [billingDrafts, setBillingDrafts] = useState<Record<string, BillingDraft>>({})
  const [collectionTotals, setCollectionTotals] = useState<CollectionTotals>({ total_received: 0, month_total: 0, quarter_total: 0, year_total: 0 })
  const [slotDrafts, setSlotDrafts] = useState<Record<string, Slot>>({})
  const [bookingDrafts, setBookingDrafts] = useState<Record<string, DraftBooking>>({})
  const [seatLabelDrafts, setSeatLabelDrafts] = useState<Record<number, string>>({})
  const [newSlot, setNewSlot] = useState({ label: '', duration_hours: 4, starts_at: '08:00', ends_at: '12:00' })
  const [newSeat, setNewSeat] = useState({ seat_number: '', label: '' })
  const [studentSearch, setStudentSearch] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const [studentResult, registrationResult, slotResult, seatResult, bookingResult, attendanceResult, paymentResult, settingsResult, auditResult, collectionResult] = await Promise.all([
      supabase.from('student_profiles').select('id,full_name,email,phone,address,status,monthly_fee_override,registration_fee_discount,registration_fee_waived,created_at').order('created_at', { ascending: false }),
      supabase.from('student_registrations').select('student_id,full_name,admission_number,phone,email,address,slot_id,entry_time,exit_time,seat_number').order('created_at', { ascending: false }),
      supabase.from('study_slots').select('id,label,duration_hours,starts_at,ends_at,active').order('starts_at'),
      supabase.from('seats').select('seat_number,label,status').order('seat_number'),
      supabase.from('bookings').select('id,student_id,slot_id,booking_date,seat_number,entry_time,exit_time,exit_day_offset,status').order('booking_date', { ascending: false }),
      supabase.from('attendance').select('id,student_id,booking_id,attended_on,checked_in_at,status').order('attended_on', { ascending: false }),
      supabase.from('payments').select('id,student_id,payment_type,billing_month,amount,method,transaction_reference,status,admin_note,submitted_at,reviewed_at').order('submitted_at', { ascending: false }),
      supabase.from('library_settings').select('monthly_fee,phonepe_upi_id,phonepe_instructions').eq('singleton', true).maybeSingle(),
      supabase.from('audit_logs').select('id,actor_id,action,table_name,row_key,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.rpc('admin_payment_collection_totals'),
    ])
    const error = studentResult.error ?? registrationResult.error ?? slotResult.error ?? seatResult.error ?? bookingResult.error ?? attendanceResult.error ?? paymentResult.error ?? settingsResult.error ?? auditResult.error ?? collectionResult.error
    setMessage(error?.message ?? '')
    setStudents((studentResult.data ?? []) as Student[])
    setRegistrations((registrationResult.data ?? []) as Registration[])
    setSlots((slotResult.data ?? []) as Slot[])
    setSeats((seatResult.data ?? []) as Seat[])
    setBookings((bookingResult.data ?? []) as Booking[])
    setAttendance((attendanceResult.data ?? []) as Attendance[])
    setPayments((paymentResult.data ?? []) as Payment[])
    setAudit((auditResult.data ?? []) as Audit[])
    const config = (settingsResult.data ?? { monthly_fee: null, phonepe_upi_id: '', phonepe_instructions: '' }) as Settings
    setSettings(config); setSettingDraft(config)
    setBillingDrafts(Object.fromEntries((studentResult.data ?? []).map((student) => [student.id, {
      monthly_fee_override: student.monthly_fee_override == null ? '' : String(student.monthly_fee_override),
      registration_fee_discount: String(student.registration_fee_discount ?? 0),
      registration_fee_waived: Boolean(student.registration_fee_waived),
    } as BillingDraft])))
    const totals = collectionResult.data?.[0] as CollectionTotals | undefined
    if (totals) setCollectionTotals({ total_received: Number(totals.total_received), month_total: Number(totals.month_total), quarter_total: Number(totals.quarter_total), year_total: Number(totals.year_total) })
    setSlotDrafts(Object.fromEntries((slotResult.data ?? []).map((slot) => [slot.id, slot as Slot])))
    setSeatLabelDrafts(Object.fromEntries((seatResult.data ?? []).map((seat) => [seat.seat_number, seat.label as string])))
    setBookingDrafts(Object.fromEntries((bookingResult.data ?? []).map((booking) => [booking.id, {
      booking_date: booking.booking_date, slot_id: booking.slot_id,
      seat_number: booking.seat_number, status: booking.status,
    } as DraftBooking])))
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const studentById = new Map(students.map((student) => [student.id, student]))
  const registrationById = new Map(registrations.map((registration) => [registration.student_id, registration]))
  const slotById = new Map(slots.map((slot) => [slot.id, slot]))
  const attendanceByBooking = new Map(attendance.map((record) => [record.booking_id, record]))
  const sectionTitle = nav.find((item) => item.id === section)?.label ?? 'Library operations'

  async function setStudentStatus(student: Student, status: Student['status']) {
    const { error } = await supabase.from('student_profiles').update({ status, updated_at: new Date().toISOString() }).eq('id', student.id)
    setMessage(error?.message ?? (student.full_name || student.email) + ' is now ' + status + '.')
    if (!error) await load()
  }
  async function saveStudentBilling(student: Student) {
    const draft = billingDrafts[student.id]
    if (!draft) return
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('admin_update_student_billing', {
      p_student_id: student.id,
      p_monthly_fee_override: draft.monthly_fee_override === '' ? null : Number(draft.monthly_fee_override),
      p_registration_fee_discount: Number(draft.registration_fee_discount),
      p_registration_fee_waived: draft.registration_fee_waived,
    })
    setMessage(error?.message ?? 'Billing settings saved for ' + (student.full_name || student.email) + '.')
    if (!error) await load()
    setSaving(false)
  }
  async function saveBooking(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const draft = bookingDrafts[id]
    if (!draft) return
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('admin_update_booking', {
      p_booking_id: id,
      p_booking_date: draft.booking_date,
      p_slot_id: draft.slot_id,
      p_seat_number: Number(draft.seat_number),
      p_status: draft.status,
    })
    setMessage(error?.message ?? 'Booking updated after availability, payment, and membership checks.')
    if (!error) await load()
    setSaving(false)
  }
  async function updateAttendance(bookingId: string, status: 'present' | 'absent') {
    const { error } = await supabase.rpc('admin_set_attendance', { p_booking_id: bookingId, p_status: status })
    setMessage(error?.message ?? 'Attendance updated.')
    if (!error) await load()
  }
  async function reviewPayment(id: string, status: 'verified' | 'rejected') {
    const note = window.prompt(status === 'verified' ? 'Optional admin note:' : 'Reason for rejection (optional):')
    if (note === null) return
    const { error } = await supabase.rpc('admin_review_payment', { p_payment_id: id, p_status: status, p_note: note })
    setMessage(error?.message ?? 'Payment ' + status + '.')
    if (!error) await load()
  }
  async function changeSeat(seat: Seat, field: 'status' | 'label', value: string) {
    const { error } = await supabase.from('seats').update({ [field]: value, updated_at: new Date().toISOString() }).eq('seat_number', seat.seat_number)
    setMessage(error?.message ?? 'Seat ' + seat.seat_number + ' updated.')
    if (!error) await load()
  }
  async function addSeat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true)
    const number = Number(newSeat.seat_number)
    const { error } = await supabase.from('seats').insert({ seat_number: number, label: newSeat.label.trim() || 'Seat ' + number, status: 'available' })
    setMessage(error?.message ?? 'Seat ' + number + ' added.')
    if (!error) { setNewSeat({ seat_number: '', label: '' }); await load() }
    setSaving(false)
  }
  async function saveSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true)
    const payload = { ...newSlot, label: newSlot.label.trim() || newSlot.duration_hours + '-hour slot', active: true }
    const { error } = await supabase.from('study_slots').insert(payload)
    setMessage(error?.message ?? 'Booking slot added.')
    if (!error) { setNewSlot({ label: '', duration_hours: 4, starts_at: '08:00', ends_at: '12:00' }); await load() }
    setSaving(false)
  }
  async function updateSlot(event: FormEvent<HTMLFormElement>, slotId: string) {
    event.preventDefault()
    const slot = slotDrafts[slotId]
    if (!slot) return
    setSaving(true)
    const { error } = await supabase.from('study_slots').update({ label: slot.label, duration_hours: Number(slot.duration_hours), starts_at: slot.starts_at, ends_at: slot.ends_at, active: slot.active }).eq('id', slotId)
    setMessage(error?.message ?? 'Slot updated. Existing visits keep their saved times.')
    if (!error) await load()
    setSaving(false)
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true)
    const { error } = await supabase.from('library_settings').update({ monthly_fee: settingDraft.monthly_fee || null, phonepe_upi_id: settingDraft.phonepe_upi_id.trim(), phonepe_instructions: settingDraft.phonepe_instructions, updated_at: new Date().toISOString() }).eq('singleton', true)
    setMessage(error?.message ?? 'Default fees, shared UPI ID, and payment instructions saved.')
    if (!error) await load()
    setSaving(false)
  }

  return <main className="member-page admin-page"><div className="admin-wrap">
    <header className="admin-heading"><div><span className="eyebrow">Library administration</span><h1>{sectionTitle}</h1><p>Manage students, bookings, attendance, payments, seats, and time slots.</p></div><Link href="/" className="text-button">Back to library →</Link></header>
    <nav className="admin-nav" aria-label="Admin dashboard">{nav.map((item) => <Link key={item.id} href={item.href} className={section === item.id ? 'active' : ''}>{item.label}</Link>)}<Link href="/admin/achievers">Job achievers</Link></nav>
    {message && <p className="manage-message" role="status">{message}</p>}
    {loading ? <section className="manage-panel"><p className="admin-empty">Loading library records…</p></section> : <>
      {section === 'dashboard' && <><div className="admin-stat-grid"><article><small>Students</small><strong>{students.length}</strong><span>{students.filter((item) => item.status === 'active').length} active</span></article><article><small>Bookings</small><strong>{bookings.filter((item) => item.status === 'confirmed').length}</strong><span>{bookings.filter((item) => item.booking_date >= new Date().toISOString().slice(0, 10) && item.status === 'confirmed').length} upcoming</span></article><article><small>Attendance</small><strong>{attendance.filter((item) => item.status === 'present').length}</strong><span>Present records</span></article><article><small>Pending payments</small><strong>{payments.filter((item) => item.status === 'pending').length}</strong><span>Needs manual review</span></article></div><section className="manage-panel"><div className="manage-heading"><h2>Library activity</h2><p>Quick access to current operational queues and configuration.</p></div><div className="admin-quicklinks">{nav.filter((item) => item.id !== 'dashboard').map((item) => <Link key={item.id} href={item.href}><strong>{item.label}</strong><span>{item.id === 'payments' ? payments.filter((p) => p.status === 'pending').length + ' pending' : item.id === 'students' ? students.length + ' records' : item.id === 'bookings' ? bookings.length + ' records' : 'Open section'} →</span></Link>)}</div></section></>}

      {section === 'students' && <section className="manage-panel"><div className="manage-heading"><h2>Student accounts</h2><p>Review offline admission details, control membership, and set per-student billing. Leave monthly fee blank to use the shared default.</p></div><label className="search-label">Search students<input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Name, email, admission number" /></label><div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Admission</th><th>Contact and address</th><th>Joined</th><th>Status</th><th>Manage status</th><th>Fee settings</th></tr></thead><tbody>{students.filter((student) => { const registration = registrationById.get(student.id); const search = (student.full_name + ' ' + student.email + ' ' + (registration?.admission_number ?? '')).toLowerCase(); return search.includes(studentSearch.toLowerCase()) }).map((student) => { const registration = registrationById.get(student.id); const draft = billingDrafts[student.id] ?? { monthly_fee_override: '', registration_fee_discount: '0', registration_fee_waived: false }; const updateBilling = (value: Partial<BillingDraft>) => setBillingDrafts((current) => ({ ...current, [student.id]: { ...draft, ...value } })); const registrationDue = draft.registration_fee_waived ? 0 : Math.max(0, 100 - Number(draft.registration_fee_discount || 0)); return <tr key={student.id}><td><strong>{registration?.full_name || student.full_name || 'Name not provided'}</strong><small>{student.email}</small></td><td>{registration?.admission_number ?? 'Registration pending'}</td><td>{registration?.phone || student.phone || 'No phone'}<small>{registration?.address || student.address}</small></td><td>{prettyDate(student.created_at.slice(0, 10))}</td><td><span className={'status-pill ' + student.status}>{student.status}</span></td><td><select aria-label={'Set status for ' + student.full_name} value={student.status} onChange={(event) => void setStudentStatus(student, event.target.value as Student['status'])}><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></td><td><div className="student-billing-fields"><label>Monthly override (₹)<input type="number" min="0.01" step="0.01" value={draft.monthly_fee_override} onChange={(event) => updateBilling({ monthly_fee_override: event.target.value })} placeholder={settings.monthly_fee ? 'Default ₹' + settings.monthly_fee : 'Default not set'} /></label><label>Registration rebate (₹)<input type="number" min="0" max="100" step="0.01" value={draft.registration_fee_discount} onChange={(event) => updateBilling({ registration_fee_discount: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={draft.registration_fee_waived} onChange={(event) => updateBilling({ registration_fee_waived: event.target.checked })} /> Skip registration fee</label><button className="manage-action" type="button" onClick={() => void saveStudentBilling(student)} disabled={saving}>Save billing</button><small>Due now: {draft.registration_fee_waived ? 'Registration waived' : '₹' + registrationDue + ' registration'} · Monthly {draft.monthly_fee_override || (settings.monthly_fee ? '₹' + settings.monthly_fee + ' default' : 'not set')}</small></div></td></tr>})}</tbody></table>{students.length === 0 && <p className="admin-empty">No student profiles found.</p>}</div></section>}
      {section === 'bookings' && <section className="manage-panel"><div className="manage-heading"><h2>Booking management</h2><p>Changing a visit rechecks active membership, verified fees, slot availability, and seat overlap.</p></div><div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Visit date</th><th>Slot</th><th>Seat</th><th>Status</th><th>Save</th></tr></thead><tbody>{bookings.map((booking) => { const registration = registrationById.get(booking.student_id); const student = studentById.get(booking.student_id); const draft = bookingDrafts[booking.id] ?? booking; const update = (value: Partial<DraftBooking>) => setBookingDrafts((current) => ({ ...current, [booking.id]: { ...draft, ...value } })); return <tr key={booking.id}><td><strong>{registration?.full_name || student?.full_name || student?.email || 'Student'}</strong><small>{registration?.admission_number || student?.email}</small></td><td><input aria-label="Booking date" type="date" value={draft.booking_date} onChange={(event) => update({ booking_date: event.target.value })} /></td><td><select aria-label="Booking time slot" value={draft.slot_id} onChange={(event) => update({ slot_id: event.target.value })}>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label} · {slot.duration_hours}h {slot.active ? '' : '(inactive)'}</option>)}</select><small>{prettyTime(booking.entry_time)}–{prettyTime(booking.exit_time, booking.exit_day_offset)}</small></td><td><select aria-label="Booking seat" value={draft.seat_number} onChange={(event) => update({ seat_number: Number(event.target.value) })}>{seats.map((seat) => <option key={seat.seat_number} value={seat.seat_number} disabled={seat.status !== 'available' && seat.seat_number !== booking.seat_number}>{seat.label || seat.seat_number}{seat.status !== 'available' ? ' · ' + seat.status : ''}</option>)}</select></td><td><select aria-label="Booking status" value={draft.status} onChange={(event) => update({ status: event.target.value as DraftBooking['status'] })}><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></td><td><form onSubmit={(event) => void saveBooking(event, booking.id)}><button className="manage-action" type="submit" disabled={saving}>Save</button></form></td></tr>})}</tbody></table>{bookings.length === 0 && <p className="admin-empty">No bookings have been made.</p>}</div></section>}

      {section === 'attendance' && <section className="manage-panel"><div className="manage-heading"><h2>Attendance records</h2><p>Student check-ins appear as they happen. Admin changes are recorded in the activity log.</p></div><div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Visit</th><th>Slot / seat</th><th>Attendance</th><th>Correct record</th></tr></thead><tbody>{bookings.map((booking) => { const record = attendanceByBooking.get(booking.id); const student = studentById.get(booking.student_id); const registration = registrationById.get(booking.student_id); const slot = slotById.get(booking.slot_id); return <tr key={booking.id}><td><strong>{registration?.full_name || student?.full_name || 'Student'}</strong><small>{registration?.admission_number || student?.email}</small></td><td>{prettyDate(booking.booking_date)}</td><td>{slot?.label || 'Unknown slot'} · Seat {booking.seat_number}<small>{prettyTime(booking.entry_time)}–{prettyTime(booking.exit_time, booking.exit_day_offset)}</small></td><td><span className={'status-pill ' + (record?.status === 'present' ? 'active' : record?.status === 'absent' ? 'inactive' : 'pending')}>{record?.status || 'not marked'}</span>{record && <small>{new Date(record.checked_in_at).toLocaleString()}</small>}</td><td><button className="manage-action" type="button" onClick={() => void updateAttendance(booking.id, 'present')}>Present</button><button className="manage-action danger-action" type="button" onClick={() => void updateAttendance(booking.id, 'absent')}>Absent</button></td></tr>})}</tbody></table>{bookings.length === 0 && <p className="admin-empty">Attendance appears here when visits are booked.</p>}</div></section>}

      {section === 'payments' && <section className="manage-panel"><div className="manage-heading"><h2>Payment verification</h2><p>PhonePe and UPI transfers and cash submissions require admin review. Collection totals include verified payments only.</p></div><div className="admin-stat-grid payment-stat-grid"><article><small>Total received</small><strong>{formatRupees(collectionTotals.total_received)}</strong><span>All verified payments</span></article><article><small>This month</small><strong>{formatRupees(collectionTotals.month_total)}</strong><span>Received this month</span></article><article><small>This quarter</small><strong>{formatRupees(collectionTotals.quarter_total)}</strong><span>Received this quarter</span></article><article><small>This year</small><strong>{formatRupees(collectionTotals.year_total)}</strong><span>Received this year</span></article></div><div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Student</th><th>Fee</th><th>Method / reference</th><th>Submitted</th><th>Status</th><th>Review</th></tr></thead><tbody>{payments.map((payment) => { const student = studentById.get(payment.student_id); const registration = registrationById.get(payment.student_id); return <tr key={payment.id}><td><strong>{registration?.full_name || student?.full_name || 'Student'}</strong><small>{registration?.admission_number || student?.email}</small></td><td>{payment.payment_type === 'registration' ? 'One-time registration' : 'Monthly · ' + (payment.billing_month ? prettyDate(payment.billing_month) : '')}<small>₹{payment.amount}</small></td><td>{payment.method === 'phonepe' ? 'PhonePe / UPI' : 'Cash'}<small>{payment.transaction_reference || 'No transaction reference'}</small></td><td>{prettyDate(payment.submitted_at.slice(0, 10))}</td><td><span className={'status-pill ' + payment.status}>{payment.status}</span>{payment.admin_note && <small>{payment.admin_note}</small>}</td><td>{payment.status === 'pending' ? <><button className="manage-action" type="button" onClick={() => void reviewPayment(payment.id, 'verified')}>Verify</button><button className="manage-action danger-action" type="button" onClick={() => void reviewPayment(payment.id, 'rejected')}>Reject</button></> : 'Reviewed'}</td></tr>})}</tbody></table>{payments.length === 0 && <p className="admin-empty">No payment submissions yet.</p>}</div></section>}
      {section === 'seats' && <section className="manage-panel"><div className="manage-heading"><h2>Library seats</h2><p>Seats 1–43 were added automatically. Disable a seat temporarily without deleting booking history.</p></div><form className="admin-inline-form" onSubmit={addSeat}><label>New seat number<input type="number" min="1" max="999" value={newSeat.seat_number} onChange={(event) => setNewSeat({ ...newSeat, seat_number: event.target.value })} required /></label><label>Label<input value={newSeat.label} onChange={(event) => setNewSeat({ ...newSeat, label: event.target.value })} placeholder="Seat 44" /></label><button className="primary-button" disabled={saving}>Add seat</button></form><div className="seat-admin-grid">{seats.map((seat) => <article className="seat-admin-card" key={seat.seat_number}><input aria-label={'Label for seat ' + seat.seat_number} value={seatLabelDrafts[seat.seat_number] ?? ''} onChange={(event) => setSeatLabelDrafts((current) => ({ ...current, [seat.seat_number]: event.target.value }))} onBlur={(event) => { if (event.target.value !== seat.label) void changeSeat(seat, 'label', event.target.value) }} maxLength={80} /><small>Number {seat.seat_number}</small><select aria-label={'Status for seat ' + seat.seat_number} value={seat.status} onChange={(event) => void changeSeat(seat, 'status', event.target.value)}><option value="available">Available</option><option value="maintenance">Maintenance</option><option value="disabled">Disabled</option></select></article>)}</div></section>}

      {section === 'slots' && <div className="slot-admin-layout"><section className="manage-panel"><h2>Add a time slot</h2><p className="muted-copy">Each slot has an admin-set start and end time. Its duration must be 4, 6, 8, or 12 hours.</p><form className="auth-form slot-admin-form" onSubmit={saveSlot}><label>Slot name<input value={newSlot.label} onChange={(event) => setNewSlot({ ...newSlot, label: event.target.value })} placeholder="Morning study" /></label><label>Duration<select value={newSlot.duration_hours} onChange={(event) => setNewSlot({ ...newSlot, duration_hours: Number(event.target.value) })}>{[4, 6, 8, 12].map((duration) => <option key={duration} value={duration}>{duration} hours</option>)}</select></label><div className="admin-two"><label>Start time<input type="time" value={newSlot.starts_at} onChange={(event) => setNewSlot({ ...newSlot, starts_at: event.target.value })} required /></label><label>End time<input type="time" value={newSlot.ends_at} onChange={(event) => setNewSlot({ ...newSlot, ends_at: event.target.value })} required /></label></div><button className="primary-button" disabled={saving}>Add slot</button></form></section><section className="manage-panel"><h2>Configured time slots</h2><div className="slot-edit-list">{slots.map((slot) => { const draft = slotDrafts[slot.id] ?? slot; const update = (value: Partial<Slot>) => setSlotDrafts((current) => ({ ...current, [slot.id]: { ...draft, ...value } })); return <form className="slot-edit-card" key={slot.id} onSubmit={(event) => void updateSlot(event, slot.id)}><label>Slot name<input value={draft.label} onChange={(event) => update({ label: event.target.value })} required /></label><div className="admin-two"><label>Duration<select value={draft.duration_hours} onChange={(event) => update({ duration_hours: Number(event.target.value) })}>{[4, 6, 8, 12].map((duration) => <option key={duration} value={duration}>{duration} hours</option>)}</select></label><label>Active<select value={draft.active ? 'yes' : 'no'} onChange={(event) => update({ active: event.target.value === 'yes' })}><option value="yes">Active</option><option value="no">Inactive</option></select></label></div><div className="admin-two"><label>Starts<input type="time" value={draft.starts_at.slice(0, 5)} onChange={(event) => update({ starts_at: event.target.value })} required /></label><label>Ends<input type="time" value={draft.ends_at.slice(0, 5)} onChange={(event) => update({ ends_at: event.target.value })} required /></label></div><button className="manage-action" type="submit" disabled={saving}>Save slot</button></form>})}</div></section></div>}

      {section === 'settings' && <section className="manage-panel"><h2>Fee and payment settings</h2><p className="muted-copy">Set an optional shared default monthly fee, a UPI ID for all students, and payment instructions. Per-student fees and registration rebates are managed from Students.</p><form className="auth-form settings-form" onSubmit={saveSettings}><label>Default monthly library fee (₹)<input type="number" min="1" step="0.01" value={settingDraft.monthly_fee ?? ''} onChange={(event) => setSettingDraft({ ...settingDraft, monthly_fee: event.target.value ? Number(event.target.value) : null })} placeholder="Leave blank when every student has an individual fee" /></label><label>Shared PhonePe business UPI ID<input value={settingDraft.phonepe_upi_id} onChange={(event) => setSettingDraft({ ...settingDraft, phonepe_upi_id: event.target.value })} maxLength={100} placeholder="library@bank" /></label><label>PhonePe payment instructions<textarea rows={5} value={settingDraft.phonepe_instructions} onChange={(event) => setSettingDraft({ ...settingDraft, phonepe_instructions: event.target.value })} maxLength={2000} placeholder="Add directions students should follow before submitting a payment." /></label><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button><p className="admin-message">Default monthly fee: {settings.monthly_fee ? '₹' + settings.monthly_fee : 'Not set'} · Shared UPI ID: {settings.phonepe_upi_id || 'Not set'}</p></form></section>}
      {section === 'audit' && <section className="manage-panel"><div className="manage-heading"><h2>Admin activity log</h2><p>Recent changes to bookings, payments, attendance, students, seats, slots, and settings.</p></div><div className="manage-table-wrap"><table className="manage-table"><thead><tr><th>Time</th><th>Action</th><th>Record</th><th>Admin account</th></tr></thead><tbody>{audit.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.action}</td><td>{item.table_name} · {item.row_key}</td><td>{item.actor_id ?? 'System'}</td></tr>)}</tbody></table>{audit.length === 0 && <p className="admin-empty">No changes have been logged yet.</p>}</div></section>}
    </>}
  </div></main>
}

