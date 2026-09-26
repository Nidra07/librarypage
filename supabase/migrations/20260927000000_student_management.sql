-- Student membership, seat booking, slot, and attendance management.
-- Admin authorization is based on the trusted app_metadata.role claim.

create or replace function public.is_library_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

create table if not exists public.student_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_slots (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  starts_at time not null,
  ends_at time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint study_slots_time_order check (ends_at > starts_at)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  slot_id uuid not null references public.study_slots(id),
  booking_date date not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  unique (student_id, booking_date)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  attended_on date not null default current_date,
  checked_in_at timestamptz not null default now(),
  status text not null default 'present' check (status in ('present', 'absent')),
  marked_by uuid references auth.users(id) on delete set null
);

create index if not exists bookings_date_idx on public.bookings (booking_date);
create index if not exists bookings_student_idx on public.bookings (student_id);
create index if not exists attendance_date_idx on public.attendance (attended_on);
create index if not exists attendance_student_idx on public.attendance (student_id);

create or replace function public.sync_student_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.student_profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_student_profile on auth.users;
create trigger sync_student_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.sync_student_profile();

insert into public.student_profiles (id, full_name, email, phone)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  coalesce(u.email, ''),
  nullif(u.raw_user_meta_data ->> 'phone', '')
from auth.users u
on conflict (id) do nothing;

alter table public.student_profiles enable row level security;
alter table public.study_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "Students and admins read profiles" on public.student_profiles;
create policy "Students and admins read profiles" on public.student_profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_library_admin());
drop policy if exists "Admins manage profiles" on public.student_profiles;
create policy "Admins manage profiles" on public.student_profiles
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

drop policy if exists "Students see active slots and admins see all" on public.study_slots;
create policy "Students see active slots and admins see all" on public.study_slots
  for select to authenticated using (active or public.is_library_admin());
drop policy if exists "Admins manage slots" on public.study_slots;
create policy "Admins manage slots" on public.study_slots
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

drop policy if exists "Students and admins read bookings" on public.bookings;
create policy "Students and admins read bookings" on public.bookings
  for select to authenticated using (student_id = (select auth.uid()) or public.is_library_admin());
drop policy if exists "Active students create own bookings" on public.bookings;
create policy "Active students create own bookings" on public.bookings
  for insert to authenticated with check (
    student_id = (select auth.uid())
    and exists (select 1 from public.student_profiles p where p.id = (select auth.uid()) and p.status = 'active')
    and exists (select 1 from public.study_slots s where s.id = slot_id and s.active)
  );
drop policy if exists "Admins manage bookings" on public.bookings;
create policy "Admins manage bookings" on public.bookings
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

drop policy if exists "Students and admins read attendance" on public.attendance;
create policy "Students and admins read attendance" on public.attendance
  for select to authenticated using (student_id = (select auth.uid()) or public.is_library_admin());
drop policy if exists "Students check in to own bookings" on public.attendance;
create policy "Students check in to own bookings" on public.attendance
  for insert to authenticated with check (
    student_id = (select auth.uid())
    and status = 'present'
    and exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.student_id = (select auth.uid())
        and b.booking_date = current_date and b.status = 'booked'
    )
  );
drop policy if exists "Admins manage attendance" on public.attendance;
create policy "Admins manage attendance" on public.attendance
  for all to authenticated using (public.is_library_admin()) with check (public.is_library_admin());

grant select, insert, update, delete on public.student_profiles, public.study_slots, public.bookings, public.attendance to authenticated;
