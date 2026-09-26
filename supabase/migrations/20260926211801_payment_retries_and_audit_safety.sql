drop index if exists public.payments_one_registration_per_student;
drop index if exists public.payments_one_month_per_student;
create unique index if not exists payments_one_pending_registration_per_student
  on public.payments (student_id)
  where payment_type = 'registration' and status = 'pending';
create unique index if not exists payments_one_pending_monthly_per_month
  on public.payments (student_id, billing_month)
  where payment_type = 'monthly' and status = 'pending';

create or replace function public.validate_confirmed_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.status <> 'confirmed' then return new; end if;
  select p.status into v_status from public.student_profiles p where p.id = new.student_id;
  if v_status is distinct from 'active' then raise exception 'Only active students can hold a confirmed booking.'; end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = new.student_id) then
    raise exception 'Complete student registration before booking.';
  end if;
  if not exists (
    select 1 from public.payments p where p.student_id = new.student_id
      and p.payment_type = 'registration' and p.status = 'verified'
  ) then raise exception 'The registration payment must be verified before booking.'; end if;
  if not exists (select 1 from public.library_settings s where s.singleton and s.monthly_fee is not null) then
    raise exception 'The library monthly fee has not been configured yet.';
  end if;
  if not exists (
    select 1 from public.payments p where p.student_id = new.student_id and p.payment_type = 'monthly'
      and p.billing_month = date_trunc('month', new.booking_date)::date and p.status = 'verified'
  ) then raise exception 'The monthly fee for this booking month must be verified first.'; end if;
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
  v_payment_id uuid;
begin
  if v_student is null then raise exception 'Sign in before submitting a payment.'; end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = v_student) then
    raise exception 'Complete student registration before submitting a payment.';
  end if;
  if p_method not in ('phonepe', 'cash') then raise exception 'Choose PhonePe or cash.'; end if;
  if p_method = 'phonepe' and nullif(btrim(p_transaction_reference), '') is null then
    raise exception 'Enter the PhonePe transaction reference for manual verification.';
  end if;
  if p_payment_type = 'registration' then
    if p_billing_month is not null then raise exception 'Registration payment does not use a billing month.'; end if;
    if exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'registration' and p.status = 'verified') then
      raise exception 'Your registration fee has already been verified.';
    end if;
    v_amount := 100;
  elsif p_payment_type = 'monthly' then
    if p_billing_month is null or date_trunc('month', p_billing_month)::date <> p_billing_month then
      raise exception 'Choose the first day of a billing month.';
    end if;
    if exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = p_billing_month and p.status = 'verified') then
      raise exception 'This month’s payment has already been verified.';
    end if;
    select s.monthly_fee into v_amount from public.library_settings s where s.singleton;
    if v_amount is null then raise exception 'The library monthly fee has not been configured yet.'; end if;
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
  v_monthly_fee numeric(10, 2);
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  if p_status not in ('verified', 'rejected') then raise exception 'Choose verified or rejected.'; end if;
  select * into v_payment from public.payments where id = p_payment_id and status = 'pending' for update;
  if not found then raise exception 'This payment is no longer pending.'; end if;
  if p_status = 'verified' and v_payment.payment_type = 'monthly' then
    select s.monthly_fee into v_monthly_fee from public.library_settings s where s.singleton;
    if v_monthly_fee is null or v_payment.amount <> v_monthly_fee then
      raise exception 'The monthly fee changed after this payment was submitted. Reject it and ask the student to resubmit.';
    end if;
  end if;
  update public.payments
  set status = p_status, admin_note = nullif(btrim(p_note), ''), reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_payment_id;
end;
$$;
revoke execute on function public.admin_review_payment(uuid, text, text) from public, anon;
grant execute on function public.admin_review_payment(uuid, text, text) to authenticated;

create or replace function public.write_library_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row_key text;
begin
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old) - array['full_name', 'email', 'phone', 'address', 'photo_url', 'transaction_reference'];
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new) - array['full_name', 'email', 'phone', 'address', 'photo_url', 'transaction_reference'];
  end if;
  v_row_key := coalesce(v_after ->> 'id', v_after ->> 'student_id', v_after ->> 'seat_number',
                        v_before ->> 'id', v_before ->> 'student_id', v_before ->> 'seat_number', 'unknown');
  insert into public.audit_logs (actor_id, action, table_name, row_key, before_data, after_data)
  values (auth.uid(), lower(tg_op), tg_table_name, v_row_key, v_before, v_after);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.write_library_audit_log() from public, anon, authenticated;
