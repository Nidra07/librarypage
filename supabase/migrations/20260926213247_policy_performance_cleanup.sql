-- Keep student SELECT policies separate from admin write access. Admin RPCs
-- perform booking, attendance, and payment writes with their own role checks.

drop policy if exists "Admins manage bookings" on public.bookings;
drop policy if exists "Admins manage attendance" on public.attendance;
drop policy if exists "Admins manage payments" on public.payments;
drop policy if exists "Admins manage profiles" on public.student_profiles;
drop policy if exists "Admins manage student registrations" on public.student_registrations;
drop policy if exists "Admins manage slots" on public.study_slots;
drop policy if exists "Admins manage seats" on public.seats;
drop policy if exists "Admins manage library payment settings" on public.library_settings;

create policy "Admins update profiles" on public.student_profiles
  for update to authenticated
  using ((select public.is_library_admin()))
  with check ((select public.is_library_admin()));
create policy "Admins update student registrations" on public.student_registrations
  for update to authenticated
  using ((select public.is_library_admin()))
  with check ((select public.is_library_admin()));

create policy "Admins insert slots" on public.study_slots
  for insert to authenticated with check ((select public.is_library_admin()));
create policy "Admins update slots" on public.study_slots
  for update to authenticated using ((select public.is_library_admin()))
  with check ((select public.is_library_admin()));
create policy "Admins delete slots" on public.study_slots
  for delete to authenticated using ((select public.is_library_admin()));

create policy "Admins insert seats" on public.seats
  for insert to authenticated with check ((select public.is_library_admin()));
create policy "Admins update seats" on public.seats
  for update to authenticated using ((select public.is_library_admin()))
  with check ((select public.is_library_admin()));
create policy "Admins delete seats" on public.seats
  for delete to authenticated using ((select public.is_library_admin()));

create policy "Admins update library payment settings" on public.library_settings
  for update to authenticated using ((select public.is_library_admin()))
  with check ((select public.is_library_admin()));

drop policy if exists "Students submit one own registration" on public.student_registrations;
create policy "Students submit one own registration" on public.student_registrations
  for insert to authenticated with check (
    student_id = (select auth.uid())
    and lower(btrim(email)) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and exists (select 1 from public.student_profiles p where p.id = (select auth.uid()) and p.status = 'active')
    and exists (select 1 from public.study_slots s where s.id = slot_id and s.active)
    and exists (
      select 1 from public.seats s
      where s.seat_number::text = student_registrations.seat_number and s.status = 'available'
    )
  );

revoke insert, delete on public.student_profiles from authenticated;
revoke delete on public.student_registrations from authenticated;
revoke insert, update, delete on public.bookings, public.attendance, public.payments, public.audit_logs from authenticated;
revoke insert, delete on public.library_settings from authenticated;
revoke usage, select on sequence public.audit_logs_id_seq from authenticated;

create index if not exists attendance_marked_by_idx on public.attendance (marked_by);
create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id);
create index if not exists payments_reviewed_by_idx on public.payments (reviewed_by);
