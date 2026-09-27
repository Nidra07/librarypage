create or replace function public.book_seat(
  p_booking_date date,
  p_slot_id uuid,
  p_seat_number integer,
  p_entry_time time
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_profile public.student_profiles%rowtype;
  v_slot public.study_slots%rowtype;
  v_monthly_fee numeric(10, 2);
  v_registration_fee numeric(10, 2);
  v_end_minutes integer;
  v_booking_id uuid;
  v_start timestamp;
  v_end timestamp;
begin
  if v_student is null then raise exception 'Sign in before booking a seat.'; end if;
  if p_booking_date < public.library_today() then raise exception 'Choose today or a future date.'; end if;
  select * into v_profile from public.student_profiles p where p.id = v_student;
  if v_profile.status is distinct from 'active' then raise exception 'Only active students can book a visit.'; end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = v_student) then
    raise exception 'Complete student registration before booking.';
  end if;
  select * into v_slot from public.study_slots s where s.id = p_slot_id and s.active;
  if not found then raise exception 'The selected booking duration is unavailable.'; end if;
  if p_entry_time is null or p_entry_time < time '06:00' then
    raise exception 'Choose a start time from 6:00 AM onward.';
  end if;
  if extract(second from p_entry_time) <> 0 then raise exception 'Choose a time on the minute.'; end if;
  v_end_minutes := extract(hour from p_entry_time)::integer * 60
    + extract(minute from p_entry_time)::integer + v_slot.duration_hours * 60;
  if v_end_minutes > 22 * 60 then
    raise exception 'This visit must finish by the 10:00 PM closing time.';
  end if;
  v_registration_fee := case when v_profile.registration_fee_waived then 0 else 100 - v_profile.registration_fee_discount end;
  if v_registration_fee > 0 and not exists (
    select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'registration'
      and p.status = 'verified' and p.amount >= v_registration_fee
  ) then raise exception 'The current registration fee must be verified first.'; end if;
  select coalesce(v_profile.monthly_fee_override, s.monthly_fee) into v_monthly_fee
    from public.library_settings s where s.singleton;
  if v_monthly_fee is null then raise exception 'The library monthly fee has not been configured for this student.'; end if;
  if not exists (
    select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = date_trunc('month', p_booking_date)::date and p.status = 'verified'
      and p.amount >= v_monthly_fee
  ) then raise exception 'The current monthly fee for this booking month must be verified first.'; end if;

  -- Serialize reservations for the same seat before checking for overlapping bookings.
  perform 1 from public.seats s where s.seat_number = p_seat_number and s.status = 'available' for update;
  if not found then raise exception 'The selected seat is not available.'; end if;

  v_start := p_booking_date + p_entry_time;
  v_end := v_start + (v_slot.duration_hours * interval '1 hour');
  if exists (
    select 1 from public.bookings b where b.seat_number = p_seat_number and b.status <> 'cancelled'
      and tsrange(b.booking_date + b.entry_time, b.booking_date + b.exit_time + (b.exit_day_offset * interval '1 day'), '[)')
        && tsrange(v_start, v_end, '[)')
  ) then
    raise exception 'That seat is already booked for this date and time. Choose another available seat or change your slot/time.';
  end if;

  if exists (
    select 1 from public.bookings b where b.student_id = v_student and b.status <> 'cancelled'
      and tsrange(b.booking_date + b.entry_time, b.booking_date + b.exit_time + (b.exit_day_offset * interval '1 day'), '[)')
        && tsrange(v_start, v_end, '[)')
  ) then raise exception 'You already have an overlapping booking.'; end if;
  insert into public.bookings (student_id, slot_id, booking_date, seat_number, entry_time, status)
  values (v_student, p_slot_id, p_booking_date, p_seat_number, p_entry_time, 'confirmed')
  returning id into v_booking_id;
  return v_booking_id;
end;
$$;

revoke execute on function public.book_seat(date, uuid, integer, time) from public, anon;
grant execute on function public.book_seat(date, uuid, integer, time) to authenticated;

