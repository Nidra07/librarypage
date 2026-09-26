alter table public.student_profiles
  add column if not exists default_slot_id uuid references public.study_slots(id) on delete set null;

update public.student_profiles p
set default_slot_id = r.slot_id
from public.student_registrations r
join public.study_slots s on s.id = r.slot_id and s.active
where r.student_id = p.id and p.default_slot_id is null;

create or replace function public.update_my_default_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
begin
  if v_student is null then raise exception 'Sign in before changing your default visit duration.'; end if;
  if not exists (select 1 from public.study_slots s where s.id = p_slot_id and s.active) then
    raise exception 'Choose an active visit duration.';
  end if;
  update public.student_profiles
  set default_slot_id = p_slot_id, updated_at = now()
  where id = v_student;
  if not found then raise exception 'Student profile was not found.'; end if;
end;
$$;
revoke execute on function public.update_my_default_slot(uuid) from public, anon;
grant execute on function public.update_my_default_slot(uuid) to authenticated;

create or replace function public.set_booking_from_slot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_default_start time;
  v_duration integer;
  v_total_minutes integer;
begin
  select s.starts_at, s.duration_hours into v_default_start, v_duration
  from public.study_slots s where s.id = new.slot_id;
  if v_duration is null then raise exception 'The selected booking duration is unavailable.'; end if;
  if new.entry_time is null then
    select r.entry_time into new.entry_time from public.student_registrations r where r.student_id = new.student_id;
    new.entry_time := coalesce(new.entry_time, v_default_start, time '08:00');
  end if;
  v_total_minutes := extract(hour from new.entry_time)::integer * 60
    + extract(minute from new.entry_time)::integer + v_duration * 60;
  new.exit_time := (time '00:00' + (v_total_minutes * interval '1 minute'))::time;
  new.exit_day_offset := (v_total_minutes / 1440)::smallint;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_booking_from_slot() from public, anon, authenticated;
drop trigger if exists set_booking_from_slot on public.bookings;
create trigger set_booking_from_slot
  before insert or update of student_id, slot_id, booking_date, seat_number, status, entry_time on public.bookings
  for each row execute procedure public.set_booking_from_slot();

create or replace function public.validate_confirmed_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.student_profiles%rowtype;
  v_monthly_fee numeric(10, 2);
  v_registration_fee numeric(10, 2);
begin
  if new.status <> 'confirmed' then return new; end if;
  select * into v_profile from public.student_profiles p where p.id = new.student_id;
  if v_profile.status is distinct from 'active' then raise exception 'Only active students can hold a confirmed booking.'; end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = new.student_id) then
    raise exception 'Complete student registration before booking.';
  end if;
  if new.entry_time < time '06:00' or new.exit_day_offset <> 0 or new.exit_time > time '22:00' then
    raise exception 'Visits must start at or after 6:00 AM and finish by 10:00 PM.';
  end if;
  v_registration_fee := case when v_profile.registration_fee_waived then 0 else 100 - v_profile.registration_fee_discount end;
  if v_registration_fee > 0 and not exists (
    select 1 from public.payments p where p.student_id = new.student_id
      and p.payment_type = 'registration' and p.status = 'verified' and p.amount >= v_registration_fee
  ) then raise exception 'The current registration fee must be verified before booking.'; end if;
  select coalesce(v_profile.monthly_fee_override, s.monthly_fee) into v_monthly_fee
    from public.library_settings s where s.singleton;
  if v_monthly_fee is null then raise exception 'The library monthly fee has not been configured for this student.'; end if;
  if not exists (
    select 1 from public.payments p where p.student_id = new.student_id and p.payment_type = 'monthly'
      and p.billing_month = date_trunc('month', new.booking_date)::date and p.status = 'verified'
      and p.amount >= v_monthly_fee
  ) then raise exception 'The current monthly fee for this booking month must be verified first.'; end if;
  if not exists (select 1 from public.seats s where s.seat_number = new.seat_number and s.status = 'available') then
    raise exception 'The selected seat is not available.';
  end if;
  if not exists (select 1 from public.study_slots s where s.id = new.slot_id and s.active) then
    raise exception 'The selected booking duration is inactive.';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_confirmed_booking() from public, anon, authenticated;

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
  perform 1 from public.seats s where s.seat_number = p_seat_number and s.status = 'available' for update;
  if not found then raise exception 'The selected seat is not available.'; end if;
  v_start := p_booking_date + p_entry_time;
  v_end := v_start + (v_slot.duration_hours * interval '1 hour');
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

