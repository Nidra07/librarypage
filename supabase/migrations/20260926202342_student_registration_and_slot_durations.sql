-- One-time student registration and duration-based booking slots.
-- Keep the existing slot IDs so current booking records remain linked.

create or replace function public.is_library_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

revoke execute on function public.is_library_admin() from public, anon;
grant execute on function public.is_library_admin() to authenticated;
revoke execute on function public.sync_student_profile() from public, anon, authenticated;

alter table public.study_slots add column duration_hours integer;

update public.study_slots s
set duration_hours = (
  select candidate.hours
  from (values (4), (6), (8), (12)) as candidate(hours)
  order by abs(candidate.hours - extract(epoch from (s.ends_at - s.starts_at)) / 3600.0), candidate.hours
  limit 1
)
where s.duration_hours is null;

alter table public.study_slots alter column duration_hours set not null;
alter table public.study_slots alter column starts_at drop not null;
alter table public.study_slots alter column ends_at drop not null;
alter table public.study_slots drop constraint if exists study_slots_time_order;
alter table public.study_slots
  add constraint study_slots_duration_allowed check (duration_hours in (4, 6, 8, 12));

create table public.student_registrations (
  student_id uuid primary key references public.student_profiles(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) > 0),
  admission_number text not null check (length(btrim(admission_number)) > 0),
  phone text not null check (length(btrim(phone)) > 0),
  email text not null check (length(btrim(email)) > 0),
  address text not null check (length(btrim(address)) > 0),
  slot_id uuid not null references public.study_slots(id) on delete restrict,
  entry_time time not null,
  exit_time time not null,
  exit_day_offset smallint not null default 0 check (exit_day_offset in (0, 1)),
  seat_number text not null check (length(btrim(seat_number)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index student_registrations_admission_number_unique
  on public.student_registrations (lower(btrim(admission_number)));
create unique index student_registrations_seat_number_unique
  on public.student_registrations (lower(btrim(seat_number)));
create index student_registrations_slot_idx on public.student_registrations (slot_id);

create or replace function public.calculate_registration_exit_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_duration integer;
  v_total_minutes integer;
begin
  select s.duration_hours into v_duration
  from public.study_slots s
  where s.id = new.slot_id;

  if v_duration is null then
    raise exception 'The selected booking duration is unavailable.';
  end if;

  v_total_minutes :=
    extract(hour from new.entry_time)::integer * 60
    + extract(minute from new.entry_time)::integer
    + v_duration * 60;

  new.exit_time := (
    time '00:00' + ((v_total_minutes % 1440) * interval '1 minute')
  )::time;
  new.exit_day_offset := (v_total_minutes / 1440)::smallint;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.calculate_registration_exit_time() from public, anon, authenticated;
drop trigger if exists calculate_registration_exit_time on public.student_registrations;
create trigger calculate_registration_exit_time
  before insert or update of slot_id, entry_time on public.student_registrations
  for each row execute procedure public.calculate_registration_exit_time();

alter table public.student_registrations enable row level security;

drop policy if exists "Students see active slots and admins see all" on public.study_slots;
create policy "Students see active and registered slots, admins see all" on public.study_slots
  for select to authenticated using (
    active
    or public.is_library_admin()
    or exists (
      select 1 from public.student_registrations r
      where r.student_id = (select auth.uid()) and r.slot_id = id
    )
  );

create policy "Students read own registration and admins read all" on public.student_registrations
  for select to authenticated using (
    student_id = (select auth.uid()) or public.is_library_admin()
  );
create policy "Students submit one own registration" on public.student_registrations
  for insert to authenticated with check (
    student_id = (select auth.uid())
    and lower(btrim(email)) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and exists (
      select 1 from public.student_profiles p
      where p.id = (select auth.uid()) and p.status = 'active'
    )
    and exists (
      select 1 from public.study_slots s
      where s.id = slot_id and s.active
    )
  );
create policy "Admins manage student registrations" on public.student_registrations
  for all to authenticated using (public.is_library_admin())
  with check (public.is_library_admin());

grant select, insert, update, delete on public.student_registrations to authenticated;

drop policy if exists "Active students create own bookings" on public.bookings;
create policy "Registered active students create own bookings" on public.bookings
  for insert to authenticated with check (
    student_id = (select auth.uid())
    and exists (
      select 1 from public.student_profiles p
      where p.id = (select auth.uid()) and p.status = 'active'
    )
    and exists (
      select 1 from public.student_registrations r
      where r.student_id = (select auth.uid()) and r.slot_id = slot_id
    )
    and exists (
      select 1 from public.study_slots s where s.id = slot_id and s.active
    )
  );
