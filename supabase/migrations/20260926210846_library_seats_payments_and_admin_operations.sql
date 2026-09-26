-- Library operations: 43 numbered seats, configurable time windows, payments,
-- overlap-safe bookings, student self-service attendance, and admin audit trail.

create extension if not exists btree_gist with schema extensions;

alter table public.student_profiles
  add column if not exists address text not null default '',
  add column if not exists photo_url text;
alter table public.student_profiles drop constraint if exists student_profiles_status_check;
alter table public.student_profiles
  add constraint student_profiles_status_check
  check (status in ('active', 'inactive', 'suspended'));

alter table public.study_slots add column if not exists starts_at time;
alter table public.study_slots add column if not exists ends_at time;
update public.study_slots
set starts_at = time '08:00',
    ends_at = (time '08:00' + duration_hours * interval '1 hour')::time
where starts_at is null or ends_at is null;
alter table public.study_slots alter column starts_at set not null;
alter table public.study_slots alter column ends_at set not null;
alter table public.study_slots drop constraint if exists study_slots_duration_allowed;
alter table public.study_slots
  add constraint study_slots_duration_allowed check (duration_hours in (4, 6, 8, 12));
alter table public.study_slots drop constraint if exists study_slots_time_order;
alter table public.study_slots drop constraint if exists study_slots_time_matches_duration;
alter table public.study_slots
  add constraint study_slots_time_matches_duration check (
    (case when ends_at > starts_at
      then extract(epoch from (ends_at - starts_at))
      else extract(epoch from (ends_at - starts_at)) + 86400
    end) = duration_hours * 3600
  );

