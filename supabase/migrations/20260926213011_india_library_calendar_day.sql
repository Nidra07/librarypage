create or replace function public.library_today()
returns date
language sql
stable
set search_path = ''
as $$ select (pg_catalog.now() at time zone 'Asia/Kolkata')::date; $$;
revoke execute on function public.library_today() from public, anon;
grant execute on function public.library_today() to authenticated;

create or replace function public.book_seat(p_booking_date date, p_slot_id uuid, p_seat_number integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_status text;
  v_booking_id uuid;
  v_slot public.study_slots%rowtype;
begin
  if v_student is null then raise exception 'Sign in before booking a seat.'; end if;
  if p_booking_date < public.library_today() then raise exception 'Choose today or a future date.'; end if;
  select p.status into v_status from public.student_profiles p where p.id = v_student;
  if v_status is distinct from 'active' then raise exception 'Only active students can book a visit.'; end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = v_student) then
    raise exception 'Complete student registration before booking.';
  end if;
  if not exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'registration' and p.status = 'verified') then
    raise exception 'The ₹100 registration payment must be verified first.';
  end if;
  if not exists (
    select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = date_trunc('month', p_booking_date)::date and p.status = 'verified'
  ) then raise exception 'The monthly fee for this booking month must be verified first.'; end if;
  select * into v_slot from public.study_slots s where s.id = p_slot_id and s.active;
  if not found then raise exception 'The selected booking slot is unavailable.'; end if;
  perform 1 from public.seats s where s.seat_number = p_seat_number and s.status = 'available' for update;
  if not found then raise exception 'The selected seat is not available.'; end if;
  if exists (
    select 1 from public.bookings b where b.student_id = v_student and b.status <> 'cancelled'
      and tsrange(b.booking_date + b.entry_time, b.booking_date + b.exit_time + (b.exit_day_offset * interval '1 day'), '[)')
        && tsrange(p_booking_date + v_slot.starts_at, p_booking_date + v_slot.ends_at
          + (case when v_slot.ends_at <= v_slot.starts_at then interval '1 day' else interval '0 day' end), '[)')
  ) then raise exception 'You already have an overlapping booking.'; end if;
  insert into public.bookings (student_id, slot_id, booking_date, seat_number, status)
  values (v_student, p_slot_id, p_booking_date, p_seat_number, 'confirmed') returning id into v_booking_id;
  return v_booking_id;
end;
$$;
revoke execute on function public.book_seat(date, uuid, integer) from public, anon;
grant execute on function public.book_seat(date, uuid, integer) to authenticated;

create or replace function public.get_seat_availability(p_booking_date date, p_slot_id uuid)
returns table (seat_number integer, label text, status text, is_available boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slot public.study_slots%rowtype;
  v_start timestamp;
  v_end timestamp;
begin
  if auth.uid() is null then raise exception 'Sign in to view seat availability.'; end if;
  if p_booking_date < public.library_today() then raise exception 'Choose today or a future date.'; end if;
  select * into v_slot from public.study_slots s where s.id = p_slot_id and s.active;
  if not found then raise exception 'Choose an active time slot.'; end if;
  v_start := p_booking_date + v_slot.starts_at;
  v_end := p_booking_date + v_slot.ends_at
    + (case when v_slot.ends_at <= v_slot.starts_at then interval '1 day' else interval '0 day' end);
  return query
  select s.seat_number, s.label, s.status,
    s.status = 'available' and not exists (
      select 1 from public.bookings b where b.seat_number = s.seat_number and b.status <> 'cancelled'
        and tsrange(b.booking_date + b.entry_time,
          b.booking_date + b.exit_time + (b.exit_day_offset * interval '1 day'), '[)')
          && tsrange(v_start, v_end, '[)')
    ) as is_available
  from public.seats s order by s.seat_number;
end;
$$;
revoke execute on function public.get_seat_availability(date, uuid) from public, anon;
grant execute on function public.get_seat_availability(date, uuid) to authenticated;

create or replace function public.mark_my_attendance(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_attendance_id uuid;
begin
  select * into v_booking from public.bookings b where b.id = p_booking_id and b.student_id = v_student;
  if not found then raise exception 'This booking does not belong to your account.'; end if;
  if v_booking.booking_date <> public.library_today() or v_booking.status <> 'confirmed' then
    raise exception 'You can mark attendance only for today’s confirmed visit.';
  end if;
  if not exists (select 1 from public.student_profiles p where p.id = v_student and p.status = 'active') then
    raise exception 'Only active students can mark attendance.';
  end if;
  insert into public.attendance (student_id, booking_id, attended_on, status, marked_by)
  values (v_student, v_booking.id, v_booking.booking_date, 'present', v_student)
  on conflict (booking_id) do nothing returning id into v_attendance_id;
  if v_attendance_id is null then raise exception 'Attendance has already been recorded for this visit.'; end if;
  return v_attendance_id;
end;
$$;
revoke execute on function public.mark_my_attendance(uuid) from public, anon;
grant execute on function public.mark_my_attendance(uuid) to authenticated;

create or replace function public.cancel_my_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings set status = 'cancelled', updated_at = now()
  where id = p_booking_id and student_id = auth.uid() and status = 'confirmed'
    and booking_date >= public.library_today();
  if not found then raise exception 'This visit can no longer be cancelled.'; end if;
end;
$$;
revoke execute on function public.cancel_my_booking(uuid) from public, anon;
grant execute on function public.cancel_my_booking(uuid) to authenticated;
