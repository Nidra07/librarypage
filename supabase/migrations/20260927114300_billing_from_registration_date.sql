create or replace function public.student_billing_month(p_student_id uuid, p_date date)
returns date
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_registration_date date;
  v_cycle_month date;
  v_cycle_start date;
  v_month_offset integer;
begin
  select (r.created_at at time zone 'Asia/Kolkata')::date into v_registration_date
  from public.student_registrations r
  where r.student_id = p_student_id;
  if v_registration_date is null or p_date < v_registration_date then
    return null;
  end if;

  v_month_offset := (extract(year from p_date)::integer - extract(year from v_registration_date)::integer) * 12
    + extract(month from p_date)::integer - extract(month from v_registration_date)::integer;
  v_cycle_month := (date_trunc('month', v_registration_date)::date + make_interval(months => v_month_offset))::date;
  v_cycle_start := (v_cycle_month + (least(extract(day from v_registration_date)::integer,
    extract(day from (v_cycle_month + interval '1 month - 1 day'))::integer) - 1))::date;
  if p_date < v_cycle_start then
    v_month_offset := v_month_offset - 1;
    v_cycle_month := (date_trunc('month', v_registration_date)::date + make_interval(months => v_month_offset))::date;
  end if;
  return date_trunc('month', v_cycle_month)::date;
