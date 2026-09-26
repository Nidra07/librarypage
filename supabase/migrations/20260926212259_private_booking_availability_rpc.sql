drop policy if exists "Students read available seats and admins read all" on public.seats;
create policy "Authenticated users read seat inventory" on public.seats
  for select to authenticated using (true);

create or replace function public.get_seat_availability(p_booking_date date, p_slot_id uuid)
returns table (seat_number integer, label text, status text, is_available boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slot public.study_slots%rowtype;
  v_start timestamp;
  v_end timestamp;
begin
  if auth.uid() is null then raise exception 'Sign in to view seat availability.'; end if;
  if p_booking_date < current_date then raise exception 'Choose today or a future date.'; end if;
  select * into v_slot from public.study_slots s where s.id = p_slot_id and s.active;
  if not found then raise exception 'Choose an active time slot.'; end if;
  v_start := p_booking_date + v_slot.starts_at;
  v_end := p_booking_date + v_slot.ends_at
    + (case when v_slot.ends_at <= v_slot.starts_at then interval '1 day' else interval '0 day' end);
  return query
  select
    s.seat_number,
    s.label,
    s.status,
    s.status = 'available' and not exists (
      select 1 from public.bookings b
      where b.seat_number = s.seat_number and b.status <> 'cancelled'
        and tsrange(b.booking_date + b.entry_time,
          b.booking_date + b.exit_time + (b.exit_day_offset * interval '1 day'), '[)')
          && tsrange(v_start, v_end, '[)')
    ) as is_available
  from public.seats s
  order by s.seat_number;
end;
$$;
revoke execute on function public.get_seat_availability(date, uuid) from public, anon;
grant execute on function public.get_seat_availability(date, uuid) to authenticated;
