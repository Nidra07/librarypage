-- Keep each active student's seat assigned across monthly billing periods.
-- Seats are released when an administrator inactivates or suspends the student.

create table if not exists public.student_seat_assignments (
  student_id uuid primary key references public.student_profiles(id) on delete cascade,
  seat_number integer not null references public.seats(seat_number) on delete restrict,
  assigned_at timestamptz not null default now()
);

create unique index if not exists student_seat_assignments_seat_unique
  on public.student_seat_assignments (seat_number);

alter table public.student_seat_assignments enable row level security;
revoke all on table public.student_seat_assignments from public, anon, authenticated;
grant select on table public.student_seat_assignments to authenticated;
drop policy if exists "Students and admins can read seat assignments" on public.student_seat_assignments;
create policy "Students and admins can read seat assignments"
  on public.student_seat_assignments
  for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_library_admin()));

comment on table public.student_seat_assignments is
  'Persistent seat allocation for active students; only trusted database functions and triggers may write rows.';

-- Preserve each active student's most recent usable seat where the old monthly
-- or registration data identifies one. Duplicate legacy claims are resolved once.
with candidates as (
  select p.id as student_id,
    coalesce(
      (
        select pm.seat_number
        from public.payments pm
        join public.seats s on s.seat_number = pm.seat_number and s.status = 'available'
        where pm.student_id = p.id and pm.payment_type = 'monthly'
          and pm.status = 'verified' and pm.seat_number is not null
        order by pm.billing_month desc, pm.reviewed_at desc nulls last, pm.submitted_at desc
        limit 1
      ),
      (
        select b.seat_number
        from public.bookings b
        join public.seats s on s.seat_number = b.seat_number and s.status = 'available'
        where b.student_id = p.id and b.status <> 'cancelled'
        order by b.booking_date desc, b.created_at desc
        limit 1
      ),
      (
        select s.seat_number
        from public.student_registrations r
        cross join lateral (
          select case when btrim(r.seat_number) ~ '^[0-9]+$'
            then r.seat_number::integer end as seat_number
        ) parsed
        join public.seats s on s.seat_number = parsed.seat_number and s.status = 'available'
        where r.student_id = p.id
        limit 1
      )
    ) as seat_number,
    p.created_at
  from public.student_profiles p
  where p.status = 'active'
), ranked_candidates as (
  select c.student_id, c.seat_number,
    row_number() over (partition by c.seat_number order by c.created_at, c.student_id) as seat_rank
  from candidates c
  where c.seat_number is not null
)
insert into public.student_seat_assignments (student_id, seat_number)
select c.student_id, c.seat_number
from ranked_candidates c
join public.student_profiles p on p.id = c.student_id and p.status = 'active'
join public.seats s on s.seat_number = c.seat_number and s.status = 'available'
where c.seat_rank = 1
on conflict do nothing;

create index if not exists payments_pending_monthly_seat_lookup
  on public.payments (seat_number, student_id)
  where payment_type = 'monthly' and status = 'pending' and seat_number is not null;

create or replace function public.enforce_persistent_seat_on_monthly_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.student_profiles%rowtype;
  v_assigned_seat integer;
begin
  if new.payment_type <> 'monthly' or new.status not in ('pending', 'verified')
    or new.seat_number is null then
    return new;
  end if;

  -- Serialize competing claims on this seat before checking active assignments
  -- and pending seat choices.
  perform 1 from public.seats s
  where s.seat_number = new.seat_number and s.status = 'available'
  for update;
  if not found then raise exception 'That seat is unavailable. Choose another vacant seat.'; end if;

  select p.* into v_profile
  from public.student_profiles p
  where p.id = new.student_id
  for update;
  if not found then raise exception 'Student profile was not found.'; end if;
  if v_profile.status <> 'active' then
    raise exception 'Only active students can hold a seat. Contact the administrator.';
  end if;

  select a.seat_number into v_assigned_seat
  from public.student_seat_assignments a
  where a.student_id = new.student_id;
  if v_assigned_seat is not null and v_assigned_seat <> new.seat_number then
    raise exception 'Your seat remains allocated while your account is active. Contact the administrator if it needs to be released.';
  end if;

  if exists (
    select 1 from public.student_seat_assignments a
    where a.seat_number = new.seat_number and a.student_id <> new.student_id
  ) then
    raise exception 'That seat is already allocated to another active student. Choose another vacant seat.';
  end if;

  if new.status = 'pending' and exists (
    select 1 from public.payments p
    where p.payment_type = 'monthly' and p.status = 'pending'
      and p.student_id <> new.student_id and p.seat_number = new.seat_number
      and (tg_op = 'INSERT' or p.id <> new.id)
  ) then
    raise exception 'That seat is already reserved while another payment is reviewed. Choose another vacant seat.';
  end if;

  if new.status = 'pending' and exists (
    select 1 from public.payments p
    where p.payment_type = 'monthly' and p.status = 'pending'
      and p.student_id = new.student_id and (tg_op = 'INSERT' or p.id <> new.id)
  ) then
    raise exception 'A monthly payment is already awaiting review. Wait for the administrator before submitting another.';
  end if;

  if new.status = 'verified' and v_assigned_seat is null then
    insert into public.student_seat_assignments (student_id, seat_number)
    values (new.student_id, new.seat_number);
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_persistent_seat_on_monthly_payment() from public, anon, authenticated;
drop trigger if exists enforce_persistent_seat_on_monthly_payment on public.payments;
create trigger enforce_persistent_seat_on_monthly_payment
  before insert or update of student_id, payment_type, status, seat_number on public.payments
  for each row execute function public.enforce_persistent_seat_on_monthly_payment();

