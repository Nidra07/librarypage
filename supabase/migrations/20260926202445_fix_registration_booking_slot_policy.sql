drop policy if exists "Registered active students create own bookings" on public.bookings;
create policy "Registered active students create own bookings" on public.bookings
  for insert to authenticated with check (
    bookings.student_id = (select auth.uid())
    and exists (
      select 1 from public.student_profiles p
      where p.id = (select auth.uid()) and p.status = 'active'
    )
    and exists (
      select 1 from public.student_registrations r
      where r.student_id = (select auth.uid()) and r.slot_id = bookings.slot_id
    )
    and exists (
      select 1 from public.study_slots s
      where s.id = bookings.slot_id and s.active
    )
  );