end;
$function$;
revoke all on function public.student_billing_month(uuid, date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.book_seat(p_booking_date date, p_slot_id uuid, p_seat_number integer, p_entry_time time without time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and p.billing_month = public.student_billing_month(v_student, p_booking_date) and p.status = 'verified'
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_student_seat(p_seat_number integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student uuid := auth.uid();
  v_profile public.student_profiles%rowtype;
  v_monthly_fee numeric(10, 2);
  v_billing_month date := public.student_billing_month(v_student, public.library_today());
begin
  if v_student is null then raise exception 'Sign in before choosing a seat.'; end if;

  -- Match the payment trigger's lock order so concurrent claims serialize safely.
  perform 1 from public.seats s
  where s.seat_number = p_seat_number and s.status = 'available'
  for update;
  if not found then raise exception 'That seat is no longer vacant. Choose another available seat.'; end if;

  select p.* into v_profile
  from public.student_profiles p where p.id = v_student for update;
  if not found or v_profile.status <> 'active' then
    raise exception 'Only active students can choose a seat. Contact the administrator.';
  end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = v_student) then
    raise exception 'Complete student registration before choosing a seat.';
  end if;
  if exists (select 1 from public.student_seat_assignments a where a.student_id = v_student) then
    raise exception 'You already have a seat while your account is active.';
  end if;
  if exists (select 1 from public.payments p where p.student_id = v_student
    and p.payment_type = 'monthly' and p.status = 'pending') then
    raise exception 'Wait for the pending monthly payment to be reviewed before choosing a different seat.';
  end if;
  if exists (select 1 from public.student_seat_assignments a where a.seat_number = p_seat_number) then
    raise exception 'That seat is already allocated to another active student. Choose another available seat.';
  end if;

  select coalesce(v_profile.monthly_fee_override, s.monthly_fee) into v_monthly_fee
  from public.library_settings s where s.singleton;
  if v_monthly_fee is null then raise exception 'The library has not set your monthly fee yet.'; end if;
  if not exists (
    select 1 from public.payments p
    where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = v_billing_month and p.status = 'verified'
      and p.amount >= v_monthly_fee
  ) then
    raise exception 'Your current monthâ€™s fee must be verified before choosing a replacement seat.';
  end if;

  insert into public.student_seat_assignments (student_id, seat_number)
  values (v_student, p_seat_number);
  return p_seat_number;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_payment(p_payment_type text, p_billing_month date, p_method text, p_transaction_reference text, p_seat_number integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student uuid := auth.uid();
  v_amount numeric(10, 2);
  v_registration_fee numeric(10, 2);
  v_profile public.student_profiles%rowtype;
  v_payment_id uuid;
begin
  if v_student is null then raise exception 'Sign in before submitting a payment.'; end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = v_student) then
    raise exception 'Complete student registration before submitting a payment.';
  end if;
  if p_method not in ('phonepe', 'cash') then raise exception 'Choose PhonePe or cash.'; end if;
  if p_method = 'phonepe' and nullif(btrim(p_transaction_reference), '') is null then
    raise exception 'Enter the PhonePe or UPI transaction reference for manual verification.';
  end if;

  if p_payment_type = 'registration' then
    if p_billing_month is not null or p_seat_number is not null then
      raise exception 'Registration payment does not use a billing month or seat.';
    end if;
    select * into v_profile from public.student_profiles p where p.id = v_student;
    v_registration_fee := case when v_profile.registration_fee_waived then 0 else 100 - v_profile.registration_fee_discount end;
    if coalesce(v_registration_fee, 0) <= 0 then raise exception 'Your registration fee is waived; no payment is due.'; end if;
    if exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'registration'
      and p.status = 'pending') then raise exception 'A registration payment is already awaiting review.'; end if;
    if exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'registration'
      and p.status = 'verified' and p.amount >= v_registration_fee) then
      raise exception 'Your current registration fee has already been verified.';
    end if;
    v_amount := v_registration_fee;
  elsif p_payment_type = 'monthly' then
    if p_billing_month is null or date_trunc('month', p_billing_month)::date <> p_billing_month then
      raise exception 'Choose the first day of a billing month.';
    end if;
    if p_seat_number is null then raise exception 'Choose a vacant seat for the month before submitting payment.'; end if;
    if p_billing_month is distinct from public.student_billing_month(v_student, public.library_today()) then
      raise exception 'Monthly fees are due on your registration date each month.';
    end if;
    if exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = p_billing_month and p.status = 'pending') then
      raise exception 'A payment for this month is already awaiting review.';
    end if;
    select * into v_profile from public.student_profiles p where p.id = v_student;
    select coalesce(v_profile.monthly_fee_override, s.monthly_fee) into v_amount
      from public.library_settings s where s.singleton;
    if v_amount is null then raise exception 'The library has not configured a monthly fee for you yet.'; end if;
    if exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = p_billing_month and p.status = 'verified' and p.amount >= v_amount) then
      raise exception 'The current payment for this month has already been verified.';
    end if;

    -- Lock the seat row so concurrent payment submissions cannot claim the same
    -- seat and month. The unique index below is the final integrity guard.
    perform 1 from public.seats s
      where s.seat_number = p_seat_number and s.status = 'available'
      for update;
    if not found then raise exception 'That seat is unavailable. Choose another vacant seat.'; end if;
    if exists (
      select 1 from public.payments p
      where p.payment_type = 'monthly' and p.billing_month = p_billing_month
        and p.status in ('pending', 'verified') and p.seat_number = p_seat_number
    ) then raise exception 'That seat is already reserved for this month. Choose another vacant seat.'; end if;
    if exists (
      select 1 from public.payments p
      join public.student_registrations r on r.student_id = p.student_id
      where p.payment_type = 'monthly' and p.billing_month = p_billing_month
        and p.status in ('pending', 'verified') and p.seat_number is null
        and r.seat_number ~ '^[0-9]+$' and r.seat_number::integer = p_seat_number
    ) then raise exception 'That seat is already reserved for this month. Choose another vacant seat.'; end if;
    if exists (
      select 1 from public.bookings b
      where b.seat_number = p_seat_number and b.status <> 'cancelled'
        and b.student_id <> v_student
        and b.booking_date >= p_billing_month
        and b.booking_date < (p_billing_month + interval '1 month')::date
    ) then raise exception 'That seat is already booked this month. Choose another vacant seat.'; end if;
  else
    raise exception 'Choose registration or monthly payment.';
  end if;

  insert into public.payments (student_id, payment_type, billing_month, seat_number, amount, method, transaction_reference)
  values (v_student, p_payment_type, p_billing_month, p_seat_number, v_amount, p_method, nullif(btrim(p_transaction_reference), ''))
  returning id into v_payment_id;
  return v_payment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_confirmed_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and p.billing_month = public.student_billing_month(new.student_id, new.booking_date) and p.status = 'verified'
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
$function$;