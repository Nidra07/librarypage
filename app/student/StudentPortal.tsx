'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { STUDENT_APP_APK_URL } from '@/lib/student-app'

type Section = 'dashboard' | 'book' | 'bookings' | 'attendance' | 'payments' | 'profile'
type Profile = { id: string; full_name: string; email: string; phone: string | null; address: string; status: 'active' | 'inactive' | 'suspended'; monthly_fee_override: number | null; registration_fee_discount: number; registration_fee_waived: boolean; default_slot_id: string | null }
type Registration = { admission_number: string; full_name: string; phone: string; email: string; address: string; slot_id: string; entry_time: string; exit_time: string; exit_day_offset: number; seat_number: string | null; created_at: string }
type SeatAssignment = { seat_number: number }
type Slot = { id: string; label: string; duration_hours: number; starts_at: string; ends_at: string; active: boolean }
type Seat = { seat_number: number; label: string; status: 'available' | 'maintenance' | 'disabled'; is_available: boolean }
type Booking = { id: string; slot_id: string; booking_date: string; seat_number: number; entry_time: string; exit_time: string; exit_day_offset: number; status: 'confirmed' | 'cancelled' | 'completed' }
type Attendance = { id: string; booking_id: string; attended_on: string; checked_in_at: string; status: 'present' | 'absent' | 'late' }
type Payment = { id: string; payment_type: 'registration' | 'monthly'; billing_month: string | null; seat_number: number | null; amount: number; method: 'phonepe' | 'cash'; transaction_reference: string | null; status: 'pending' | 'verified' | 'rejected' | 'refunded'; admin_note: string | null; submitted_at: string }
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
function indiaRegistrationDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return fields.year + '-' + fields.month + '-' + fields.day
}
function billingCycleStart(registrationDate: string, billingMonth: string) {
  const [year, month] = billingMonth.slice(0, 7).split('-').map(Number)
  const day = Number(registrationDate.slice(8, 10))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return year + '-' + String(month).padStart(2, '0') + '-' + String(Math.min(day, lastDay)).padStart(2, '0')
}
function billingMonthForDate(registrationDate: string | null, value: string) {
  if (!registrationDate || value < registrationDate) return null
  const candidateMonth = firstOfMonth(value)
  return value < billingCycleStart(registrationDate, candidateMonth) ? shiftMonth(candidateMonth, -1) : candidateMonth
}
function prettyDate(value: string) { return new Date(value + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
function prettyMonth(value: string) { return new Date(value + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) }
function shiftMonth(value: string, amount: number) {
  const date = new Date(value + 'T00:00:00Z')
  date.setUTCMonth(date.getUTCMonth() + amount)
  return date.toISOString().slice(0, 10)
}
function monthsBetween(start: string, end: string) {
  const months: string[] = []
  for (let month = start; month <= end; month = shiftMonth(month, 1)) months.push(month)
  return months
}
function daysUntil(date: string) {
  return Math.max(0, Math.ceil((Date.parse(date + 'T00:00:00Z') - Date.parse(localDate() + 'T00:00:00Z')) / 86400000))
}
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
  const [seatAssignment, setSeatAssignment] = useState<SeatAssignment | null>(null)
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
    const [profileResult, registrationResult, seatAssignmentResult, slotResult, bookingResult, attendanceResult, paymentResult, settingsResult] = await Promise.all([
      supabase.from('student_profiles').select('id,full_name,email,phone,address,status,monthly_fee_override,registration_fee_discount,registration_fee_waived,default_slot_id').eq('id', userId).maybeSingle(),
      supabase.from('student_registrations').select('admission_number,full_name,phone,email,address,slot_id,entry_time,exit_time,exit_day_offset,seat_number,created_at').eq('student_id', userId).maybeSingle(),
      supabase.from('student_seat_assignments').select('seat_number').eq('student_id', userId).maybeSingle(),
      supabase.from('study_slots').select('id,label,duration_hours,starts_at,ends_at,active').eq('active', true).order('starts_at'),
      supabase.from('bookings').select('id,slot_id,booking_date,seat_number,entry_time,exit_time,exit_day_offset,status').eq('student_id', userId).order('booking_date', { ascending: false }),
      supabase.from('attendance').select('id,booking_id,attended_on,checked_in_at,status').eq('student_id', userId).order('attended_on', { ascending: false }),
      supabase.from('payments').select('id,payment_type,billing_month,seat_number,amount,method,transaction_reference,status,admin_note,submitted_at').eq('student_id', userId).order('submitted_at', { ascending: false }),
      supabase.from('library_settings').select('monthly_fee,phonepe_upi_id,phonepe_instructions').eq('singleton', true).maybeSingle(),
    ])
    const error = profileResult.error ?? registrationResult.error ?? seatAssignmentResult.error ?? slotResult.error ?? bookingResult.error ?? attendanceResult.error ?? paymentResult.error ?? settingsResult.error
    setMessage(error?.message ?? '')
    setProfile(profileResult.data as Profile | null)
    setRegistration(registrationResult.data as Registration | null)
    const registeredAt = (registrationResult.data as Registration | null)?.created_at
    const registeredDate = registeredAt ? indiaRegistrationDate(registeredAt) : null
    setBillingMonth(registeredDate ? (billingMonthForDate(registeredDate, localDate()) ?? firstOfMonth(localDate())) : firstOfMonth(localDate()))
    setSeatAssignment(seatAssignmentResult.data as SeatAssignment | null)
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
    const monthFee = profile?.monthly_fee_override ?? settings.monthly_fee
    const hasCurrentMonthPayment = payments.some((payment) => payment.payment_type === 'monthly'
      && payment.billing_month === billingMonth && payment.status === 'verified'
      && monthFee != null && payment.amount >= monthFee)
    const chooseWhilePaying = section === 'payments' && paymentType === 'monthly'
      && profile?.status === 'active' && !seatAssignment
    const chooseToResume = section === 'book' && profile?.status === 'active'
      && !seatAssignment && hasCurrentMonthPayment
    if (!chooseWhilePaying && !chooseToResume) { setSeats([]); setAvailabilityLoading(false); return }
    let current = true
    setAvailabilityLoading(true)
    const availabilityMonth = billingMonth
    void supabase.rpc('get_monthly_seat_availability', { p_billing_month: availabilityMonth }).then(({ data, error }) => {
      if (!current) return
      if (error) { setMessage(error.message); setSeats([]) }
      else setSeats((data ?? []) as Seat[])
      setAvailabilityLoading(false)
    })
    return () => { current = false }
  }, [billingMonth, paymentType, payments, profile?.monthly_fee_override, profile?.status, seatAssignment, section, settings.monthly_fee])

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
  const currentMonth = firstOfMonth(localDate())
  const registrationDate = registration?.created_at ? indiaRegistrationDate(registration.created_at) : null
  const currentBillingMonth = billingMonthForDate(registrationDate, localDate())
  const currentMonthPayment = payments.find((payment) => payment.payment_type === 'monthly' && payment.billing_month === currentBillingMonth
    && payment.status === 'verified' && monthlyFeeDue != null && payment.amount >= monthlyFeeDue)
  const currentMonthPaid = Boolean(currentMonthPayment)
  const monthPayments = payments.filter((payment) => payment.payment_type === 'monthly' && payment.billing_month === billingMonthForDate(registrationDate, bookingDate))
  const monthPayment = monthPayments.find((payment) => payment.status === 'verified' && monthlyFeeDue != null && payment.amount >= monthlyFeeDue) ?? monthPayments[0]
  const hasRegistrationPayment = registrationFeeDue === 0 || Boolean(registeredPayment)
  const bookingMonthPaid = Boolean(monthPayment?.status === 'verified' && monthlyFeeDue != null && monthPayment.amount >= monthlyFeeDue)
  const monthlyBookingSeat = seatAssignment?.seat_number ?? null
  const hasEligiblePayments = hasRegistrationPayment && bookingMonthPaid && monthlyBookingSeat !== null
  const attendanceByBookingId = new Map(attendance.map((record) => [record.booking_id, record]))
  const monthlyBookings = bookings.filter((booking) => booking.booking_date.slice(0, 7) === attendanceMonth && booking.status !== 'cancelled')
  const monthlyAttendance = attendance.filter((record) => record.attended_on.slice(0, 7) === attendanceMonth)
  const monthlyPresent = new Set(monthlyAttendance.filter((record) => record.status === 'present').map((record) => record.attended_on)).size
  const monthlyPresentDates = new Set(monthlyAttendance.filter((record) => record.status === 'present').map((record) => record.attended_on))
  const monthlyAbsent = new Set(monthlyAttendance.filter((record) => record.status === 'absent' && !monthlyPresentDates.has(record.attended_on)).map((record) => record.attended_on)).size
  const registrationMonth = registrationDate ? firstOfMonth(registrationDate) : currentMonth
  const verifiedMonthlyPayments = payments.filter((payment) => payment.payment_type === 'monthly'
    && payment.status === 'verified' && monthlyFeeDue != null && payment.amount >= monthlyFeeDue && payment.billing_month)
  const paidMonths = new Set(verifiedMonthlyPayments.map((payment) => payment.billing_month as string))
  const pendingFeeMonths = registration && currentBillingMonth && monthlyFeeDue != null
    ? monthsBetween(registrationMonth, currentBillingMonth).filter((month) => !paidMonths.has(month))
    : []
  const nextFeeMonth = monthlyFeeDue == null || !registrationDate ? undefined : pendingFeeMonths[0] ?? shiftMonth(currentBillingMonth ?? currentMonth, 1)
  const daysToNextFee = nextFeeMonth ? (pendingFeeMonths.length ? 0 : daysUntil(billingCycleStart(registrationDate as string, nextFeeMonth))) : null
  const nextFeeIsOverdue = Boolean(pendingFeeMonths.length && registrationDate && billingCycleStart(registrationDate, pendingFeeMonths[0]) < localDate())
  const monthlyPresentDays = new Set(attendance.filter((record) => record.status === 'present' && record.attended_on.slice(0, 7) === currentMonth.slice(0, 7)).map((record) => record.attended_on)).size
  const monthlyUnmarked = monthlyBookings.filter((booking) => !attendanceByBookingId.has(booking.id)).length
  const canMarkAttendance = currentIndiaMinutes() >= 360 && currentIndiaMinutes() < 1320
  const nextBooking = [...bookings].filter((booking) => booking.status === 'confirmed' && booking.booking_date >= localDate()).sort((a, b) => a.booking_date.localeCompare(b.booking_date))[0]
  const todayBooking = bookings.find((booking) => booking.booking_date === localDate() && booking.status === 'confirmed')
  const todayAttendance = todayBooking ? attendanceByBookingId.get(todayBooking.id) : undefined
  const paymentAmountDue = paymentType === 'registration' ? registrationFeeDue : monthlyFeeDue
  const matchingPayments = payments.filter((payment) => payment.payment_type === paymentType &&
    (paymentType === 'registration' || payment.billing_month === (currentBillingMonth ?? billingMonth)))
  const selectedPayment = matchingPayments.find((payment) => payment.status === 'pending') ??
    matchingPayments.find((payment) => payment.status === 'verified' && paymentAmountDue != null && payment.amount >= paymentAmountDue) ?? matchingPayments[0]
  const paymentAlreadyCurrent = Boolean(selectedPayment && (selectedPayment.status === 'pending' || (selectedPayment.status === 'verified' && paymentAmountDue != null && selectedPayment.amount >= paymentAmountDue)))
  const paymentSeatNumber = seatAssignment?.seat_number ?? selectedPayment?.seat_number ?? seatNumber
  const upiPaymentLink = settings.phonepe_upi_id && paymentAmountDue != null && paymentAmountDue > 0
    ? 'upi://pay?pa=' + encodeURIComponent(settings.phonepe_upi_id) + '&pn=' + encodeURIComponent('The Peaceful Pages') + '&am=' + encodeURIComponent(String(paymentAmountDue)) + '&cu=INR&tn=' + encodeURIComponent(paymentType === 'registration' ? 'Library registration fee' : 'Library fee ' + (currentBillingMonth ?? billingMonth).slice(0, 7))
    : ''

  function seatIsFree(number: number) {
    const seat = seats.find((item) => item.seat_number === number)
    return !availabilityLoading && seat?.status === 'available' && seat.is_available
  }

  function seatAvailabilityLabel(seat: Seat) {
    if (availabilityLoading) return 'Seat ' + seat.seat_number + ', checking availability'
    if (seat.status !== 'available') return 'Seat ' + seat.seat_number + ', unavailable'
    if (!seat.is_available) return 'Seat ' + seat.seat_number + ', allocated to an active student or held while a payment is reviewed'
    return 'Seat ' + seat.seat_number + ', available'
  }

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!bookingTimeValid) { setMessage('Choose a start time between 6:00 AM and 10:00 PM that fits the full visit.'); return }
    if (monthlyBookingSeat === null) { setMessage(currentMonthPaid ? 'Choose a vacant seat below to resume booking.' : 'Submit the current monthly payment and wait for confirmation to receive a seat before booking.'); return }
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('book_seat', { p_booking_date: bookingDate, p_slot_id: slotId, p_seat_number: monthlyBookingSeat, p_entry_time: entryTime })
    const bookingConflict = Boolean(error && /already booked|seat.*booked|overlap|exclusion|bookings_no_overlapping_seat_reservations/i.test(error.message))
    if (bookingConflict) {
      setMessage('Your monthly seat is already booked during that time. Choose a different visit date, duration, or entry time.')
    } else {
      setMessage(error?.message ?? 'Your seat is confirmed.')
      if (!error) await load()
    }
    setSaving(false)
  }
  async function cancelBooking(id: string) {
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('cancel_my_booking', { p_booking_id: id })
    setMessage(error?.message ?? 'Visit cancelled; your assigned seat remains yours while your account is active.')
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
  async function claimSeat() {
    if (seatNumber === null) { setMessage('Choose a vacant seat first.'); return }
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('claim_student_seat', { p_seat_number: seatNumber })
    setMessage(error?.message ?? 'Seat ' + seatNumber + ' is now allocated to you.')
    if (!error) { setSeatNumber(null); await load() }
    setSaving(false)
  }
  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const monthlyPaymentSeat = seatAssignment?.seat_number ?? seatNumber
    if (paymentType === 'monthly' && monthlyPaymentSeat === null) { setMessage('Choose a vacant seat before submitting the monthly payment.'); return }
    setSaving(true); setMessage('')
    const { error } = await supabase.rpc('submit_payment', {
      p_payment_type: paymentType,
      p_billing_month: paymentType === 'monthly' ? (currentBillingMonth ?? billingMonth) : null,
      p_method: paymentMethod,
      p_transaction_reference: paymentMethod === 'phonepe' ? paymentReference.trim() : null,
      p_seat_number: paymentType === 'monthly' ? monthlyPaymentSeat : null,
    })
    setMessage(error?.message ?? 'Payment submitted. Your seat stays allocated while your account is active.')
    if (!error) { setPaymentReference(''); setSeatNumber(null); await load() }
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

  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
    <a href={STUDENT_APP_APK_URL} className="primary-button" download>
      Download Android app
    </a>
    <Link href="/" className="text-button">
      Back to library {"\u2192"}
    </Link>
  </div>
</header>
    <nav className="student-nav" aria-label="Student dashboard">{nav.map((item) => <Link key={item.id} href={item.href} className={section === item.id ? 'active' : ''}>{item.label}</Link>)}</nav>
    {message && <p className="manage-message" role="status">{message}</p>}
    {loading ? <section className="student-card"><p className="admin-empty">Loading your library account…</p></section> : <>
      {profile?.status !== 'active' && <p className="manage-message student-alert">Your student account is {profile?.status ?? 'unavailable'}. Contact the library administrator for help.</p>}

      {section === 'dashboard' && <div className="student-dashboard">
        <div className="student-summary-grid">
          <article className="student-card"><small>Membership status</small><strong className={"status-pill " + (profile?.status === "active" ? "active" : "inactive")}>{profile?.status ?? "unknown"}</strong><span>Offline admission {registration?.admission_number}</span></article>
          <article className="student-card"><small>Attendance this month</small><strong>{monthlyPresentDays} days</strong><span>Days attended in {prettyMonth(currentMonth)}</span></article>
          <article className="student-card"><small>Registration fee</small><strong>{registrationFeeDue === 0 ? "Waived" : "INR " + registrationFeeDue + " - " + (registeredPayment ? "verified" : "due")}</strong><span>{profile?.registration_fee_discount ? "INR " + profile.registration_fee_discount + " rebate applied" : "Manual admin verification required"}</span></article>
          <article className="student-card"><small>Monthly fee</small><strong>{monthlyFeeDue == null ? "Not set" : "INR " + monthlyFeeDue}</strong><span>{monthlyBookingSeat == null ? "No seat assigned" : "Seat " + monthlyBookingSeat + " stays assigned while you are active"}</span></article>
          <article className="student-card"><small>Next fee due</small><strong>{daysToNextFee == null ? "Not set" : pendingFeeMonths.length ? (nextFeeIsOverdue ? "Overdue" : "Due today") : daysToNextFee === 0 ? "Due today" : daysToNextFee + (daysToNextFee === 1 ? " day" : " days")}</strong><span>{nextFeeMonth && registrationDate ? "Next fee due " + prettyDate(billingCycleStart(registrationDate, nextFeeMonth)) : "Set your monthly fee to show the due date"}</span></article>
        </div>
        <section className="student-card"><div className="student-card-heading"><div><h2>Mark present</h2><p>{todayBooking ? todayAttendance?.status === 'present' ? 'Your visit is marked present.' : canMarkAttendance ? 'Check in for today’s confirmed visit.' : 'Check-in is available from 6:00 AM to 10:00 PM India time.' : 'Book a visit for today to check in.'}</p></div>{todayBooking ? todayAttendance?.status === 'present' ? <span className="status-pill active">Present</span> : <button type="button" className="primary-button" onClick={() => void markAttendance(todayBooking.id)} disabled={!canMarkAttendance || saving || profile?.status !== 'active'}>Mark present</button> : <Link href="/protected/book" className="primary-button">Book a visit</Link>}</div></section>
        {!hasEligiblePayments && <section className="student-card"><div className="student-card-heading"><div><h2>Booking access</h2><p>{!hasRegistrationPayment ? "Your registration fee of INR " + registrationFeeDue + " must be verified." : !monthlyFeeDue ? "The library has not set a monthly fee for your account yet." : !currentMonthPaid ? "Booking unlocks after this month's fee of INR " + monthlyFeeDue + " is verified." : monthlyBookingSeat == null ? "Your monthly fee is verified. Choose a vacant seat to resume booking." : "Your account is ready to book."}</p></div><Link href={currentMonthPaid && monthlyBookingSeat == null ? "/protected/book" : "/protected/payments"} className="primary-button">{currentMonthPaid && monthlyBookingSeat == null ? "Choose a seat" : "Open payments"}</Link></div></section>}
        <div className="student-columns">
          <section className="student-card"><h2>Upcoming visits</h2>{nextBooking ? <article className="student-record"><div><strong>{prettyDate(nextBooking.booking_date)}</strong><span>{slotById.get(nextBooking.slot_id)?.label ?? "Study slot"} - Seat {nextBooking.seat_number}</span><small>{prettyTime(nextBooking.entry_time)} to {prettyTime(nextBooking.exit_time, nextBooking.exit_day_offset)}</small></div><Link className="manage-action" href="/protected/bookings">View bookings</Link></article> : <p className="admin-empty">No upcoming visits. Visit Book a seat to reserve one.</p>}</section>
          <section className="student-card"><h2>Recent attendance</h2>{attendance.slice(0, 4).map((record) => <article className="student-record" key={record.id}><div><strong>{prettyDate(record.attended_on)}</strong><span>{slotById.get(bookings.find((booking) => booking.id === record.booking_id)?.slot_id ?? "")?.label ?? "Library visit"}</span></div><span className={"status-pill " + (record.status === "present" ? "active" : "inactive")}>{record.status}</span></article>)}{attendance.length === 0 && <p className="admin-empty">Your attendance will appear after your first visit.</p>}</section>
          <section className="student-card"><h2>Pending monthly fees</h2>{monthlyFeeDue == null ? <p className="admin-empty">Your monthly fee has not been set yet.</p> : pendingFeeMonths.length ? <div className="student-fee-month-list">{pendingFeeMonths.map((month) => <article className="student-record" key={month}><strong>{prettyMonth(month)}</strong><span>{payments.some((payment) => payment.payment_type === "monthly" && payment.billing_month === month && payment.status === "pending") ? "Awaiting confirmation" : "Pending"}</span></article>)}</div> : <p className="admin-empty">No monthly fees are pending.</p>}</section>
        </div>
      </div>}
      {section === "book" && <section className="student-card"><div className="student-card-heading"><div><h2>Choose your visit</h2><p>Choose a duration and your preferred start time. The library is open from 6:00 AM to 10:00 PM.</p></div></div>
        {!hasEligiblePayments && <p className="manage-message student-alert">{!hasRegistrationPayment ? "Your registration fee of INR " + registrationFeeDue + " must be verified." : !monthlyFeeDue ? "The library has not set a monthly fee for your account yet." : !bookingMonthPaid ? "The monthly fee for " + prettyMonth(firstOfMonth(bookingDate)) + " must be verified." : monthlyBookingSeat == null ? "This month's fee is verified. Choose a vacant seat below to resume booking." : "Your assigned seat is ready; verify the fee for the selected month."} {!bookingMonthPaid && <Link href="/protected/payments">Go to payments</Link>}</p>}
        {profile?.status === "active" && currentMonthPaid && monthlyBookingSeat == null && <div className="seat-picker"><span className="seat-picker-label">Choose a vacant seat to resume</span>{availabilityLoading && <small>Checking available seats...</small>}<div className="seat-map student-seat-map" aria-label="Available seats">{seats.map((seat) => { const free = seatIsFree(seat.seat_number); const stateClass = availabilityLoading ? "checking" : free ? "" : seat.status === "available" ? "booked" : "maintenance"; return <button type="button" key={seat.seat_number} disabled={!free || saving} aria-label={seatAvailabilityLabel(seat)} title={seatAvailabilityLabel(seat)} aria-pressed={seatNumber === seat.seat_number} className={"seat " + (seatNumber === seat.seat_number ? "chosen" : stateClass)} onClick={() => setSeatNumber(seat.seat_number)}>{seat.seat_number}</button> })}</div><button className="manage-action" type="button" onClick={() => void claimSeat()} disabled={saving || availabilityLoading || seatNumber == null}>{saving ? "Saving..." : "Assign this seat"}</button></div>}
        <form className="student-book-form booking-form" onSubmit={book}><label>Visit date<input type="date" min={localDate()} value={bookingDate} onChange={(event) => setBookingDate(event.target.value)} required /></label><label>Visit duration<select value={slotId} onChange={(event) => setSlotId(event.target.value)} required><option value="">Select a duration</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label} - {slot.duration_hours} hours{slot.id === defaultSlotId ? " - default" : ""}</option>)}</select></label><label>Entry time<input type="time" min="06:00" max="22:00" step="60" value={entryTime} onChange={(event) => setEntryTime(event.target.value)} required /><small>Choose any start time during opening hours.</small></label><div className="student-booking-seat"><strong>Your assigned seat</strong><p>{monthlyBookingSeat !== null ? "Seat " + monthlyBookingSeat + " remains allocated while your account is active. The fee for the selected month must also be verified." : currentMonthPaid ? "Choose a vacant seat above to resume booking." : "Choose a vacant seat when submitting your monthly payment. Booking opens after admin confirmation."}</p></div><small>{selectedSlot && entryTime ? "Entry " + prettyTime(entryTime) + " - Exit " + (bookingExitTime === "after closing" ? bookingExitTime : prettyTime(bookingExitTime)) + " - " + selectedSlot.duration_hours + " hours" : "Select a duration and start time"} - booking fee INR 0</small>{selectedSlot && entryTime && !bookingTimeValid && <small className="time-validation">This duration must finish by 10:00 PM. Choose an earlier start time.</small>}<button className="primary-button" type="submit" disabled={saving || availabilityLoading || !selectedSlot || !bookingTimeValid || monthlyBookingSeat === null || !hasEligiblePayments || profile?.status !== "active"}>{saving ? "Confirming..." : "Confirm booking"}</button></form>
      </section>}
      {section === 'bookings' && <section className="student-card"><div className="student-card-heading"><div><h2>Your bookings</h2><p>Canceling a visit releases that time only; your assigned seat stays yours while you are active.</p></div><Link href="/protected/book" className="primary-button">Book a seat</Link></div>{bookings.length ? <div className="student-record-list">{bookings.map((booking) => <article className="student-record" key={booking.id}><div><strong>{prettyDate(booking.booking_date)}</strong><span>{slotById.get(booking.slot_id)?.label ?? 'Slot unavailable'} · Seat {booking.seat_number}</span><small>{prettyTime(booking.entry_time)} – {prettyTime(booking.exit_time, booking.exit_day_offset)}</small><small>Booking: {booking.status}{attendance.find((item) => item.booking_id === booking.id) ? ' · Attendance: ' + attendance.find((item) => item.booking_id === booking.id)?.status : ''}</small></div><div className="record-actions">{booking.booking_date === localDate() && booking.status === 'confirmed' && canMarkAttendance && !attendance.some((item) => item.booking_id === booking.id) && <button type="button" className="manage-action" onClick={() => void markAttendance(booking.id)} disabled={saving}>Mark present</button>}{booking.status === 'confirmed' && booking.booking_date >= localDate() && <button type="button" className="manage-action danger-action" onClick={() => void cancelBooking(booking.id)} disabled={saving}>Cancel visit</button>}</div></article>)}</div> : <p className="admin-empty">No bookings yet.</p>}</section>}

      {section === "attendance" && <section className="student-card"><div className="student-card-heading"><div><h2>Monthly attendance tracker</h2><p>Attendance totals show days attended. Mark yourself present for today's confirmed visit before the library closes at 10:00 PM.</p></div><label className="attendance-month-label">Month<input type="month" value={attendanceMonth} onChange={(event) => setAttendanceMonth(event.target.value)} /></label></div><div className="student-summary-grid attendance-summary-grid"><article className="student-card"><small>Present days</small><strong>{monthlyPresent}</strong><span>Days attended</span></article><article className="student-card"><small>Absent days</small><strong>{monthlyAbsent}</strong><span>Days missed</span></article><article className="student-card"><small>Not yet marked</small><strong>{monthlyUnmarked}</strong><span>Visits upcoming or still open</span></article><article className="student-card"><small>Visits</small><strong>{monthlyBookings.length}</strong><span>Scheduled this month</span></article></div><div className="student-record-list">{monthlyBookings.map((booking) => { const record = attendanceByBookingId.get(booking.id); const canMark = booking.booking_date === localDate() && booking.status === "confirmed" && !record && canMarkAttendance; return <article className="student-record" key={booking.id}><div><strong>{prettyDate(booking.booking_date)}</strong><span>{slotById.get(booking.slot_id)?.label ?? "Visit"} - Seat {booking.seat_number}</span><small>{prettyTime(booking.entry_time)} to {prettyTime(booking.exit_time, booking.exit_day_offset)}</small></div>{canMark ? <button type="button" className="manage-action" onClick={() => void markAttendance(booking.id)} disabled={saving}>Mark present</button> : <span className={"status-pill " + (record?.status === "present" ? "active" : record?.status === "absent" ? "inactive" : "pending")}>{record?.status ?? (booking.booking_date > localDate() ? "upcoming" : "awaiting")}</span>}</article>})}{monthlyBookings.length === 0 && <p className="admin-empty">No visits booked for this month.</p>}</div><p className="muted-copy">Any confirmed visit without a check-in is automatically marked absent after 10:00 PM India time.</p></section>}
      {section === 'payments' && <div className="student-columns"><section className="student-card"><h2>Payments</h2><p className="muted-copy">Registration and monthly fees are verified by the administrator. Your seat stays allocated while your account is active. If reactivated without a seat, choose a vacant one after this month's fee is verified.</p>{selectedPayment?.status === 'verified' ? <div className="payment-instructions"><strong>Payment verified.</strong><p>{paymentType === 'monthly' ? paymentSeatNumber !== null ? 'Seat ' + paymentSeatNumber + ' remains assigned while your account is active.' : 'Your payment is verified. Choose a vacant seat from the Book a seat page to resume.' : 'Your one-time registration fee has been verified.'}</p></div> : selectedPayment?.status === 'pending' ? <div className="payment-instructions"><strong>Payment under review.</strong><p>{paymentType === 'monthly' && selectedPayment.seat_number != null ? 'Seat ' + selectedPayment.seat_number + ' is being reviewed with this payment.' : paymentType === 'monthly' ? 'This monthly payment was submitted before seat selection. Ask the administrator to reject it, then submit it again with a vacant seat.' : 'This payment is pending administrator verification. Please wait for review.'}</p></div> : selectedPayment?.status === 'rejected' ? <div className="payment-instructions"><strong>Payment rejected.</strong><p>This payment was rejected and any temporary hold was cleared. Active students keep their assigned seat while their account remains active. You can submit a new payment.</p></div> : selectedPayment?.status === 'refunded' ? <div className="payment-instructions"><strong>Payment refunded.</strong><p>This payment was refunded and any temporary hold was cleared. Active students keep their assigned seat while their account remains active. Submit the fee again if it is due.</p></div> : null}{(!selectedPayment || selectedPayment.status === 'rejected' || selectedPayment.status === 'refunded') && <form className="auth-form payment-form" onSubmit={submitPayment}><label>Payment type<select value={paymentType} onChange={(event) => { setPaymentType(event.target.value as 'registration' | 'monthly'); setSeatNumber(null) }}><option value="registration">One-time registration · {registrationFeeDue === 0 ? 'waived' : '₹' + registrationFeeDue}</option><option value="monthly">Monthly library fee · {monthlyFeeDue ? '₹' + monthlyFeeDue : 'not configured'}</option></select></label>{paymentType === "monthly" && <><p className="payment-instructions">Registration cycle: {registrationDate && currentBillingMonth ? prettyDate(billingCycleStart(registrationDate, currentBillingMonth)) : 'complete registration first'}</p>{seatAssignment ? <p className="payment-instructions">Seat {seatAssignment.seat_number} remains allocated while your account is active. Monthly payments keep the same seat.</p> : profile?.status !== "active" ? <p className="payment-instructions">Ask the administrator to reactivate your account before choosing a vacant seat or paying monthly fees.</p> : currentMonthPaid ? <div className="payment-instructions"><p>This month's fee is verified. Choose a vacant seat from Book a seat to resume.</p><Link href="/protected/book" className="manage-action">Choose a seat</Link></div> : <div className="seat-picker"><span className="seat-picker-label">Choose a vacant seat for your account</span>{availabilityLoading && <small>Checking available seats...</small>}<div className="seat-map student-seat-map" aria-label="Available seats">{seats.map((seat) => { const free = seatIsFree(seat.seat_number); const stateClass = availabilityLoading ? "checking" : free ? "" : seat.status === "available" ? "booked" : "maintenance"; return <button type="button" key={seat.seat_number} disabled={!free || saving} aria-label={seatAvailabilityLabel(seat)} title={seatAvailabilityLabel(seat)} aria-pressed={seatNumber === seat.seat_number} className={"seat " + (seatNumber === seat.seat_number ? "chosen" : stateClass)} onClick={() => setSeatNumber(seat.seat_number)}>{seat.seat_number}</button> })}</div><div className="seat-availability-legend" aria-label="Seat status"><span><i className="available" />Available</span><span><i className="booked" />Allocated or held</span><span><i className="unavailable" />Unavailable</span></div>{seatNumber !== null && <small>Seat {seatNumber} will be allocated to you after payment confirmation.</small>}</div>}</>}{paymentType === "registration" && <p className="payment-instructions">Seat selection is done with each monthly payment, not during registration.</p>}<label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'phonepe' | 'cash')}><option value="phonepe">UPI / PhonePe</option><option value="cash">Cash at library</option></select></label>{paymentMethod === 'phonepe' && <><div className="payment-instructions"><strong>PhonePe / UPI payment</strong><p>{settings.phonepe_instructions || 'Pay using the shared library UPI ID, then enter the transaction reference for admin verification.'}</p>{settings.phonepe_upi_id && <p>UPI ID: <strong>{settings.phonepe_upi_id}</strong></p>}{upiPaymentLink && <a className="payment-upi-link" href={upiPaymentLink}>Pay ₹{paymentAmountDue} with a UPI app</a>}</div><label>UPI transaction reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} required maxLength={120} placeholder="Enter the reference shown after payment" /></label></>}{paymentMethod === 'cash' && <p className="payment-instructions">Choose cash when you have paid at the library desk. The administrator will confirm receipt.</p>}{paymentType === 'registration' && registrationFeeDue === 0 && <p className="payment-instructions">Your registration fee has been waived. No registration payment is due.</p>}<p className="payment-amount">Amount due: <strong>{paymentAmountDue == null ? 'Not configured' : '₹' + paymentAmountDue}</strong></p><button type="submit" className="primary-button" disabled={saving || !registration || paymentAmountDue == null || paymentAmountDue <= 0 || paymentAlreadyCurrent || (paymentType === 'monthly' && (profile?.status !== 'active' || (!seatAssignment && (availabilityLoading || seatNumber === null))))}>{saving ? 'Submitting…' : 'Submit for verification'}</button></form>}{selectedPayment?.status === 'rejected' && <p className="muted-copy">You can submit a new payment for this fee.</p>}</section><section className="student-card"><h2>Payment history</h2>{payments.length ? <div className="student-record-list">{payments.map((payment) => <article className="student-record" key={payment.id}><div><strong>{payment.payment_type === 'registration' ? 'Registration · ₹' + payment.amount : 'Monthly fee · ' + (payment.billing_month ? prettyDate(payment.billing_month) : '') + ' · ₹' + payment.amount}</strong><span>{payment.method === 'phonepe' ? 'UPI / PhonePe' : 'Cash'}{payment.transaction_reference ? ' · Ref ' + payment.transaction_reference : ''}</span>{payment.payment_type === 'monthly' && payment.seat_number != null && <small>Seat {payment.seat_number} · {payment.status === 'verified' ? 'payment selection' : payment.status === 'pending' ? 'held pending review' : 'released'}</small>}{payment.admin_note && <small>Admin note: {payment.admin_note}</small>}<small>Submitted {prettyDate(payment.submitted_at.slice(0, 10))}</small></div><span className={'status-pill ' + payment.status}>{payment.status}</span></article>)}</div> : <p className="admin-empty">No payments submitted.</p>}</section></div>}
      {section === 'profile' && <><section className="student-card"><h2>Student profile</h2><p className="muted-copy">Your offline admission number and login email are fixed by your registration record.</p><form className="auth-form profile-form" onSubmit={saveProfile}><label>Full name<input value={profileDraft.full_name} onChange={(event) => setProfileDraft({ ...profileDraft, full_name: event.target.value })} required maxLength={160} /></label><label>Admission number<input value={registration?.admission_number ?? ''} readOnly /></label><label>Email address<input type="email" value={profile?.email ?? ''} readOnly /></label><label>Phone number<input type="tel" value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} required maxLength={32} /></label><label>Address<textarea rows={4} value={profileDraft.address} onChange={(event) => setProfileDraft({ ...profileDraft, address: event.target.value })} maxLength={500} /></label><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></form></section><section className="student-card"><h2>Default visit duration</h2><p className="muted-copy">This duration is preselected when you book. You can still choose a different duration or entry time for each visit.</p><form className="auth-form settings-form" onSubmit={saveDefaultSlot}><label>Default duration<select value={defaultSlotId} onChange={(event) => setDefaultSlotId(event.target.value)} required><option value="">Choose a duration</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label} · {slot.duration_hours} hours</option>)}</select></label><button className="primary-button" type="submit" disabled={saving || !defaultSlotId}>{saving ? 'Saving…' : 'Save default duration'}</button></form></section></>}
    </>}
  </div></main>
}

