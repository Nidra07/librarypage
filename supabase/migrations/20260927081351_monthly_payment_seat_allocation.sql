-- Students choose a seat while paying the monthly fee. Pending payments hold
-- that seat; verified payments allocate it for the selected month.

alter table public.student_registrations
  alter column seat_number drop not null;

alter table public.payments
  add column if not exists seat_number integer references public.seats(seat_number) on delete restrict;

alter table public.payments
  drop constraint if exists payments_seat_only_for_monthly_fee,
  add constraint payments_seat_only_for_monthly_fee
    check (payment_type = 'monthly' or seat_number is null);

create unique index if not exists payments_one_monthly_seat_claim
  on public.payments (billing_month, seat_number)
  where payment_type = 'monthly'
    and status in ('pending', 'verified')
    and seat_number is not null;

create or replace function public.get_monthly_seat_availability(p_billing_month date)
returns table (seat_number integer, label text, status text, is_available boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view seat availability.'; end if;
  if p_billing_month is null or date_trunc('month', p_billing_month)::date <> p_billing_month then
    raise exception 'Choose the first day of a billing month.';
  end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = auth.uid()) then
    raise exception 'Complete student registration before choosing a seat.';
  end if;

  return query
  select s.seat_number, s.label, s.status,
    s.status = 'available'
      and not exists (
        select 1 from public.payments p
        where p.payment_type = 'monthly'
          and p.billing_month = p_billing_month
          and p.status in ('pending', 'verified')
          and p.seat_number = s.seat_number
      )
      and not exists (
        select 1 from public.payments p
        join public.student_registrations r on r.student_id = p.student_id
        where p.payment_type = 'monthly'
          and p.billing_month = p_billing_month
          and p.status in ('pending', 'verified')
          and p.seat_number is null
          and r.seat_number ~ '^[0-9]+$'
          and r.seat_number::integer = s.seat_number
      )
      and not exists (
        select 1 from public.bookings b
        where b.seat_number = s.seat_number
          and b.status <> 'cancelled'
          and b.student_id <> auth.uid()
          and b.booking_date >= p_billing_month
          and b.booking_date < (p_billing_month + interval '1 month')::date
      ) as is_available
  from public.seats s
  order by s.seat_number;
end;
$$;
revoke execute on function public.get_monthly_seat_availability(date) from public, anon;
grant execute on function public.get_monthly_seat_availability(date) to authenticated;

drop function if exists public.submit_payment(text, date, text, text);
create function public.submit_payment(
  p_payment_type text,
  p_billing_month date,
  p_method text,
  p_transaction_reference text,
  p_seat_number integer
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
      raise exception 'This month's current payment has already been verified.';
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
$$;
revoke execute on function public.submit_payment(text, date, text, text, integer) from public, anon;
grant execute on function public.submit_payment(text, date, text, text, integer) to authenticated;

-- Keep registration payments working briefly for an older portal build, while
-- preventing old monthly-payment requests from bypassing seat selection.
create or replace function public.submit_payment(
  p_payment_type text,
  p_billing_month date,
  p_method text,
  p_transaction_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_payment_type = 'monthly' then
    raise exception 'Choose a vacant seat in the updated payment form before submitting the monthly fee.';
  end if;
  return public.submit_payment(p_payment_type, p_billing_month, p_method, p_transaction_reference, null);
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
        raise exception 'The student's monthly fee changed after this payment was submitted. Reject it and ask the student to resubmit.';
      end if;
      if v_payment.seat_number is null then raise exception 'This monthly payment has no seat selected. Reject it and ask the student to resubmit.'; end if;
      if not exists (select 1 from public.seats s where s.seat_number = v_payment.seat_number and s.status = 'available') then
        raise exception 'The selected seat is no longer available. Reject this payment and ask the student to select another seat.';
      end if;
    elsif v_payment.payment_type = 'registration' then
      v_registration_fee := case when v_profile.registration_fee_waived then 0 else 100 - v_profile.registration_fee_discount end;
      if v_registration_fee <= 0 or v_payment.amount < v_registration_fee then
        raise exception 'The student's registration fee changed or was waived. Reject this payment and ask the student to check the current amount.';
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

create or replace function public.enforce_monthly_seat_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_monthly_fee numeric(10, 2);
  v_assigned_seat integer;
begin
  if new.status <> 'confirmed' then return new; end if;

  select coalesce(v_profile.monthly_fee_override, s.monthly_fee) into v_monthly_fee
  from public.student_profiles v_profile
  cross join public.library_settings s
  where v_profile.id = new.student_id and s.singleton;

  select p.seat_number into v_assigned_seat
  from public.payments p
  where p.student_id = new.student_id
    and p.payment_type = 'monthly'
    and p.billing_month = date_trunc('month', new.booking_date)::date
    and p.status = 'verified'
    and v_monthly_fee is not null
    and p.amount >= v_monthly_fee
  order by p.reviewed_at desc nulls last, p.submitted_at desc
  limit 1;

  -- Existing monthly payments predate seat selection. Keep their one-time
  -- registration seat until the next monthly payment reserves a seat directly.
  if v_assigned_seat is null then
    select case when r.seat_number ~ '^[0-9]+$' then r.seat_number::integer else null end
    into v_assigned_seat
    from public.student_registrations r
    where r.student_id = new.student_id;
  end if;

  if v_assigned_seat is null then
    raise exception 'Choose a vacant seat when submitting the monthly payment. Booking opens after the payment is confirmed.';
  end if;
  if new.seat_number is distinct from v_assigned_seat then
    if public.is_library_admin() then
      new.seat_number := v_assigned_seat;
    else
      raise exception 'Use your allocated seat % for this month.', v_assigned_seat;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_monthly_seat_booking() from public, anon, authenticated;
drop trigger if exists a_enforce_monthly_seat_booking on public.bookings;
create trigger a_enforce_monthly_seat_booking
  before insert or update of student_id, booking_date, seat_number, status on public.bookings
  for each row execute procedure public.enforce_monthly_seat_booking();

