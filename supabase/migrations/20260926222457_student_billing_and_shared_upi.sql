alter table public.student_profiles
  add column if not exists monthly_fee_override numeric(10, 2),
  add column if not exists registration_fee_discount numeric(10, 2) not null default 0,
  add column if not exists registration_fee_waived boolean not null default false;

alter table public.student_profiles
  drop constraint if exists student_profiles_monthly_fee_override_check,
  add constraint student_profiles_monthly_fee_override_check
    check (monthly_fee_override is null or monthly_fee_override > 0),
  drop constraint if exists student_profiles_registration_fee_discount_check,
  add constraint student_profiles_registration_fee_discount_check
    check (registration_fee_discount >= 0 and registration_fee_discount <= 100);

alter table public.library_settings
  add column if not exists phonepe_upi_id text not null default '';

alter table public.library_settings
  drop constraint if exists library_settings_phonepe_upi_id_check,
  add constraint library_settings_phonepe_upi_id_check
    check (char_length(phonepe_upi_id) <= 100);

alter table public.payments
  drop constraint if exists payments_type_month_shape,
  add constraint payments_type_month_shape check (
    (payment_type = 'registration' and billing_month is null and amount <= 100)
    or (payment_type = 'monthly' and billing_month is not null and extract(day from billing_month) = 1)
  );

