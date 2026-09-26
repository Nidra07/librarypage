grant insert, update, delete on public.library_settings to authenticated;

create or replace function public.cancel_my_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings
  set status = 'cancelled', updated_at = now()
  where id = p_booking_id
    and student_id = auth.uid()
    and status = 'confirmed'
    and booking_date >= current_date;
  if not found then raise exception 'This visit can no longer be cancelled.'; end if;
end;
$$;
revoke execute on function public.cancel_my_booking(uuid) from public, anon;
grant execute on function public.cancel_my_booking(uuid) to authenticated;