create table if not exists public.seats (
  seat_number integer primary key check (seat_number between 1 and 999),
  label text not null default '',
  status text not null default 'available'
    check (status in ('available', 'maintenance', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.seats (seat_number, label)
select seat_number, 'Seat ' || seat_number
from generate_series(1, 43) as seat_number
on conflict (seat_number) do nothing;

-- Older bookings did not store a seat. Assign a distinct seat number so their
-- existing visits remain visible and do not collide during the migration.
alter table public.bookings add column if not exists seat_number integer;
with numbered as (
  select id, row_number() over (order by booking_date, created_at, id)::integer as seat_number
  from public.bookings
  where seat_number is null
)
update public.bookings b
set seat_number = numbered.seat_number
from numbered
where b.id = numbered.id;
alter table public.bookings alter column seat_number set not null;
alter table public.bookings
  add constraint bookings_seat_number_fkey foreign key (seat_number)
    references public.seats(seat_number) on delete restrict;
alter table public.bookings add column if not exists updated_at timestamptz not null default now();

alter table public.bookings drop constraint if exists bookings_student_id_booking_date_key;
alter table public.bookings drop constraint if exists bookings_status_check;
update public.bookings set status = 'confirmed' where status = 'booked';
alter table public.bookings alter column status set default 'confirmed';
alter table public.bookings
  add constraint bookings_status_check check (status in ('confirmed', 'cancelled', 'completed'));
alter table public.bookings
  add constraint bookings_no_overlapping_seat_reservations
  exclude using gist (
    seat_number extensions.gist_int4_ops with =,
    tsrange(
      booking_date + entry_time,
      booking_date + exit_time + (exit_day_offset * interval '1 day'),
      '[)'
    ) with &&
  ) where (status <> 'cancelled');
create index if not exists bookings_seat_date_idx on public.bookings (seat_number, booking_date);
create index if not exists bookings_slot_date_idx on public.bookings (slot_id, booking_date);

drop index if exists public.student_registrations_seat_number_unique;

create table if not exists public.library_settings (
  singleton boolean primary key default true check (singleton),
  monthly_fee numeric(10, 2) check (monthly_fee is null or monthly_fee > 0),
  phonepe_instructions text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.library_settings (singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  payment_type text not null check (payment_type in ('registration', 'monthly')),
  billing_month date,
  amount numeric(10, 2) not null check (amount > 0),
  method text not null check (method in ('phonepe', 'cash')),
  transaction_reference text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  admin_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  constraint payments_type_month_shape check (
    (payment_type = 'registration' and billing_month is null and amount = 100)
    or (payment_type = 'monthly' and billing_month is not null and extract(day from billing_month) = 1)
  )
);
create unique index if not exists payments_one_registration_per_student
  on public.payments (student_id) where payment_type = 'registration';
create unique index if not exists payments_one_month_per_student
  on public.payments (student_id, billing_month) where payment_type = 'monthly';
create index if not exists payments_status_submitted_idx on public.payments (status, submitted_at desc);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  row_key text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function public.set_booking_from_slot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_start time;
  v_end time;
begin
  select s.starts_at, s.ends_at into v_start, v_end
  from public.study_slots s where s.id = new.slot_id;
  if v_start is null or v_end is null then
    raise exception 'The selected booking slot is unavailable.';
  end if;
  new.entry_time := v_start;
  new.exit_time := v_end;
  new.exit_day_offset := case when v_end <= v_start then 1 else 0 end;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_booking_from_slot() from public, anon, authenticated;
drop trigger if exists calculate_booking_exit_time on public.bookings;
drop trigger if exists set_booking_from_slot on public.bookings;
create trigger set_booking_from_slot
  before insert or update of student_id, slot_id, booking_date, seat_number, status on public.bookings
  for each row execute procedure public.set_booking_from_slot();

create or replace function public.validate_confirmed_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.status = 'cancelled' then return new; end if;
  select p.status into v_status from public.student_profiles p where p.id = new.student_id;
  if v_status is distinct from 'active' then
    raise exception 'Only active students can hold a confirmed booking.';
  end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = new.student_id) then
    raise exception 'Complete student registration before booking.';
  end if;
  if not exists (
    select 1 from public.payments p
    where p.student_id = new.student_id and p.payment_type = 'registration' and p.status = 'verified'
  ) then raise exception 'The registration payment must be verified before booking.'; end if;
  if not exists (
    select 1 from public.library_settings s where s.singleton and s.monthly_fee is not null
  ) then raise exception 'The library monthly fee has not been configured yet.'; end if;
  if not exists (
    select 1 from public.payments p
    where p.student_id = new.student_id and p.payment_type = 'monthly'
      and p.billing_month = date_trunc('month', new.booking_date)::date and p.status = 'verified'
  ) then raise exception 'The monthly fee for this booking month must be verified first.'; end if;
  if not exists (
    select 1 from public.seats s where s.seat_number = new.seat_number and s.status = 'available'
  ) then raise exception 'The selected seat is not available.'; end if;
  if not exists (
    select 1 from public.study_slots s where s.id = new.slot_id and s.active
  ) then raise exception 'The selected booking slot is inactive.'; end if;
  return new;
end;
$$;
revoke execute on function public.validate_confirmed_booking() from public, anon, authenticated;
drop trigger if exists validate_confirmed_booking on public.bookings;
create trigger validate_confirmed_booking
  before insert or update of student_id, slot_id, booking_date, seat_number, status on public.bookings
  for each row execute procedure public.validate_confirmed_booking();

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
    v_amount := 100;
  elsif p_payment_type = 'monthly' then
    if p_billing_month is null or date_trunc('month', p_billing_month)::date <> p_billing_month then
      raise exception 'Choose the first day of a billing month.';
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

create or replace function public.book_seat(
  p_booking_date date,
  p_slot_id uuid,
  p_seat_number integer
)
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
  if p_booking_date < current_date then raise exception 'Choose today or a future date.'; end if;
  select p.status into v_status from public.student_profiles p where p.id = v_student;
  if v_status is distinct from 'active' then raise exception 'Only active students can book a visit.'; end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = v_student) then
    raise exception 'Complete student registration before booking.';
  end if;
  if not exists (select 1 from public.payments p where p.student_id = v_student and p.payment_type = 'registration' and p.status = 'verified') then
    raise exception 'The ₹100 registration payment must be verified first.';
  end if;
  if not exists (
    select 1 from public.payments p
    where p.student_id = v_student and p.payment_type = 'monthly'
      and p.billing_month = date_trunc('month', p_booking_date)::date and p.status = 'verified'
  ) then raise exception 'The monthly fee for this booking month must be verified first.'; end if;
  select * into v_slot from public.study_slots s where s.id = p_slot_id and s.active;
  if not found then raise exception 'The selected booking slot is unavailable.'; end if;
  perform 1 from public.seats s where s.seat_number = p_seat_number and s.status = 'available' for update;
  if not found then raise exception 'The selected seat is not available.'; end if;
  if exists (
    select 1 from public.bookings b
    where b.student_id = v_student and b.status <> 'cancelled'
      and tsrange(b.booking_date + b.entry_time, b.booking_date + b.exit_time + (b.exit_day_offset * interval '1 day'), '[)')
        && tsrange(p_booking_date + v_slot.starts_at, p_booking_date + v_slot.ends_at
          + (case when v_slot.ends_at <= v_slot.starts_at then interval '1 day' else interval '0 day' end), '[)')
  ) then raise exception 'You already have an overlapping booking.'; end if;
  insert into public.bookings (student_id, slot_id, booking_date, seat_number, status)
  values (v_student, p_slot_id, p_booking_date, p_seat_number, 'confirmed')
  returning id into v_booking_id;
  return v_booking_id;
end;
$$;
revoke execute on function public.book_seat(date, uuid, integer) from public, anon;
grant execute on function public.book_seat(date, uuid, integer) to authenticated;

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
  select * into v_booking from public.bookings b
  where b.id = p_booking_id and b.student_id = v_student;
  if not found then raise exception 'This booking does not belong to your account.'; end if;
  if v_booking.booking_date <> current_date or v_booking.status <> 'confirmed' then
    raise exception 'You can mark attendance only for today’s confirmed visit.';
  end if;
  if not exists (select 1 from public.student_profiles p where p.id = v_student and p.status = 'active') then
    raise exception 'Only active students can mark attendance.';
  end if;
  insert into public.attendance (student_id, booking_id, attended_on, status, marked_by)
  values (v_student, v_booking.id, v_booking.booking_date, 'present', v_student)
  on conflict (booking_id) do nothing
  returning id into v_attendance_id;
  if v_attendance_id is null then raise exception 'Attendance has already been recorded for this visit.'; end if;
  return v_attendance_id;
end;
$$;
revoke execute on function public.mark_my_attendance(uuid) from public, anon;
grant execute on function public.mark_my_attendance(uuid) to authenticated;

create or replace function public.admin_review_payment(p_payment_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  if p_status not in ('verified', 'rejected') then raise exception 'Choose verified or rejected.'; end if;
  update public.payments
  set status = p_status, admin_note = nullif(btrim(p_note), ''), reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_payment_id and status = 'pending';
  if not found then raise exception 'This payment is no longer pending.'; end if;
end;
$$;
revoke execute on function public.admin_review_payment(uuid, text, text) from public, anon;
grant execute on function public.admin_review_payment(uuid, text, text) to authenticated;

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
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  if p_status not in ('confirmed', 'cancelled', 'completed') then raise exception 'Choose a valid booking status.'; end if;
  update public.bookings
  set booking_date = p_booking_date, slot_id = p_slot_id,
      seat_number = p_seat_number, status = p_status, updated_at = now()
  where id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;
end;
$$;
revoke execute on function public.admin_update_booking(uuid, date, uuid, integer, text) from public, anon;
grant execute on function public.admin_update_booking(uuid, date, uuid, integer, text) to authenticated;

create or replace function public.admin_set_attendance(p_booking_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  if p_status not in ('present', 'absent') then raise exception 'Choose present or absent.'; end if;
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;
  insert into public.attendance (student_id, booking_id, attended_on, status, marked_by)
  values (v_booking.student_id, v_booking.id, v_booking.booking_date, p_status, auth.uid())
  on conflict (booking_id) do update set
    student_id = excluded.student_id,
    attended_on = excluded.attended_on,
    status = excluded.status,
    checked_in_at = now(),
    marked_by = auth.uid();
end;
$$;
revoke execute on function public.admin_set_attendance(uuid, text) from public, anon;
grant execute on function public.admin_set_attendance(uuid, text) to authenticated;

create or replace function public.update_my_student_profile(p_full_name text, p_phone text, p_address text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
begin
  if v_student is null then raise exception 'Sign in before updating your profile.'; end if;
  if length(btrim(coalesce(p_full_name, ''))) = 0 or length(btrim(coalesce(p_phone, ''))) = 0 then
    raise exception 'Name and phone number are required.';
  end if;
  update public.student_profiles
  set full_name = btrim(p_full_name), phone = btrim(p_phone), address = btrim(coalesce(p_address, '')), updated_at = now()
  where id = v_student;
  update public.student_registrations
  set full_name = btrim(p_full_name), phone = btrim(p_phone), address = btrim(coalesce(p_address, '')), updated_at = now()
  where student_id = v_student;
end;
$$;
revoke execute on function public.update_my_student_profile(text, text, text) from public, anon;
grant execute on function public.update_my_student_profile(text, text, text) to authenticated;

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
  v_action text;
begin
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old) - array['full_name', 'email', 'phone', 'address', 'photo_url', 'transaction_reference'];
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new) - array['full_name', 'email', 'phone', 'address', 'photo_url', 'transaction_reference'];
  end if;
  v_row_key := coalesce(v_after ->> 'id', v_after ->> 'student_id', v_after ->> 'seat_number',
                        v_before ->> 'id', v_before ->> 'student_id', v_before ->> 'seat_number', 'unknown');
  v_action := lower(tg_op);
  insert into public.audit_logs (actor_id, action, table_name, row_key, before_data, after_data)
  values (auth.uid(), v_action, tg_table_name, v_row_key, v_before, v_after);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.write_library_audit_log() from public, anon, authenticated;

drop trigger if exists audit_bookings on public.bookings;
create trigger audit_bookings after insert or update or delete on public.bookings
  for each row execute procedure public.write_library_audit_log();
drop trigger if exists audit_attendance on public.attendance;
create trigger audit_attendance after insert or update or delete on public.attendance
  for each row execute procedure public.write_library_audit_log();
drop trigger if exists audit_payments on public.payments;
create trigger audit_payments after insert or update or delete on public.payments
  for each row execute procedure public.write_library_audit_log();
drop trigger if exists audit_student_profiles on public.student_profiles;
create trigger audit_student_profiles after insert or update or delete on public.student_profiles
  for each row execute procedure public.write_library_audit_log();
drop trigger if exists audit_seats on public.seats;
create trigger audit_seats after insert or update or delete on public.seats
  for each row execute procedure public.write_library_audit_log();
drop trigger if exists audit_study_slots on public.study_slots;
create trigger audit_study_slots after insert or update or delete on public.study_slots
  for each row execute procedure public.write_library_audit_log();
drop trigger if exists audit_library_settings on public.library_settings;
create trigger audit_library_settings after insert or update or delete on public.library_settings
  for each row execute procedure public.write_library_audit_log();

alter table public.seats enable row level security;
alter table public.library_settings enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "Students see active slots and admins see all" on public.study_slots;
drop policy if exists "Students see active and registered slots, admins see all" on public.study_slots;
create policy "Students read active slots and admins read all slots" on public.study_slots
  for select to authenticated using (active or public.is_library_admin());
drop policy if exists "Admins manage slots" on public.study_slots;
create policy "Admins manage slots" on public.study_slots
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

drop policy if exists "Students submit one own registration" on public.student_registrations;
create policy "Students submit one own registration" on public.student_registrations
  for insert to authenticated with check (
    student_id = (select auth.uid())
    and lower(btrim(email)) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and exists (select 1 from public.student_profiles p where p.id = (select auth.uid()) and p.status = 'active')
    and exists (select 1 from public.study_slots s where s.id = slot_id and s.active)
    and exists (
      select 1 from public.seats s
      where s.seat_number::text = student_registrations.seat_number and s.status = 'available'
    )
  );

drop policy if exists "Active students create own bookings" on public.bookings;
drop policy if exists "Registered active students create own bookings" on public.bookings;
drop policy if exists "Students and admins read bookings" on public.bookings;
drop policy if exists "Admins manage bookings" on public.bookings;
create policy "Students and admins read bookings" on public.bookings
  for select to authenticated using (student_id = (select auth.uid()) or public.is_library_admin());
create policy "Admins manage bookings" on public.bookings
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

drop policy if exists "Students check in to own bookings" on public.attendance;
drop policy if exists "Students and admins read attendance" on public.attendance;
drop policy if exists "Admins manage attendance" on public.attendance;
create policy "Students and admins read attendance" on public.attendance
  for select to authenticated using (student_id = (select auth.uid()) or public.is_library_admin());
create policy "Admins manage attendance" on public.attendance
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

drop policy if exists "Students and admins read profiles" on public.student_profiles;
create policy "Students and admins read profiles" on public.student_profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_library_admin());
drop policy if exists "Admins manage profiles" on public.student_profiles;
create policy "Admins manage profiles" on public.student_profiles
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

create policy "Students read available seats and admins read all" on public.seats
  for select to authenticated using (status = 'available' or public.is_library_admin());
create policy "Admins manage seats" on public.seats
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());
create policy "Authenticated users read library payment settings" on public.library_settings
  for select to authenticated using (true);
create policy "Admins manage library payment settings" on public.library_settings
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());
create policy "Students read own payments and admins read all" on public.payments
  for select to authenticated using (student_id = (select auth.uid()) or public.is_library_admin());
create policy "Admins manage payments" on public.payments
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());
create policy "Admins read audit logs" on public.audit_logs
  for select to authenticated using (public.is_library_admin());

revoke insert, update, delete on public.bookings, public.attendance, public.payments, public.audit_logs from authenticated;
grant select on public.seats, public.library_settings, public.payments, public.audit_logs to authenticated;
grant insert, update, delete on public.seats, public.study_slots to authenticated;
grant update on public.student_profiles, public.student_registrations to authenticated;
grant insert on public.student_registrations to authenticated;
grant usage, select on sequence public.audit_logs_id_seq to authenticated;
