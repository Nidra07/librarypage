'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Section = 'dashboard' | 'book' | 'bookings' | 'attendance' | 'payments' | 'profile'
type Profile = { id: string; full_name: string; email: string; phone: string | null; address: string; status: 'active' | 'inactive' | 'suspended'; monthly_fee_override: number | null; registration_fee_discount: number; registration_fee_waived: boolean }
type Registration = { admission_number: string; full_name: string; phone: string; email: string; address: string; slot_id: string; entry_time: string; exit_time: string; exit_day_offset: number; seat_number: string }
type Slot = { id: string; label: string; duration_hours: number; starts_at: string; ends_at: string; active: boolean }
type Seat = { seat_number: number; label: string; status: 'available' | 'maintenance' | 'disabled'; is_available: boolean }
type Booking = { id: string; slot_id: string; booking_date: string; seat_number: number; entry_time: string; exit_time: string; exit_day_offset: number; status: 'confirmed' | 'cancelled' | 'completed' }
type Attendance = { id: string; booking_id: string; attended_on: string; checked_in_at: string; status: 'present' | 'absent' }
type Payment = { id: string; payment_type: 'registration' | 'monthly'; billing_month: string | null; amount: number; method: 'phonepe' | 'cash'; transaction_reference: string | null; status: 'pending' | 'verified' | 'rejected'; admin_note: string | null; submitted_at: string }
type Settings = { monthly_fee: number | null; phonepe_upi_id: string; phonepe_instructions: string }

const nav: { id: Section; label: string; href: string }[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/protected' },
  { id: 'book', label: 'Book a seat', href: '/protected/book' },
  { id: 'bookings', label: 'My bookings', href: '/protected/bookings' },
  { id: 'attendance', label: 'Attendance', href: '/protected/attendance' },
  { id: 'payments', label: 'Payments', href: '/protected/payments' },
  { id: 'profile', label: 'Profile', href: '/protected/profile' },
]

function localDate() {
  const date = new Date()
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}
function firstOfMonth(date: string) { return date.slice(0, 7) + '-01' }
function prettyDate(value: string) { return new Date(value + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
function prettyTime(value: string, dayOffset = 0) {
  return new Date('2000-01-01T' + value.slice(0, 5) + ':00').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (dayOffset ? ' (next day)' : '')
}
function monthOptions() {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() + index)
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-01'
  })
}

