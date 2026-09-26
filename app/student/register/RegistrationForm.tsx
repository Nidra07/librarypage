'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Slot = { id: string; label: string; duration_hours: number; starts_at: string; ends_at: string }
type Seat = { seat_number: number; label: string }

function exitPreview(entryTime: string, duration: number) {
  if (!entryTime || !duration) return ''
  const parts = entryTime.split(':').map(Number)
  const totalMinutes = parts[0] * 60 + parts[1] + duration * 60
  const dayOffset = Math.floor(totalMinutes / 1440)
  const minutes = totalMinutes % 1440
  const display = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
  return display + (dayOffset ? ' (next day)' : '')
}

export default function RegistrationForm({
  userId,
  fullName: initialFullName,
  email: initialEmail,
  phone: initialPhone,
}: {
  userId: string
  fullName: string
  email: string
  phone: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [fullName, setFullName] = useState(initialFullName)
  const [admissionNumber, setAdmissionNumber] = useState('')
  const [phone, setPhone] = useState(initialPhone)
  const [email] = useState(initialEmail)
  const [address, setAddress] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [seats, setSeats] = useState<Seat[]>([])
  const [slotId, setSlotId] = useState('')
  const [entryTime, setEntryTime] = useState('')
  const [seatNumber, setSeatNumber] = useState('')
  const [message, setMessage] = useState('')
  const [loadingSlots, setLoadingSlots] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadSlots() {
      const [{ data, error }, seatResult] = await Promise.all([
        supabase.from('study_slots').select('id,label,duration_hours,starts_at,ends_at').eq('active', true).order('starts_at'),
        supabase.from('seats').select('seat_number,label').eq('status', 'available').order('seat_number'),
      ])
      setSlots((data ?? []) as Slot[])
      setSeats((seatResult.data ?? []) as Seat[])
      setSlotId((current) => current || data?.[0]?.id || '')
      if (error || seatResult.error) setMessage((error ?? seatResult.error)?.message ?? '')
      setLoadingSlots(false)
    }
    void loadSlots()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    const { error } = await supabase.from('student_registrations').insert({
      student_id: userId,
      full_name: fullName.trim(),
      admission_number: admissionNumber.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      slot_id: slotId,
      entry_time: entryTime,
      seat_number: seatNumber.trim(),
    })
    if (error) {
      setMessage(error.code === '23505'
        ? 'That admission number is already registered. Please check with the library administrator.'
        : error.message)
      setSaving(false)
      return
    }
    router.replace('/protected')
    router.refresh()
  }

  const selectedSlot = slots.find((slot) => slot.id === slotId)

  return <form onSubmit={submit} className="auth-form registration-form">
    <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" maxLength={160} required /></label>
    <label>Offline admission number<input value={admissionNumber} onChange={(event) => setAdmissionNumber(event.target.value)} autoComplete="off" maxLength={80} required /></label>
    <label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" maxLength={32} required /></label>
    <label>Email address<input type="email" value={email} readOnly required /></label>
    <label>Address<textarea value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" maxLength={500} rows={3} required /></label>
    <label>Preferred booking slot{loadingSlots ? <span>Loading slots…</span> : <select value={slotId} onChange={(event) => setSlotId(event.target.value)} required disabled={!slots.length}><option value="" disabled>Select a slot</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label} · {slot.duration_hours} hours · {slot.starts_at.slice(0, 5)}–{slot.ends_at.slice(0, 5)}</option>)}</select>}</label>
    {!loadingSlots && slots.length === 0 && <p className="auth-error">No booking slots are available yet. Please contact the library administrator.</p>}
    <label>Entry time<input type="time" value={entryTime} onChange={(event) => setEntryTime(event.target.value)} required /></label>
    <p className="registration-exit" aria-live="polite">Calculated exit time: <strong>{selectedSlot && entryTime ? exitPreview(entryTime, selectedSlot.duration_hours) : 'Choose a duration and entry time'}</strong></p>
    <label>Preferred seat{loadingSlots ? <span>Loading seats…</span> : <select value={seatNumber} onChange={(event) => setSeatNumber(event.target.value)} required disabled={!seats.length}><option value="" disabled>Select a seat</option>{seats.map((seat) => <option key={seat.seat_number} value={String(seat.seat_number)}>{seat.label || 'Seat ' + seat.seat_number}</option>)}</select>}</label>
    {!loadingSlots && seats.length === 0 && <p className="auth-error">No seats are available. Please contact the library administrator.</p>}
    {message && <p className="auth-error" role="alert">{message}</p>}
    <button className="primary-button auth-submit" type="submit" disabled={saving || loadingSlots || slots.length === 0 || seats.length === 0}>{saving ? 'Saving registration…' : 'Complete registration'}</button>
  </form>
}