create or replace function public.book_seat(p_booking_date date, p_slot_id uuid, p_seat_number integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_time time;
begin
  select coalesce(s.starts_at, r.entry_time, time '08:00') into v_entry_time
  from public.study_slots s
  left join public.student_registrations r on r.student_id = auth.uid()
  where s.id = p_slot_id;
  return public.book_seat(p_booking_date, p_slot_id, p_seat_number, v_entry_time);
end;
$$;
revoke execute on function public.book_seat(date, uuid, integer) from public, anon;
grant execute on function public.book_seat(date, uuid, integer) to authenticated;

create or replace function public.get_seat_availability(p_booking_date date, p_slot_id uuid, p_entry_time time)
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
  if not found then raise exception 'Choose an active visit duration.'; end if;
  if p_entry_time is null or p_entry_time < time '06:00'
    or extract(hour from p_entry_time)::integer * 60 + extract(minute from p_entry_time)::integer
       + v_slot.duration_hours * 60 > 22 * 60 then
    raise exception 'Choose a start time that fits between 6:00 AM and 10:00 PM.';
  end if;
  v_start := p_booking_date + p_entry_time;
  v_end := v_start + (v_slot.duration_hours * interval '1 hour');
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
revoke execute on function public.get_seat_availability(date, uuid, time) from public, anon;
grant execute on function public.get_seat_availability(date, uuid, time) to authenticated;

create or replace function public.get_seat_availability(p_booking_date date, p_slot_id uuid)
returns table (seat_number integer, label text, status text, is_available boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry_time time;
begin
  select coalesce(s.starts_at, time '08:00') into v_entry_time
  from public.study_slots s where s.id = p_slot_id;
  return query select * from public.get_seat_availability(p_booking_date, p_slot_id, v_entry_time);
end;
$$;
revoke execute on function public.get_seat_availability(date, uuid) from public, anon;
grant execute on function public.get_seat_availability(date, uuid) to authenticated;

create or replace function public.admin_update_booking(
  p_booking_id uuid,
  p_booking_date date,
  p_slot_id uuid,
  p_seat_number integer,
  p_status text,
  p_entry_time time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  if p_status not in ('confirmed', 'cancelled', 'completed') then raise exception 'Choose a valid booking status.'; end if;
  update public.bookings
  set booking_date = p_booking_date, slot_id = p_slot_id,
      seat_number = p_seat_number, entry_time = p_entry_time, status = p_status, updated_at = now()
  where id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;
end;
$$;
revoke execute on function public.admin_update_booking(uuid, date, uuid, integer, text, time) from public, anon;
grant execute on function public.admin_update_booking(uuid, date, uuid, integer, text, time) to authenticated;

create or replace function public.admin_update_booking(
  p_booking_id uuid,
  p_booking_date date,
  p_slot_id uuid,
  p_seat_number integer,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_time time;
begin
  select b.entry_time into v_entry_time from public.bookings b where b.id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;
  perform public.admin_update_booking(p_booking_id, p_booking_date, p_slot_id, p_seat_number, p_status, v_entry_time);
end;
$$;
revoke execute on function public.admin_update_booking(uuid, date, uuid, integer, text) from public, anon;
grant execute on function public.admin_update_booking(uuid, date, uuid, integer, text) to authenticated;

create or replace function public.mark_my_attendance(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_local_now timestamp := now() at time zone 'Asia/Kolkata';
  v_attendance_id uuid;
begin
  if v_student is null then raise exception 'Sign in before marking attendance.'; end if;
  select * into v_booking from public.bookings b where b.id = p_booking_id and b.student_id = v_student;
  if not found then raise exception 'This booking does not belong to your account.'; end if;
  if v_booking.booking_date <> public.library_today() or v_booking.status <> 'confirmed' then
    raise exception 'You can mark attendance only for today’s confirmed visit.';
  end if;
  if v_local_now::time < time '06:00' or v_local_now::time >= time '22:00' then
    raise exception 'Attendance can be marked while the library is open, from 6:00 AM to 10:00 PM.';
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

create or replace function public.mark_missed_attendance_absent()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.library_today();
  v_local_time time := (now() at time zone 'Asia/Kolkata')::time;
  v_marked integer;
begin
  if v_local_time < time '22:00' then raise exception 'The library has not closed for the day.'; end if;
  insert into public.attendance (student_id, booking_id, attended_on, status, marked_by)
  select b.student_id, b.id, b.booking_date, 'absent', null
  from public.bookings b
  where b.status in ('confirmed', 'completed')
    and (b.booking_date < v_today or b.booking_date = v_today)
    and not exists (select 1 from public.attendance a where a.booking_id = b.id)
  on conflict (booking_id) do nothing;
  get diagnostics v_marked = row_count;
  return v_marked;
end;
$$;
revoke execute on function public.mark_missed_attendance_absent() from public, anon, authenticated;

create or replace function public.admin_monthly_attendance_summary(p_month date)
returns table(
  student_id uuid,
  full_name text,
  admission_number text,
  account_status text,
  visit_count bigint,
  present_count bigint,
  absent_count bigint,
  unmarked_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  if p_month is null or date_trunc('month', p_month)::date <> p_month then
    raise exception 'Choose the first day of a month.';
  end if;
  return query
  select p.id, coalesce(r.full_name, p.full_name), r.admission_number, p.status,
    count(b.id)::bigint,
    count(a.id) filter (where a.status = 'present')::bigint,
    count(a.id) filter (where a.status = 'absent')::bigint,
    count(b.id) filter (where a.id is null)::bigint
  from public.student_profiles p
  left join public.student_registrations r on r.student_id = p.id
  left join public.bookings b on b.student_id = p.id
    and b.booking_date >= p_month and b.booking_date < (p_month + interval '1 month')::date
    and b.status <> 'cancelled'
  left join public.attendance a on a.booking_id = b.id
  group by p.id, r.full_name, r.admission_number, p.status
  order by coalesce(r.full_name, p.full_name), p.id;
end;
$$;
revoke execute on function public.admin_monthly_attendance_summary(date) from public, anon;
grant execute on function public.admin_monthly_attendance_summary(date) to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'mark-missed-attendance-absent' loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('mark-missed-attendance-absent', '35 16 * * *',
    'select public.mark_missed_attendance_absent();');
end;
$$;

