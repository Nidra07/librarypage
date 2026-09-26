-- Library management foundation. Safe to re-run on projects that do not yet have these tables.
create extension if not exists pgcrypto;

create or replace function public.is_library_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  student_id text not null unique,
  photo_url text,
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  membership_plan text,
  membership_start date,
  membership_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seats (
  id uuid primary key default gen_random_uuid(),
  seat_number text not null unique,
  floor text not null default 'Ground',
  zone text not null default 'General',
  status text not null default 'available' check (status in ('available','maintenance','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_slots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time not null,
  end_time time not null,
  max_bookings integer not null default 1 check (max_bookings > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_slots_time_order check (end_time > start_time)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  seat_id uuid not null references public.seats(id) on delete restrict,
  slot_id uuid not null references public.booking_slots(id) on delete restrict,
  booking_date date not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','completed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete set null,
  attendance_date date not null,
  check_in_time timestamptz,
  check_out_time timestamptz,
  status text not null check (status in ('present','absent','late')),
  marked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_student_date_unique unique (student_id, attendance_date)
);

create index if not exists bookings_date_slot_idx on public.bookings(booking_date, slot_id) where status = 'confirmed';
create index if not exists bookings_student_date_idx on public.bookings(student_id, booking_date desc);
create index if not exists attendance_student_date_idx on public.attendance(student_id, attendance_date desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','seats','booking_slots','bookings','attendance'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

create or replace function public.create_library_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, phone, student_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'phone',
    'PP-' || upper(substr(replace(new.id::text, '-', ''), 1, 10))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_library_profile on auth.users;
create trigger on_auth_user_created_library_profile
after insert on auth.users for each row execute function public.create_library_profile();

create or replace function public.validate_library_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_status text; seat_status text; slot_active boolean; capacity integer; reserved integer;
begin
  if new.status <> 'confirmed' then return new; end if;

  select status into profile_status from public.profiles where id = new.student_id for update;
  if profile_status is distinct from 'active' then
    raise exception 'Only active members can book seats' using errcode = '23514';
  end if;

  select status into seat_status from public.seats where id = new.seat_id for update;
  if seat_status is distinct from 'available' then
    raise exception 'This seat is not available' using errcode = '23514';
  end if;

  select active, max_bookings into slot_active, capacity
  from public.booking_slots where id = new.slot_id for update;
  if slot_active is distinct from true then
    raise exception 'This booking slot is inactive' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.booking_date = new.booking_date and b.status = 'confirmed'
      and b.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and (b.seat_id = new.seat_id or b.student_id = new.student_id)
      and (b.seat_id = new.seat_id or b.slot_id = new.slot_id)
  ) then
    raise exception 'The student or seat already has a conflicting booking' using errcode = '23505';
  end if;

  select count(*) into reserved from public.bookings b
  where b.booking_date = new.booking_date and b.slot_id = new.slot_id
    and b.status = 'confirmed'
    and b.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if reserved >= capacity then
    raise exception 'This booking slot is at capacity' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_library_booking on public.bookings;
create trigger validate_library_booking
before insert or update of student_id, seat_id, slot_id, booking_date, status
on public.bookings for each row execute function public.validate_library_booking();

alter table public.profiles enable row level security;
alter table public.seats enable row level security;
alter table public.booking_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_library_admin()));
drop policy if exists "profiles update permitted self fields" on public.profiles;
create policy "profiles update permitted self fields" on public.profiles for update to authenticated
using (id = (select auth.uid()) or (select public.is_library_admin()))
with check (id = (select auth.uid()) or (select public.is_library_admin()));

drop policy if exists "public reads available seats" on public.seats;
create policy "public reads available seats" on public.seats for select to anon, authenticated using (status = 'available');
drop policy if exists "admin manages seats" on public.seats;
create policy "admin manages seats" on public.seats for all to authenticated
using ((select public.is_library_admin())) with check ((select public.is_library_admin()));

drop policy if exists "public reads active slots" on public.booking_slots;
create policy "public reads active slots" on public.booking_slots for select to anon, authenticated using (active);
drop policy if exists "admin manages slots" on public.booking_slots;
create policy "admin manages slots" on public.booking_slots for all to authenticated
using ((select public.is_library_admin())) with check ((select public.is_library_admin()));

drop policy if exists "students read own bookings or admin" on public.bookings;
create policy "students read own bookings or admin" on public.bookings for select to authenticated
using (student_id = (select auth.uid()) or (select public.is_library_admin()));
drop policy if exists "students create own bookings or admin" on public.bookings;
create policy "students create own bookings or admin" on public.bookings for insert to authenticated
with check ((student_id = (select auth.uid()) and created_by = (select auth.uid())) or (select public.is_library_admin()));
drop policy if exists "students cancel own bookings or admin" on public.bookings;
create policy "students cancel own bookings or admin" on public.bookings for update to authenticated
using (student_id = (select auth.uid()) or (select public.is_library_admin()))
with check ((select public.is_library_admin()) or (
  student_id = (select auth.uid()) and status = 'cancelled'
));

drop policy if exists "students read own attendance or admin" on public.attendance;
create policy "students read own attendance or admin" on public.attendance for select to authenticated
using (student_id = (select auth.uid()) or (select public.is_library_admin()));
drop policy if exists "admin manages attendance" on public.attendance;
create policy "admin manages attendance" on public.attendance for all to authenticated
using ((select public.is_library_admin())) with check ((select public.is_library_admin()));

-- Profiles may change contact details only; privileged and identity fields stay server controlled.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, photo_url) on public.profiles to authenticated;

insert into public.seats (seat_number, floor, zone)
values
  ('A01','Ground','Window'),('A02','Ground','Window'),('A03','Ground','Window'),
  ('A04','Ground','Window'),('A05','Ground','Window'),('A06','Ground','Window'),
  ('B01','Ground','Quiet'),('B02','Ground','Quiet'),('B03','Ground','Quiet'),
  ('B04','Ground','Quiet'),('B05','Ground','Quiet'),('B06','Ground','Quiet')
on conflict (seat_number) do nothing;

-- Keep the existing government_job_achievers public read path; add admin write access.
alter table if exists public.government_job_achievers enable row level security;
drop policy if exists "admins manage achievers" on public.government_job_achievers;
do $$
begin
  if to_regclass('public.government_job_achievers') is not null then
    execute 'create policy "admins manage achievers" on public.government_job_achievers for all to authenticated using ((select public.is_library_admin())) with check ((select public.is_library_admin()))';
  end if;
end;
$$;