create or replace function public.admin_update_student_billing(
  p_student_id uuid,
  p_monthly_fee_override numeric,
  p_registration_fee_discount numeric,
  p_registration_fee_waived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_library_admin() then
    raise exception 'Administrator access is required.';
  end if;
  if p_monthly_fee_override is not null and p_monthly_fee_override <= 0 then
    raise exception 'A student monthly fee must be greater than zero, or left blank to use the default.';
  end if;
  if p_registration_fee_discount is null or p_registration_fee_discount < 0 or p_registration_fee_discount > 100 then
    raise exception 'Registration fee rebate must be between ₹0 and ₹100.';
  end if;
  update public.student_profiles
  set monthly_fee_override = p_monthly_fee_override,
      registration_fee_discount = p_registration_fee_discount,
      registration_fee_waived = coalesce(p_registration_fee_waived, false),
      updated_at = now()
  where id = p_student_id;
  if not found then raise exception 'Student account was not found.'; end if;
end;
$$;
revoke execute on function public.admin_update_student_billing(uuid, numeric, numeric, boolean) from public, anon;
grant execute on function public.admin_update_student_billing(uuid, numeric, numeric, boolean) to authenticated;

create or replace function public.admin_payment_collection_totals()
returns table(total_received numeric, month_total numeric, quarter_total numeric, year_total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_month_start date;
  v_quarter_start date;
  v_year_start date;
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  v_month_start := date_trunc('month', v_today)::date;
  v_quarter_start := make_date(extract(year from v_today)::integer,
    (((extract(month from v_today)::integer - 1) / 3) * 3) + 1, 1);
  v_year_start := make_date(extract(year from v_today)::integer, 1, 1);
  return query
  select coalesce(sum(p.amount), 0)::numeric,
    coalesce(sum(p.amount) filter (where (p.reviewed_at at time zone 'Asia/Kolkata')::date >= v_month_start), 0)::numeric,
    coalesce(sum(p.amount) filter (where (p.reviewed_at at time zone 'Asia/Kolkata')::date >= v_quarter_start), 0)::numeric,
    coalesce(sum(p.amount) filter (where (p.reviewed_at at time zone 'Asia/Kolkata')::date >= v_year_start), 0)::numeric
  from public.payments p
  where p.status = 'verified' and p.reviewed_at is not null;
end;
$$;
revoke execute on function public.admin_payment_collection_totals() from public, anon;
grant execute on function public.admin_payment_collection_totals() to authenticated;

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
    raise exception 'The selected booking slot is inactive.';
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_confirmed_booking() from public, anon, authenticated;

create or replace function public.submit_payment(
  p_payment_type text,
  p_billing_month date default null,
  p_method text default 'phonepe',
  p_transaction_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_amount numeric(10, 2);
  v_registration_fee numeric(10, 2);
  v_monthly_override numeric(10, 2);
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
    if p_billing_month is not null then raise exception 'Registration payment does not use a billing month.'; end if;
    select case when p.registration_fee_waived then 0 else 100 - p.registration_fee_discount end
      into v_registration_fee from public.student_profiles p where p.id = v_student;
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
    if exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = p_billing_month and p.status = 'pending') then
      raise exception 'A payment for this month is already awaiting review.';
    end if;
    select coalesce(p.monthly_fee_override, s.monthly_fee) into v_amount
      from public.student_profiles p cross join public.library_settings s
      where p.id = v_student and s.singleton;
    if v_amount is null then raise exception 'The library has not configured a monthly fee for you yet.'; end if;
    if exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = p_billing_month and p.status = 'verified' and p.amount >= v_amount) then
      raise exception 'This month’s current payment has already been verified.';
    end if;
  else raise exception 'Choose registration or monthly payment.';
  end if;
  insert into public.payments (student_id, payment_type, billing_month, amount, method, transaction_reference)
  values (v_student, p_payment_type, p_billing_month, v_amount, p_method, nullif(btrim(p_transaction_reference), ''))
  returning id into v_payment_id;
  return v_payment_id;
end;
$$;
revoke execute on function public.submit_payment(text, date, text, text) from public, anon;
grant execute on function public.submit_payment(text, date, text, text) to authenticated;

create or replace function public.admin_review_payment(p_payment_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_profile public.student_profiles%rowtype;
  v_monthly_fee numeric(10, 2);
  v_registration_fee numeric(10, 2);
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  if p_status not in ('verified', 'rejected') then raise exception 'Choose verified or rejected.'; end if;
  select * into v_payment from public.payments where id = p_payment_id and status = 'pending' for update;
  if not found then raise exception 'This payment is no longer pending.'; end if;
  if p_status = 'verified' then
    select * into v_profile from public.student_profiles where id = v_payment.student_id;
    if v_payment.payment_type = 'monthly' then
      select coalesce(v_profile.monthly_fee_override, s.monthly_fee) into v_monthly_fee
        from public.library_settings s where s.singleton;
      if v_monthly_fee is null or v_payment.amount < v_monthly_fee then
        raise exception 'The student’s monthly fee changed after this payment was submitted. Reject it and ask the student to resubmit.';
      end if;
    elsif v_payment.payment_type = 'registration' then
      v_registration_fee := case when v_profile.registration_fee_waived then 0 else 100 - v_profile.registration_fee_discount end;
      if v_registration_fee <= 0 or v_payment.amount < v_registration_fee then
        raise exception 'The student’s registration fee changed or was waived. Reject this payment and ask the student to check the current amount.';
      end if;
    end if;
  end if;
  update public.payments
  set status = p_status, admin_note = nullif(btrim(p_note), ''), reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_payment_id;
end;
$$;
revoke execute on function public.admin_review_payment(uuid, text, text) from public, anon;
grant execute on function public.admin_review_payment(uuid, text, text) to authenticated;

create or replace function public.book_seat(p_booking_date date, p_slot_id uuid, p_seat_number integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_profile public.student_profiles%rowtype;
  v_monthly_fee numeric(10, 2);
  v_registration_fee numeric(10, 2);
  v_booking_id uuid;
  v_slot public.study_slots%rowtype;
begin
  if v_student is null then raise exception 'Sign in before booking a seat.'; end if;
  if p_booking_date < public.library_today() then raise exception 'Choose today or a future date.'; end if;
  select * into v_profile from public.student_profiles p where p.id = v_student;
  if v_profile.status is distinct from 'active' then raise exception 'Only active students can book a visit.'; end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = v_student) then
    raise exception 'Complete student registration before booking.';
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

