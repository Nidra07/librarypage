'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Section = 'dashboard' | 'book' | 'bookings' | 'attendance' | 'payments' | 'profile'
type Profile = { id: string; full_name: string; email: string; phone: string | null; address: string; status: 'active' | 'inactive' | 'suspended'; monthly_fee_override: number | null; registration_fee_discount: number; registration_fee_waived: boolean; default_slot_id: string | null }
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
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return value.year + '-' + value.month + '-' + value.day
}
function firstOfMonth(date: string) { return date.slice(0, 7) + '-01' }
function prettyDate(value: string) { return new Date(value + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
function timeMinutes(value: string) { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes }
function exitTimeFor(value: string, duration: number) {
  if (!value) return ''
  const total = timeMinutes(value) + duration * 60
  if (total > 22 * 60) return 'after closing'
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}
function currentIndiaMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Number(value.hour) * 60 + Number(value.minute)
}
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
  const [attendanceMonth, setAttendanceMonth] = useState(localDate().slice(0, 7))
  const [slotId, setSlotId] = useState('')
  const [defaultSlotId, setDefaultSlotId] = useState('')
  const [entryTime, setEntryTime] = useState('')
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
      supabase.from('student_profiles').select('id,full_name,email,phone,address,status,monthly_fee_override,registration_fee_discount,registration_fee_waived,default_slot_id').eq('id', userId).maybeSingle(),
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
    const activeSlotIds = new Set((slotResult.data ?? []).map((slot) => slot.id))
    const registeredSlotId = registrationResult.data?.slot_id
    const storedDefaultSlotId = (profileResult.data as Profile | null)?.default_slot_id
    const preferredSlotId = (storedDefaultSlotId && activeSlotIds.has(storedDefaultSlotId) ? storedDefaultSlotId : null)
      ?? (registeredSlotId && activeSlotIds.has(registeredSlotId) ? registeredSlotId : null)
      ?? slotResult.data?.[0]?.id ?? ''
    if (profileResult.data) {
      const data = profileResult.data as Profile
      setProfileDraft({ full_name: data.full_name, phone: data.phone ?? '', address: data.address ?? '' })
      setDefaultSlotId(preferredSlotId)
    }
    setSlotId((current) => current && activeSlotIds.has(current) ? current : preferredSlotId)
    setEntryTime((current) => current || registrationResult.data?.entry_time?.slice(0, 5) || '08:00')
    setLoading(false)
  }
  useEffect(() => { void load() }, [userId])
  useEffect(() => {
    const slot = slots.find((item) => item.id === slotId)
    if (section !== 'book' || !slotId || !slot || !entryTime) { setSeats([]); setAvailabilityLoading(false); return }
    const startMinutes = timeMinutes(entryTime)
    if (startMinutes < 360 || startMinutes + slot.duration_hours * 60 > 1320) { setSeats([]); setAvailabilityLoading(false); return }
    let current = true
    setAvailabilityLoading(true)
    void supabase.rpc('get_seat_availability', { p_booking_date: bookingDate, p_slot_id: slotId, p_entry_time: entryTime }).then(({ data, error }) => {
      if (!current) return
      if (error) { setMessage(error.message); setSeats([]) }
      else setSeats((data ?? []) as Seat[])
      setAvailabilityLoading(false)
    })
    return () => { current = false }
  }, [bookingDate, slotId, entryTime, section, bookings, slots])

  const slotById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots])
  const paymentById = useMemo(() => new Map<string, Payment[]>([
    ['registration', payments.filter((payment) => payment.payment_type === 'registration')],
    ['monthly', payments.filter((payment) => payment.payment_type === 'monthly')],
  ]), [payments])
  const selectedSlot = slots.find((slot) => slot.id === slotId)
  const bookingExitTime = selectedSlot ? exitTimeFor(entryTime, selectedSlot.duration_hours) : ''
  const bookingTimeValid = Boolean(selectedSlot && entryTime && timeMinutes(entryTime) >= 360 && timeMinutes(entryTime) + selectedSlot.duration_hours * 60 <= 1320)
  const registrationFeeDue = profile?.registration_fee_waived ? 0 : Math.max(0, 100 - (profile?.registration_fee_discount ?? 0))
  const monthlyFeeDue = profile?.monthly_fee_override ?? settings.monthly_fee
  const registeredPayment = paymentById.get('registration')?.find((payment) => payment.status === 'verified' && payment.amount >= registrationFeeDue)
  const monthPayments = payments.filter((payment) => payment.payment_type === 'monthly' && payment.billing_month === firstOfMonth(bookingDate))
  const monthPayment = monthPayments.find((payment) => payment.status === 'verified' && monthlyFeeDue != null && payment.amount >= monthlyFeeDue) ?? monthPayments[0]
  const hasRegistrationPayment = registrationFeeDue === 0 || Boolean(registeredPayment)
  const hasEligiblePayments = hasRegistrationPayment && monthPayment?.status === 'verified' && monthlyFeeDue != null && monthPayment.amount >= monthlyFeeDue
  const presentCount = attendance.filter((item) => item.status === 'present').length
  const attendanceEligibleBookings = bookings.filter((booking) => booking.status !== 'cancelled').length
  const attendancePercent = attendanceEligibleBookings ? Math.round((presentCount / attendanceEligibleBookings) * 100) : 0
  const attendanceByBookingId = new Map(attendance.map((record) => [record.booking_id, record]))
  const monthlyBookings = bookings.filter((booking) => booking.booking_date.slice(0, 7) === attendanceMonth && booking.status !== 'cancelled')
  const monthlyAttendance = attendance.filter((record) => record.attended_on.slice(0, 7) === attendanceMonth)
  const monthlyPresent = monthlyAttendance.filter((record) => record.status === 'present').length
  const monthlyAbsent = monthlyAttendance.filter((record) => record.status === 'absent').length
  const monthlyUnmarked = monthlyBookings.filter((booking) => !attendanceByBookingId.has(booking.id)).length
  const canMarkAttendance = currentIndiaMinutes() >= 360 && currentIndiaMinutes() < 1320
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

  function seatAvailabilityLabel(seat: Seat) {
    if (availabilityLoading) return 'Seat ' + seat.seat_number + ', checking availability'
    if (seat.status !== 'available') return 'Seat ' + seat.seat_number + ', unavailable'
    if (!seat.is_available) return 'Seat ' + seat.seat_number + ', booked for the selected date and time'
    return 'Seat ' + seat.seat_number + ', available'
  }

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!bookingTimeValid) { setMessage('Choose a start time between 6:00 AM and 10:00 PM that fits the full visit.'); return }
    if (seatNumber === null) { setMessage('Select an available seat to continue.'); return }
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('book_seat', { p_booking_date: bookingDate, p_slot_id: slotId, p_seat_number: seatNumber, p_entry_time: entryTime })
    const bookingConflict = Boolean(error && /already booked|seat.*booked|overlap|exclusion|bookings_no_overlapping_seat_reservations/i.test(error.message))
    if (bookingConflict) {
      setSeatNumber(null)
      setMessage('That seat is already booked for this date and time. Choose another available seat or change your slot/time.')
      setAvailabilityLoading(true)
      const { data, error: availabilityError } = await supabase.rpc('get_seat_availability', { p_booking_date: bookingDate, p_slot_id: slotId, p_entry_time: entryTime })
      setSeats(availabilityError ? [] : (data ?? []) as Seat[])
      if (availabilityError) setMessage('That seat is already booked for this date and time. Choose another seat or change your slot/time. Refresh the page if the seat map does not update.')
      setAvailabilityLoading(false)
    } else {
      setMessage(error?.message ?? 'Your seat is confirmed.')
      if (!error) { setSeatNumber(null); await load() }
    }
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
  async function saveDefaultSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!defaultSlotId) { setMessage('Choose a default visit duration.'); return }
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('update_my_default_slot', { p_slot_id: defaultSlotId })
    setMessage(error?.message ?? 'Default visit duration saved.')
    if (!error) { setSlotId(defaultSlotId); await load() }
    setSaving(false)
  }

  return <main className="member-page student-page"><div className="student-wrap">
