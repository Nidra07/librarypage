-- Registration intentionally does not assign a seat; students choose one during monthly payment.
drop policy if exists "Students submit one own registration" on public.student_registrations;
create policy "Students submit one own registration"
  on public.student_registrations
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and lower(btrim(email)) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    and exists (
      select 1 from public.student_profiles p
      where p.id = (select auth.uid()) and p.status = 'active'
    )
    and exists (
      select 1 from public.study_slots s
      where s.id = student_registrations.slot_id and s.active
    )
  );