create or replace function public.release_student_seat_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('inactive', 'suspended') then
    delete from public.student_seat_assignments a where a.student_id = new.id;

    update public.bookings b
    set status = 'cancelled', updated_at = now()
    where b.student_id = new.id and b.status = 'confirmed'
      and b.booking_date >= public.library_today();

    update public.payments p
    set status = 'rejected', seat_number = null,
        admin_note = 'Membership was set to ' || new.status || '; submit again after reactivation and choose a vacant seat.',
        reviewed_at = now(), reviewed_by = null
    where p.student_id = new.id and p.payment_type = 'monthly' and p.status = 'pending';
  elsif new.status = 'active' and old.status is distinct from 'active' then
    -- Reactivation never restores an old seat; the student must claim one again.
    delete from public.student_seat_assignments a where a.student_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.release_student_seat_on_status_change() from public, anon, authenticated;
drop trigger if exists release_student_seat_on_status_change on public.student_profiles;
create trigger release_student_seat_on_status_change
  after update of status on public.student_profiles
  for each row execute function public.release_student_seat_on_status_change();

create or replace function public.admin_set_student_status(p_student_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_library_admin() then raise exception 'Administrator access is required.'; end if;
  if p_status not in ('active', 'inactive', 'suspended') then
    raise exception 'Choose active, inactive, or suspended.';
  end if;

  -- Lock pending payments and their seats before the profile, matching payment
  -- review's payment -> seat -> profile lock order.
  perform 1 from public.payments p
  where p.student_id = p_student_id and p.payment_type = 'monthly' and p.status = 'pending'
  order by p.id
  for update;
  perform 1 from public.seats s
  where s.seat_number in (
    select p.seat_number from public.payments p
    where p.student_id = p_student_id and p.payment_type = 'monthly'
      and p.status = 'pending' and p.seat_number is not null
  )
  order by s.seat_number
  for update;

  perform 1 from public.student_profiles p where p.id = p_student_id for update;
  if not found then raise exception 'Student profile was not found.'; end if;
  update public.student_profiles p
  set status = p_status, updated_at = now()
  where p.id = p_student_id;
end;
$$;

revoke execute on function public.admin_set_student_status(uuid, text) from public, anon;
grant execute on function public.admin_set_student_status(uuid, text) to authenticated;

create or replace function public.claim_student_seat(p_seat_number integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_profile public.student_profiles%rowtype;
  v_monthly_fee numeric(10, 2);
  v_billing_month date := date_trunc('month', public.library_today())::date;
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
    raise exception 'Your current month’s fee must be verified before choosing a replacement seat.';
  end if;

  insert into public.student_seat_assignments (student_id, seat_number)
  values (v_student, p_seat_number);
  return p_seat_number;
end;
$$;

revoke execute on function public.claim_student_seat(integer) from public, anon;
grant execute on function public.claim_student_seat(integer) to authenticated;

create or replace function public.get_monthly_seat_availability(p_billing_month date)
returns table (seat_number integer, label text, status text, is_available boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
begin
  if v_student is null then raise exception 'Sign in to view seat availability.'; end if;
  if p_billing_month is null or date_trunc('month', p_billing_month)::date <> p_billing_month then
    raise exception 'Choose the first day of a billing month.';
  end if;
  if not exists (select 1 from public.student_profiles p where p.id = v_student and p.status = 'active') then
    raise exception 'Only active students can choose a seat.';
  end if;
  if not exists (select 1 from public.student_registrations r where r.student_id = v_student) then
    raise exception 'Complete student registration before choosing a seat.';
  end if;

  return query
  select s.seat_number, s.label, s.status,
    s.status = 'available'
      and not exists (
        select 1 from public.student_seat_assignments a where a.seat_number = s.seat_number
      )
      and not exists (
        select 1 from public.payments p
        where p.payment_type = 'monthly' and p.status = 'pending'
          and p.seat_number = s.seat_number
      ) as is_available
  from public.seats s
  order by s.seat_number;
end;
$$;

revoke execute on function public.get_monthly_seat_availability(date) from public, anon;
grant execute on function public.get_monthly_seat_availability(date) to authenticated;

create or replace function public.enforce_persistent_student_seat_on_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_seat_number integer;
begin
  if new.status <> 'confirmed' then return new; end if;
  select p.status, a.seat_number into v_status, v_seat_number
  from public.student_profiles p
  left join public.student_seat_assignments a on a.student_id = p.id
  where p.id = new.student_id;
  if v_status is distinct from 'active' then raise exception 'Only active students can book a visit.'; end if;
  if v_seat_number is null then
    raise exception 'Choose a vacant seat before booking. Your current month’s fee must be verified first.';
  end if;
  new.seat_number := v_seat_number;
  return new;
end;
$$;

revoke execute on function public.enforce_persistent_student_seat_on_booking() from public, anon, authenticated;
drop trigger if exists a_enforce_monthly_seat_booking on public.bookings;
drop trigger if exists a_enforce_persistent_student_seat_booking on public.bookings;
create trigger a_enforce_persistent_student_seat_booking
  before insert or update of student_id, booking_date, seat_number, status on public.bookings
  for each row execute function public.enforce_persistent_student_seat_on_booking();

create or replace function public.admin_monthly_attendance_summary(p_month date)
returns table (
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
    count(distinct b.id)::bigint,
    count(distinct a.attended_on) filter (where a.status = 'present')::bigint,
    count(distinct a.attended_on) filter (where a.status = 'absent' and not exists (
      select 1 from public.attendance present
      where present.student_id = p.id and present.attended_on = a.attended_on and present.status = 'present'
    ))::bigint,
    count(distinct b.id) filter (where a.id is null)::bigint
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

notify pgrst, 'reload schema';