<header className="student-header">
  <div>
    <span className="eyebrow">Student portal</span>
    <h1>
      {section === 'dashboard'
        ? 'Welcome, ' + (profile?.full_name || 'student')
        : nav.find((item) => item.id === section)?.label}
    </h1>
    <p>
      {registration?.admission_number
        ? 'Admission ' + registration.admission_number
        : 'Your library account'}
    </p>
  </div>

  <Link href="/" className="text-button">
    Back to library {"\u2192"}
  </Link>
</header>
    <nav className="student-nav" aria-label="Student dashboard">{nav.map((item) => <Link key={item.id} href={item.href} className={section === item.id ? 'active' : ''}>{item.label}</Link>)}</nav>
    {message && <p className="manage-message" role="status">{message}</p>}
    {loading ? <section className="student-card"><p className="admin-empty">Loading your library accountâ€¦</p></section> : <>
      {profile?.status !== 'active' && <p className="manage-message student-alert">Your student account is {profile?.status ?? 'unavailable'}. Contact the library administrator for help.</p>}

      {section === 'dashboard' && <div className="student-dashboard">
        <div className="student-summary-grid"><article className="student-card"><small>Membership status</small><strong className={'status-pill ' + (profile?.status === 'active' ? 'active' : 'inactive')}>{profile?.status ?? 'unknown'}</strong><span>Offline admission {registration?.admission_number}</span></article><article className="student-card"><small>Attendance</small><strong>{attendancePercent}%</strong><span>{presentCount} present across {bookings.length} visits</span></article><article className="student-card"><small>Registration fee</small><strong>{registrationFeeDue === 0 ? 'Waived' : ''/20B9'' + registrationFeeDue + ' Â· ' + (registeredPayment ? 'verified' : 'due')}</strong><span>{profile?.registration_fee_discount ? ''/20B9'' + profile.registration_fee_discount + ' rebate applied' : 'Manual admin verification required'}</span></article><article className="student-card"><small>Next visit</small><strong>{nextBooking ? prettyDate(nextBooking.booking_date) : 'No upcoming visit'}</strong><span>{nextBooking ? 'Seat ' + nextBooking.seat_number + ' Â· ' + (slotById.get(nextBooking.slot_id)?.label ?? 'Study slot') : 'Book a seat when your fees are verified'}</span></article></div>
        {!hasEligiblePayments && <section className="student-card"><div className="student-card-heading"><div><h2>Finish payment verification</h2><p>{!hasRegistrationPayment ? 'Your registration fee of '/20B9'' + registrationFeeDue + ' must be verified.' : !monthlyFeeDue ? 'The library has not set a monthly fee for your account yet.' : 'Booking unlocks after the monthly fee of '/20B9'' + monthlyFeeDue + ' for your selected month is verified.'}</p></div><Link href="/protected/payments" className="primary-button">Open payments</Link></div></section>}
        <div className="student-columns"><section className="student-card"><h2>Upcoming visits</h2>{nextBooking ? <article className="student-record"><div><strong>{prettyDate(nextBooking.booking_date)}</strong><span>{slotById.get(nextBooking.slot_id)?.label ?? 'Study slot'} Â· Seat {nextBooking.seat_number}</span><small>{prettyTime(nextBooking.entry_time)} â€“ {prettyTime(nextBooking.exit_time, nextBooking.exit_day_offset)}</small></div><Link className="manage-action" href="/protected/bookings">View bookings</Link></article> : <p className="admin-empty">No upcoming visits. Visit Book a seat to reserve one.</p>}</section><section className="student-card"><h2>Recent attendance</h2>{attendance.slice(0, 4).map((record) => <article className="student-record" key={record.id}><div><strong>{prettyDate(record.attended_on)}</strong><span>{slotById.get(bookings.find((booking) => booking.id === record.booking_id)?.slot_id ?? '')?.label ?? 'Library visit'}</span></div><span className={'status-pill ' + (record.status === 'present' ? 'active' : 'inactive')}>{record.status}</span></article>)}{attendance.length === 0 && <p className="admin-empty">Your attendance will appear after your first visit.</p>}</section></div>
      </div>}
      {section === 'book' && <section className="student-card"><div className="student-card-heading"><div><h2>Choose your visit</h2><p>Choose a duration and your preferred start time. The library is open from 6:00 AM to 10:00 PM.</p></div></div>
        {!hasEligiblePayments && <p className="manage-message student-alert">{!hasRegistrationPayment ? 'Your registration fee of '/20B9'' + registrationFeeDue + ' must be verified.' : !monthlyFeeDue ? 'The library has not set a monthly fee for your account yet.' : 'The monthly fee of '/20B9'' + monthlyFeeDue + ' for ' + prettyDate(firstOfMonth(bookingDate)) + ' must be verified.'} <Link href="/protected/payments">Go to payments â†’</Link></p>}
        <form className="student-book-form booking-form" onSubmit={book}><label>Visit date<input type="date" min={localDate()} value={bookingDate} onChange={(event) => { setBookingDate(event.target.value); setSeatNumber(null) }} required /></label><label>Visit duration<select value={slotId} onChange={(event) => { setSlotId(event.target.value); setSeatNumber(null) }} required><option value="">Select a duration</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label} Â· {slot.duration_hours} hours{slot.id === defaultSlotId ? ' Â· default' : ''}</option>)}</select></label><label>Entry time<input type="time" min="06:00" max="22:00" step="60" value={entryTime} onChange={(event) => { setEntryTime(event.target.value); setSeatNumber(null) }} required /><small>Choose any start time during opening hours.</small></label><div className="seat-picker"><span className="seat-picker-label">Choose an available seat</span>{availabilityLoading && <small>Checking availabilityâ€¦</small>}<div className="seat-map student-seat-map" aria-label="Seat availability">{seats.map((seat) => { const free = seatIsFree(seat.seat_number); const stateClass = availabilityLoading ? 'checking' : free ? '' : seat.status === 'available' ? 'booked' : 'maintenance'; return <button type="button" key={seat.seat_number} disabled={!free} aria-label={seatAvailabilityLabel(seat)} title={seatAvailabilityLabel(seat)} aria-pressed={seatNumber === seat.seat_number} className={'seat ' + (seatNumber === seat.seat_number ? 'chosen' : stateClass)} onClick={() => setSeatNumber(seat.seat_number)}>{seat.seat_number}</button> })}</div><div className="seat-availability-legend" aria-label="Seat status"><span><i className="available" />Available</span><span><i className="booked" />Booked for this date and time</span><span><i className="unavailable" />Unavailable</span></div><small>{selectedSlot && entryTime ? 'Entry ' + prettyTime(entryTime) + ' Â· Exit ' + (bookingExitTime === 'after closing' ? bookingExitTime : prettyTime(bookingExitTime)) + ' Â· ' + selectedSlot.duration_hours + ' hours' : 'Select a duration and start time to check availability'} Â· '/20B9'0 booking charge</small>{selectedSlot && entryTime && !bookingTimeValid && <small className="time-validation">This duration must finish by 10:00 PM. Choose an earlier start time.</small>}</div><button className="primary-button" type="submit" disabled={saving || availabilityLoading || !selectedSlot || !bookingTimeValid || seatNumber === null || !hasEligiblePayments || profile?.status !== 'active'}>{saving ? 'Confirmingâ€¦' : 'Confirm booking'}</button></form>
      </section>}
      {section === 'bookings' && <section className="student-card"><div className="student-card-heading"><div><h2>Your bookings</h2><p>Cancelled bookings immediately release their seat.</p></div><Link href="/protected/book" className="primary-button">Book a seat</Link></div>{bookings.length ? <div className="student-record-list">{bookings.map((booking) => <article className="student-record" key={booking.id}><div><strong>{prettyDate(booking.booking_date)}</strong><span>{slotById.get(booking.slot_id)?.label ?? 'Slot unavailable'} Â· Seat {booking.seat_number}</span><small>{prettyTime(booking.entry_time)} â€“ {prettyTime(booking.exit_time, booking.exit_day_offset)}</small><small>Booking: {booking.status}{attendance.find((item) => item.booking_id === booking.id) ? ' Â· Attendance: ' + attendance.find((item) => item.booking_id === booking.id)?.status : ''}</small></div><div className="record-actions">{booking.booking_date === localDate() && booking.status === 'confirmed' && canMarkAttendance && !attendance.some((item) => item.booking_id === booking.id) && <button type="button" className="manage-action" onClick={() => void markAttendance(booking.id)} disabled={saving}>Mark present</button>}{booking.status === 'confirmed' && booking.booking_date >= localDate() && <button type="button" className="manage-action danger-action" onClick={() => void cancelBooking(booking.id)} disabled={saving}>Cancel visit</button>}</div></article>)}</div> : <p className="admin-empty">No bookings yet.</p>}</section>}

      {section === 'attendance' && <section className="student-card"><div className="student-card-heading"><div><h2>Monthly attendance tracker</h2><p>Mark yourself present for todayâ€™s confirmed visit before the library closes at 10:00 PM.</p></div><label className="attendance-month-label">Month<input type="month" value={attendanceMonth} onChange={(event) => setAttendanceMonth(event.target.value)} /></label></div><div className="student-summary-grid attendance-summary-grid"><article className="student-card"><small>Present</small><strong>{monthlyPresent}</strong><span>Visits attended</span></article><article className="student-card"><small>Absent</small><strong>{monthlyAbsent}</strong><span>Missed visits</span></article><article className="student-card"><small>Not yet marked</small><strong>{monthlyUnmarked}</strong><span>Upcoming or still open</span></article><article className="student-card"><small>Visits</small><strong>{monthlyBookings.length}</strong><span>Scheduled this month</span></article></div><div className="student-record-list">{monthlyBookings.map((booking) => { const record = attendanceByBookingId.get(booking.id); const canMark = booking.booking_date === localDate() && booking.status === 'confirmed' && !record && canMarkAttendance; return <article className="student-record" key={booking.id}><div><strong>{prettyDate(booking.booking_date)}</strong><span>{slotById.get(booking.slot_id)?.label ?? 'Visit'} Â· Seat {booking.seat_number}</span><small>{prettyTime(booking.entry_time)} â€“ {prettyTime(booking.exit_time, booking.exit_day_offset)}</small></div>{canMark ? <button type="button" className="manage-action" onClick={() => void markAttendance(booking.id)} disabled={saving}>Mark present</button> : <span className={'status-pill ' + (record?.status === 'present' ? 'active' : record?.status === 'absent' ? 'inactive' : 'pending')}>{record?.status ?? (booking.booking_date > localDate() ? 'upcoming' : 'awaiting')}</span>}</article>})}{monthlyBookings.length === 0 && <p className="admin-empty">No visits booked for this month.</p>}</div><p className="muted-copy">Any confirmed visit without a check-in is automatically marked absent after 10:00 PM India time.</p></section>}
      {section === 'payments' && <div className="student-columns"><section className="student-card"><h2>Submit a payment</h2><p className="muted-copy">All payments remain pending until an administrator verifies them. Bookings are free.</p>{selectedPayment && <p className="payment-instructions">This payment is already {selectedPayment.status}. {selectedPayment.status === 'rejected' ? 'You can submit it again.' : 'Wait for the administrator to review it.'}</p>}<form className="auth-form payment-form" onSubmit={submitPayment}><label>Payment type<select value={paymentType} onChange={(event) => setPaymentType(event.target.value as 'registration' | 'monthly')}><option value="registration">One-time registration Â· {registrationFeeDue === 0 ? 'waived' : ''/20B9'' + registrationFeeDue}</option><option value="monthly">Monthly library fee Â· {monthlyFeeDue ? ''/20B9'' + monthlyFeeDue : 'not configured'}</option></select></label>{paymentType === 'monthly' && <label>Billing month<select value={billingMonth} onChange={(event) => setBillingMonth(event.target.value)}>{monthOptions().map((month) => <option key={month} value={month}>{prettyDate(month)}</option>)}</select></label>}<label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'phonepe' | 'cash')}><option value="phonepe">UPI / PhonePe</option><option value="cash">Cash at library</option></select></label>{paymentMethod === 'phonepe' && <><div className="payment-instructions"><strong>PhonePe / UPI payment</strong><p>{settings.phonepe_instructions || 'Pay using the shared library UPI ID, then enter the transaction reference for admin verification.'}</p>{settings.phonepe_upi_id && <p>UPI ID: <strong>{settings.phonepe_upi_id}</strong></p>}{upiPaymentLink && <a className="payment-upi-link" href={upiPaymentLink}>Pay '/20B9'{paymentAmountDue} with a UPI app</a>}</div><label>UPI transaction reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} required maxLength={120} placeholder="Enter the reference shown after payment" /></label></>}{paymentMethod === 'cash' && <p className="payment-instructions">Choose cash when you have paid at the library desk. The administrator will confirm receipt.</p>}{paymentType === 'registration' && registrationFeeDue === 0 && <p className="payment-instructions">Your registration fee has been waived. No registration payment is due.</p>}<p className="payment-amount">Amount due: <strong>{paymentAmountDue == null ? 'Not configured' : ''/20B9'' + paymentAmountDue}</strong></p><button type="submit" className="primary-button" disabled={saving || !registration || paymentAmountDue == null || paymentAmountDue <= 0 || paymentAlreadyCurrent}>{saving ? 'Submittingâ€¦' : 'Submit for verification'}</button></form></section><section className="student-card"><h2>Payment history</h2>{payments.length ? <div className="student-record-list">{payments.map((payment) => <article className="student-record" key={payment.id}><div><strong>{payment.payment_type === 'registration' ? 'Registration Â· '/20B9'' + payment.amount : 'Monthly fee Â· ' + (payment.billing_month ? prettyDate(payment.billing_month) : '') + ' Â· '/20B9'' + payment.amount}</strong><span>{payment.method === 'phonepe' ? 'UPI / PhonePe' : 'Cash'}{payment.transaction_reference ? ' Â· Ref ' + payment.transaction_reference : ''}</span>{payment.admin_note && <small>Admin note: {payment.admin_note}</small>}<small>Submitted {prettyDate(payment.submitted_at.slice(0, 10))}</small></div><span className={'status-pill ' + payment.status}>{payment.status}</span></article>)}</div> : <p className="admin-empty">No payments submitted.</p>}</section></div>}
      {section === 'profile' && <><section className="student-card"><h2>Student profile</h2><p className="muted-copy">Your offline admission number and login email are fixed by your registration record.</p><form className="auth-form profile-form" onSubmit={saveProfile}><label>Full name<input value={profileDraft.full_name} onChange={(event) => setProfileDraft({ ...profileDraft, full_name: event.target.value })} required maxLength={160} /></label><label>Admission number<input value={registration?.admission_number ?? ''} readOnly /></label><label>Email address<input type="email" value={profile?.email ?? ''} readOnly /></label><label>Phone number<input type="tel" value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} required maxLength={32} /></label><label>Address<textarea rows={4} value={profileDraft.address} onChange={(event) => setProfileDraft({ ...profileDraft, address: event.target.value })} maxLength={500} /></label><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Savingâ€¦' : 'Save profile'}</button></form></section><section className="student-card"><h2>Default visit duration</h2><p className="muted-copy">This duration is preselected when you book. You can still choose a different duration or entry time for each visit.</p><form className="auth-form settings-form" onSubmit={saveDefaultSlot}><label>Default duration<select value={defaultSlotId} onChange={(event) => setDefaultSlotId(event.target.value)} required><option value="">Choose a duration</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label} Â· {slot.duration_hours} hours</option>)}</select></label><button className="primary-button" type="submit" disabled={saving || !defaultSlotId}>{saving ? 'Savingâ€¦' : 'Save default duration'}</button></form></section></>}
    </>}
  </div></main>
}