export default function StudentPortal({ userId, section = 'dashboard' }: { userId: string; section?: Section }) {
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [seats, setSeats] = useState<Seat[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [settings, setSettings] = useState<Settings>({ monthly_fee: null, phonepe_upi_id: '', phonepe_instructions: '' })
  const [bookingDate, setBookingDate] = useState(localDate())
  const [slotId, setSlotId] = useState('')
  const [seatNumber, setSeatNumber] = useState<number | null>(null)
  const [billingMonth, setBillingMonth] = useState(firstOfMonth(localDate()))
  const [paymentType, setPaymentType] = useState<'registration' | 'monthly'>('registration')
  const [paymentMethod, setPaymentMethod] = useState<'phonepe' | 'cash'>('phonepe')
  const [paymentReference, setPaymentReference] = useState('')
  const [profileDraft, setProfileDraft] = useState({ full_name: '', phone: '', address: '' })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const [profileResult, registrationResult, slotResult, bookingResult, attendanceResult, paymentResult, settingsResult] = await Promise.all([
      supabase.from('student_profiles').select('id,full_name,email,phone,address,status,monthly_fee_override,registration_fee_discount,registration_fee_waived').eq('id', userId).maybeSingle(),
      supabase.from('student_registrations').select('admission_number,full_name,phone,email,address,slot_id,entry_time,exit_time,exit_day_offset,seat_number').eq('student_id', userId).maybeSingle(),
      supabase.from('study_slots').select('id,label,duration_hours,starts_at,ends_at,active').eq('active', true).order('starts_at'),
      supabase.from('bookings').select('id,slot_id,booking_date,seat_number,entry_time,exit_time,exit_day_offset,status').eq('student_id', userId).order('booking_date', { ascending: false }),
      supabase.from('attendance').select('id,booking_id,attended_on,checked_in_at,status').eq('student_id', userId).order('attended_on', { ascending: false }),
      supabase.from('payments').select('id,payment_type,billing_month,amount,method,transaction_reference,status,admin_note,submitted_at').eq('student_id', userId).order('submitted_at', { ascending: false }),
      supabase.from('library_settings').select('monthly_fee,phonepe_upi_id,phonepe_instructions').eq('singleton', true).maybeSingle(),
    ])
    const error = profileResult.error ?? registrationResult.error ?? slotResult.error ?? bookingResult.error ?? attendanceResult.error ?? paymentResult.error ?? settingsResult.error
    setMessage(error?.message ?? '')
    setProfile(profileResult.data as Profile | null)
    setRegistration(registrationResult.data as Registration | null)
    setSlots((slotResult.data ?? []) as Slot[])
    setBookings((bookingResult.data ?? []) as Booking[])
    setAttendance((attendanceResult.data ?? []) as Attendance[])
    setPayments((paymentResult.data ?? []) as Payment[])
    setSettings((settingsResult.data ?? { monthly_fee: null, phonepe_upi_id: '', phonepe_instructions: '' }) as Settings)
    if (profileResult.data) {
      const data = profileResult.data as Profile
      setProfileDraft({ full_name: data.full_name, phone: data.phone ?? '', address: data.address ?? '' })
    }
    setSlotId((current) => current || slotResult.data?.[0]?.id || '')
    setLoading(false)
  }
  useEffect(() => { void load() }, [userId])
  useEffect(() => {
    if (section !== 'book' || !slotId) { setSeats([]); return }
    let current = true
    setAvailabilityLoading(true)
    void supabase.rpc('get_seat_availability', { p_booking_date: bookingDate, p_slot_id: slotId }).then(({ data, error }) => {
      if (!current) return
      if (error) { setMessage(error.message); setSeats([]) }
      else setSeats((data ?? []) as Seat[])
      setAvailabilityLoading(false)
    })
    return () => { current = false }
  }, [bookingDate, slotId, section, bookings])

  const slotById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots])
  const paymentById = useMemo(() => new Map<string, Payment[]>([
    ['registration', payments.filter((payment) => payment.payment_type === 'registration')],
    ['monthly', payments.filter((payment) => payment.payment_type === 'monthly')],
  ]), [payments])
  const selectedSlot = slots.find((slot) => slot.id === slotId)
  const registrationFeeDue = profile?.registration_fee_waived ? 0 : Math.max(0, 100 - (profile?.registration_fee_discount ?? 0))
  const monthlyFeeDue = profile?.monthly_fee_override ?? settings.monthly_fee
  const registeredPayment = paymentById.get('registration')?.find((payment) => payment.status === 'verified' && payment.amount >= registrationFeeDue)
  const monthPayments = payments.filter((payment) => payment.payment_type === 'monthly' && payment.billing_month === firstOfMonth(bookingDate))
  const monthPayment = monthPayments.find((payment) => payment.status === 'verified' && monthlyFeeDue != null && payment.amount >= monthlyFeeDue) ?? monthPayments[0]
  const hasRegistrationPayment = registrationFeeDue === 0 || Boolean(registeredPayment)
  const hasEligiblePayments = hasRegistrationPayment && monthPayment?.status === 'verified' && monthPayment.amount === monthlyFeeDue
  const presentCount = attendance.filter((item) => item.status === 'present').length
  const attendanceEligibleBookings = bookings.filter((booking) => booking.status !== 'cancelled').length
  const attendancePercent = attendanceEligibleBookings ? Math.round((presentCount / attendanceEligibleBookings) * 100) : 0
  const nextBooking = [...bookings].filter((booking) => booking.status === 'confirmed' && booking.booking_date >= localDate()).sort((a, b) => a.booking_date.localeCompare(b.booking_date))[0]
  const paymentAmountDue = paymentType === 'registration' ? registrationFeeDue : monthlyFeeDue
  const matchingPayments = payments.filter((payment) => payment.payment_type === paymentType &&
    (paymentType === 'registration' || payment.billing_month === billingMonth))
  const selectedPayment = matchingPayments.find((payment) => payment.status === 'pending') ??
    matchingPayments.find((payment) => payment.status === 'verified' && paymentAmountDue != null && payment.amount >= paymentAmountDue) ?? matchingPayments[0]
  const paymentAlreadyCurrent = Boolean(selectedPayment && (selectedPayment.status === 'pending' || (selectedPayment.status === 'verified' && paymentAmountDue != null && selectedPayment.amount >= paymentAmountDue)))
  const upiPaymentLink = settings.phonepe_upi_id && paymentAmountDue != null && paymentAmountDue > 0
    ? 'upi://pay?pa=' + encodeURIComponent(settings.phonepe_upi_id) + '&pn=' + encodeURIComponent('The Peaceful Pages') + '&am=' + encodeURIComponent(String(paymentAmountDue)) + '&cu=INR&tn=' + encodeURIComponent(paymentType === 'registration' ? 'Library registration fee' : 'Library fee ' + billingMonth.slice(0, 7))
    : ''

  function seatIsFree(number: number) {
    const seat = seats.find((item) => item.seat_number === number)
    return !availabilityLoading && seat?.status === 'available' && seat.is_available
  }

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (seatNumber === null) { setMessage('Select an available seat to continue.'); return }
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('book_seat', { p_booking_date: bookingDate, p_slot_id: slotId, p_seat_number: seatNumber })
    setMessage(error?.message ?? 'Your seat is confirmed.')
    if (!error) { setSeatNumber(null); await load() }
    setSaving(false)
  }
  async function cancelBooking(id: string) {
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('cancel_my_booking', { p_booking_id: id })
    setMessage(error?.message ?? 'Booking cancelled; the seat is available again.')
    if (!error) await load()
    setSaving(false)
  }
  async function markAttendance(id: string) {
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('mark_my_attendance', { p_booking_id: id })
    setMessage(error?.message ?? 'Attendance marked present.')
    if (!error) await load()
    setSaving(false)
  }
  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('')
    const { error } = await supabase.rpc('submit_payment', {
      p_payment_type: paymentType,
      p_billing_month: paymentType === 'monthly' ? billingMonth : null,
      p_method: paymentMethod,
      p_transaction_reference: paymentMethod === 'phonepe' ? paymentReference.trim() : null,
    })
    setMessage(error?.message ?? 'Payment submitted. It will stay pending until the administrator verifies it.')
    if (!error) { setPaymentReference(''); await load() }
    setSaving(false)
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('')
    const { error } = await supabase.rpc('update_my_student_profile', {
      p_full_name: profileDraft.full_name,
      p_phone: profileDraft.phone,
      p_address: profileDraft.address,
    })
    setMessage(error?.message ?? 'Profile saved.')
    if (!error) await load()
    setSaving(false)
  }

  return <main className="member-page student-page"><div className="student-wrap">
    <header className="student-header"><div><span className="eyebrow">Student portal</span><h1>{section === 'dashboard' ? 'Welcome, ' + (profile?.full_name || 'student') : nav.find((item) => item.id === section)?.label}</h1><p>{registration?.admission_number ? 'Admission ' + registration.admission_number : 'Your library account'}</p></div><Link href="/" className="text-button">Back to library →</Link></header>
    <nav className="student-nav" aria-label="Student dashboard">{nav.map((item) => <Link key={item.id} href={item.href} className={section === item.id ? 'active' : ''}>{item.label}</Link>)}</nav>
    {message && <p className="manage-message" role="status">{message}</p>}
    {loading ? <section className="student-card"><p className="admin-empty">Loading your library account…</p></section> : <>
      {profile?.status !== 'active' && <p className="manage-message student-alert">Your student account is {profile?.status ?? 'unavailable'}. Contact the library administrator for help.</p>}

      {section === 'dashboard' && <div className="student-dashboard">
        <div className="student-summary-grid"><article className="student-card"><small>Membership status</small><strong className={'status-pill ' + (profile?.status === 'active' ? 'active' : 'inactive')}>{profile?.status ?? 'unknown'}</strong><span>Offline admission {registration?.admission_number}</span></article><article className="student-card"><small>Attendance</small><strong>{attendancePercent}%</strong><span>{presentCount} present across {bookings.length} visits</span></article><article className="student-card"><small>Registration fee</small><strong>{registrationFeeDue === 0 ? 'Waived' : '₹' + registrationFeeDue + ' · ' + (registeredPayment ? 'verified' : 'due')}</strong><span>{profile?.registration_fee_discount ? '₹' + profile.registration_fee_discount + ' rebate applied' : 'Manual admin verification required'}</span></article><article className="student-card"><small>Next visit</small><strong>{nextBooking ? prettyDate(nextBooking.booking_date) : 'No upcoming visit'}</strong><span>{nextBooking ? 'Seat ' + nextBooking.seat_number + ' · ' + (slotById.get(nextBooking.slot_id)?.label ?? 'Study slot') : 'Book a seat when your fees are verified'}</span></article></div>
        {!hasEligiblePayments && <section className="student-card"><div className="student-card-heading"><div><h2>Finish payment verification</h2><p>{!hasRegistrationPayment ? 'Your registration fee of ₹' + registrationFeeDue + ' must be verified.' : !monthlyFeeDue ? 'The library has not set a monthly fee for your account yet.' : 'Booking unlocks after the monthly fee of ₹' + monthlyFeeDue + ' for your selected month is verified.'}</p></div><Link href="/protected/payments" className="primary-button">Open payments</Link></div></section>}
        <div className="student-columns"><section className="student-card"><h2>Upcoming visits</h2>{nextBooking ? <article className="student-record"><div><strong>{prettyDate(nextBooking.booking_date)}</strong><span>{slotById.get(nextBooking.slot_id)?.label ?? 'Study slot'} · Seat {nextBooking.seat_number}</span><small>{prettyTime(nextBooking.entry_time)} – {prettyTime(nextBooking.exit_time, nextBooking.exit_day_offset)}</small></div><Link className="manage-action" href="/protected/bookings">View bookings</Link></article> : <p className="admin-empty">No upcoming visits. Visit Book a seat to reserve one.</p>}</section><section className="student-card"><h2>Recent attendance</h2>{attendance.slice(0, 4).map((record) => <article className="student-record" key={record.id}><div><strong>{prettyDate(record.attended_on)}</strong><span>{slotById.get(bookings.find((booking) => booking.id === record.booking_id)?.slot_id ?? '')?.label ?? 'Library visit'}</span></div><span className={'status-pill ' + (record.status === 'present' ? 'active' : 'inactive')}>{record.status}</span></article>)}{attendance.length === 0 && <p className="admin-empty">Your attendance will appear after your first visit.</p>}</section></div>
      </div>}
      {section === 'book' && <section className="student-card"><div className="student-card-heading"><div><h2>Choose your visit</h2><p>Seats are reserved only when your registration and monthly payments are current.</p></div></div>
        {!hasEligiblePayments && <p className="manage-message student-alert">{!hasRegistrationPayment ? 'Your registration fee of ₹' + registrationFeeDue + ' must be verified.' : !monthlyFeeDue ? 'The library has not set a monthly fee for your account yet.' : 'The monthly fee of ₹' + monthlyFeeDue + ' for ' + prettyDate(firstOfMonth(bookingDate)) + ' must be verified.'} <Link href="/protected/payments">Go to payments →</Link></p>}
        <form className="student-book-form booking-form" onSubmit={book}><label>Visit date<input type="date" min={localDate()} value={bookingDate} onChange={(event) => { setBookingDate(event.target.value); setSeatNumber(null) }} required /></label><label>Time slot<select value={slotId} onChange={(event) => { setSlotId(event.target.value); setSeatNumber(null) }} required><option value="">Select a slot</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label} · {slot.duration_hours} hours · {prettyTime(slot.starts_at)}–{prettyTime(slot.ends_at, slot.ends_at <= slot.starts_at ? 1 : 0)}</option>)}</select></label><div className="seat-picker"><span className="seat-picker-label">Choose an available seat</span>{availabilityLoading && <small>Checking availability…</small>}<div className="seat-map student-seat-map">{seats.map((seat) => { const free = seatIsFree(seat.seat_number); return <button type="button" key={seat.seat_number} disabled={!free} aria-pressed={seatNumber === seat.seat_number} className={'seat ' + (seatNumber === seat.seat_number ? 'chosen' : free ? '' : seat.status === 'available' ? 'booked' : 'maintenance')} onClick={() => setSeatNumber(seat.seat_number)}>{seat.seat_number}</button> })}</div><small>{selectedSlot ? prettyTime(selectedSlot.starts_at) + ' to ' + prettyTime(selectedSlot.ends_at, selectedSlot.ends_at <= selectedSlot.starts_at ? 1 : 0) : 'Select a slot to check availability'} · ₹0 booking charge</small></div><button className="primary-button" type="submit" disabled={saving || availabilityLoading || !selectedSlot || seatNumber === null || !hasEligiblePayments || profile?.status !== 'active'}>{saving ? 'Confirming…' : 'Confirm booking'}</button></form>
      </section>}
      {section === 'bookings' && <section className="student-card"><div className="student-card-heading"><div><h2>Your bookings</h2><p>Cancelled bookings immediately release their seat.</p></div><Link href="/protected/book" className="primary-button">Book a seat</Link></div>{bookings.length ? <div className="student-record-list">{bookings.map((booking) => <article className="student-record" key={booking.id}><div><strong>{prettyDate(booking.booking_date)}</strong><span>{slotById.get(booking.slot_id)?.label ?? 'Slot unavailable'} · Seat {booking.seat_number}</span><small>{prettyTime(booking.entry_time)} – {prettyTime(booking.exit_time, booking.exit_day_offset)}</small><small>Booking: {booking.status}{attendance.find((item) => item.booking_id === booking.id) ? ' · Attendance: ' + attendance.find((item) => item.booking_id === booking.id)?.status : ''}</small></div><div className="record-actions">{booking.booking_date === localDate() && booking.status === 'confirmed' && !attendance.some((item) => item.booking_id === booking.id) && <button type="button" className="manage-action" onClick={() => void markAttendance(booking.id)} disabled={saving}>Mark present</button>}{booking.status === 'confirmed' && booking.booking_date >= localDate() && <button type="button" className="manage-action danger-action" onClick={() => void cancelBooking(booking.id)} disabled={saving}>Cancel visit</button>}</div></article>)}</div> : <p className="admin-empty">No bookings yet.</p>}</section>}

      {section === 'attendance' && <section className="student-card"><h2>Attendance history</h2><p className="muted-copy">You can mark yourself present for a confirmed visit scheduled today. The timestamp is recorded by the library system.</p>{attendance.length ? <div className="student-record-list">{attendance.map((record) => { const booking = bookings.find((item) => item.id === record.booking_id); return <article className="student-record" key={record.id}><div><strong>{prettyDate(record.attended_on)}</strong><span>{booking ? slotById.get(booking.slot_id)?.label + ' · Seat ' + booking.seat_number : 'Library visit'}</span><small>Recorded {new Date(record.checked_in_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></div><span className={'status-pill ' + (record.status === 'present' ? 'active' : 'inactive')}>{record.status}</span></article> })}</div> : <p className="admin-empty">Your attendance records will appear here.</p>}</section>}

      {section === 'payments' && <div className="student-columns"><section className="student-card"><h2>Submit a payment</h2><p className="muted-copy">All payments remain pending until an administrator verifies them. Bookings are free.</p>{selectedPayment && <p className="payment-instructions">This payment is already {selectedPayment.status}. {selectedPayment.status === 'rejected' ? 'You can submit it again.' : 'Wait for the administrator to review it.'}</p>}<form className="auth-form payment-form" onSubmit={submitPayment}><label>Payment type<select value={paymentType} onChange={(event) => setPaymentType(event.target.value as 'registration' | 'monthly')}><option value="registration">One-time registration · {registrationFeeDue === 0 ? 'waived' : '₹' + registrationFeeDue}</option><option value="monthly">Monthly library fee · {monthlyFeeDue ? '₹' + monthlyFeeDue : 'not configured'}</option></select></label>{paymentType === 'monthly' && <label>Billing month<select value={billingMonth} onChange={(event) => setBillingMonth(event.target.value)}>{monthOptions().map((month) => <option key={month} value={month}>{prettyDate(month)}</option>)}</select></label>}<label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'phonepe' | 'cash')}><option value="phonepe">UPI / PhonePe</option><option value="cash">Cash at library</option></select></label>{paymentMethod === 'phonepe' && <><div className="payment-instructions"><strong>PhonePe / UPI payment</strong><p>{settings.phonepe_instructions || 'Pay using the shared library UPI ID, then enter the transaction reference for admin verification.'}</p>{settings.phonepe_upi_id && <p>UPI ID: <strong>{settings.phonepe_upi_id}</strong></p>}{upiPaymentLink && <a className="payment-upi-link" href={upiPaymentLink}>Pay ₹{paymentAmountDue} with a UPI app</a>}</div><label>UPI transaction reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} required maxLength={120} placeholder="Enter the reference shown after payment" /></label></>}{paymentMethod === 'cash' && <p className="payment-instructions">Choose cash when you have paid at the library desk. The administrator will confirm receipt.</p>}{paymentType === 'registration' && registrationFeeDue === 0 && <p className="payment-instructions">Your registration fee has been waived. No registration payment is due.</p>}<p className="payment-amount">Amount due: <strong>{paymentAmountDue == null ? 'Not configured' : '₹' + paymentAmountDue}</strong></p><button type="submit" className="primary-button" disabled={saving || !registration || paymentAmountDue == null || paymentAmountDue <= 0 || paymentAlreadyCurrent}>{saving ? 'Submitting…' : 'Submit for verification'}</button></form></section><section className="student-card"><h2>Payment history</h2>{payments.length ? <div className="student-record-list">{payments.map((payment) => <article className="student-record" key={payment.id}><div><strong>{payment.payment_type === 'registration' ? 'Registration · ₹' + payment.amount : 'Monthly fee · ' + (payment.billing_month ? prettyDate(payment.billing_month) : '') + ' · ₹' + payment.amount}</strong><span>{payment.method === 'phonepe' ? 'UPI / PhonePe' : 'Cash'}{payment.transaction_reference ? ' · Ref ' + payment.transaction_reference : ''}</span>{payment.admin_note && <small>Admin note: {payment.admin_note}</small>}<small>Submitted {prettyDate(payment.submitted_at.slice(0, 10))}</small></div><span className={'status-pill ' + payment.status}>{payment.status}</span></article>)}</div> : <p className="admin-empty">No payments submitted.</p>}</section></div>}
      {section === 'profile' && <section className="student-card"><h2>Student profile</h2><p className="muted-copy">Your offline admission number and login email are fixed by your registration record.</p><form className="auth-form profile-form" onSubmit={saveProfile}><label>Full name<input value={profileDraft.full_name} onChange={(event) => setProfileDraft({ ...profileDraft, full_name: event.target.value })} required maxLength={160} /></label><label>Admission number<input value={registration?.admission_number ?? ''} readOnly /></label><label>Email address<input type="email" value={profile?.email ?? ''} readOnly /></label><label>Phone number<input type="tel" value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} required maxLength={32} /></label><label>Address<textarea rows={4} value={profileDraft.address} onChange={(event) => setProfileDraft({ ...profileDraft, address: event.target.value })} maxLength={500} /></label><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></form></section>}
    </>}
  </div></main>
}

